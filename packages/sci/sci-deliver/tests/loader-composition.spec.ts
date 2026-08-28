// Proves the delivery layer is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the tool registry, a real filesystem, the prompt layer, and
// dsh-sci-deliver, and the durable output it owns — the `sci/delivered` event,
// the snapshot copy, and the failure reminder the next assembly carries —
// appears from that composition alone. It covers 06-T5 (a spool entry produces
// the same event as the tool) and 06-T6 (a failed spool entry reaches the next
// prompt and only that one).
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox, agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciDeliver from '@deepseek-ai/dsh-sci-deliver'
import { DELIVERY_FAILURES_CONTEXT, DELIVER_TOOL } from '@deepseek-ai/dsh-sci-deliver'

const SIGNAL = new AbortController().signal

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

interface Booted {
  readonly ctx: Context
  readonly agent: Agent
  readonly sandbox: string
  readonly project: string
  readonly workspace: string
  readonly spool: string
  readonly snapshots: string
}

/**
 * Boot a cordis.yml carrying the given sci-deliver config block over a fresh
 * sandbox layout, and register one agent whose session receives the events.
 */
async function boot(configLines: readonly string[] = [], omitProjectRoot = false): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-deliver-loader-'))
  const sandbox = join(root, 'sci')
  const project = join(sandbox, 'projects', 'p1')
  const workspace = join(project, 'workspace')
  const spool = join(sandbox, '.sci', 'spool')
  const snapshots = join(sandbox, '.sci', 'deliveries')
  await mkdir(join(project, 'tmp'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(join(spool, 'pending'), { recursive: true })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(project)}`,
    "- name: '@deepseek-ai/dsh-sci-deliver'",
    '  config:',
    ...omitProjectRoot ? [] : [`    projectRoot: ${JSON.stringify(join(sandbox, 'projects'))}`],
    `    spoolDir: ${JSON.stringify(spool)}`,
    `    snapshotDir: ${JSON.stringify(snapshots)}`,
    ...configLines,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-sci-deliver', SciDeliver],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  const session = ctx.sessions.create()
  const scope = ctx.plugin(() => {})
  const agent: Agent = {
    id: session.header.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel: () => {},
    runMaintenance: task => task(SIGNAL),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent, sandbox, project, workspace, spool, snapshots }
}

/** Drive one turn's first pre-step, which is where the spool is drained. */
function turnStart(ctx: Context, agent: Agent, turn = 1): Promise<unknown> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn, step: 1, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
}

/** The delivery-failure context text the next assembly would carry; empty when there is none. */
async function failureContext(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({})
  return assembly.contexts.find(entry => entry.name === DELIVERY_FAILURES_CONTEXT)?.text ?? ''
}

/** Every delivery event in the agent's log. */
function deliveries(agent: Agent): SessionEvent[] {
  return agent.session.events.filter(event => event.type === 'sci/delivered')
}

describe('sci-deliver real Loader composition through cordis.yml', () => {
  it('delivers through the tool, logs the record, and snapshots the bytes', async () => {
    const booted = await boot()
    await writeFile(join(booted.workspace, 'report.md'), '# Report\n')

    const result = await booted.ctx.tools.execute({
      signal: SIGNAL,
      callId: CallId('deliver-tool'),
      name: DELIVER_TOOL,
      arguments: { files: [{ path: 'workspace/report.md', title: 'Report', description: 'the findings' }] },
      agent: booted.agent,
    })

    expect(result.isError).toBe(false)
    const [event] = deliveries(booted.agent)
    expect(event?.data).toMatchObject({ kind: 'file', size: 9, title: 'Report', description: 'the findings', via: 'tool' })
    const { deliveryId } = event?.data as { deliveryId: string }
    await expect(readFile(join(booted.snapshots, deliveryId, 'report.md'), 'utf8')).resolves.toBe('# Report\n')
  }, 30_000)

  it('produces the same event from a spool entry as from the tool (06-T5)', async () => {
    const booted = await boot()
    await writeFile(join(booted.workspace, 'report.md'), '# Report\n')
    await writeFile(join(booted.workspace, 'notes.md'), '# Report\n')
    await writeFile(
      join(booted.spool, 'pending', '01.json'),
      JSON.stringify({ path: 'workspace/notes.md', title: 'Notes' }),
    )

    await booted.ctx.tools.execute({
      signal: SIGNAL,
      callId: CallId('deliver-tool'),
      name: DELIVER_TOOL,
      arguments: { files: [{ path: 'workspace/report.md', title: 'Report' }] },
      agent: booted.agent,
    })
    await turnStart(booted.ctx, booted.agent)

    const [fromTool, fromSpool] = deliveries(booted.agent).map(event => event.data as Record<string, unknown>)
    expect(fromTool).toBeDefined()
    expect(fromSpool).toBeDefined()
    expect(Object.keys(fromSpool ?? {}).sort()).toEqual(Object.keys(fromTool ?? {}).sort())
    expect(fromSpool?.['sha256']).toBe(fromTool?.['sha256'])
    expect(fromSpool?.['via']).toBe('spool')
    expect(fromTool?.['via']).toBe('tool')
    expect(deliveries(booted.agent).every(event => event.ignorable === true)).toBe(true)

    // The pending entry is tombstoned in place, so a second drain repeats nothing.
    await expect(readFile(join(booted.spool, 'pending', '01.json'), 'utf8')).resolves.toBe(SciDeliver.SPOOL_TOMBSTONE)
    await expect(readFile(join(booted.spool, 'done', '01.json'), 'utf8')).resolves.toContain('workspace/notes.md')
    await turnStart(booted.ctx, booted.agent, 2)
    expect(deliveries(booted.agent)).toHaveLength(2)
  }, 30_000)

  it('carries a failed spool entry into the next prompt and only that one (06-T6)', async () => {
    const booted = await boot()
    await writeFile(join(booted.project, 'tmp', 'draft.pdf'), 'not deliverable')
    await writeFile(
      join(booted.spool, 'pending', '01.json'),
      JSON.stringify({ path: 'tmp/draft.pdf', title: 'Draft' }),
    )

    expect(await failureContext(booted.ctx)).toBe('')
    await turnStart(booted.ctx, booted.agent)

    const failure = booted.agent.session.events.find(event => event.type === 'sci/delivery-failed')
    expect(failure?.data).toMatchObject({ via: 'spool' })
    expect(String((failure?.data as { reason?: unknown } | undefined)?.reason)).toContain('workspace/')
    expect(failure?.ignorable).toBe(true)
    await expect(readFile(join(booted.spool, 'failed', '01.json'), 'utf8')).resolves.toContain('workspace/')

    const materialised = await failureContext(booted.ctx)
    expect(materialised).toContain('1 shell delivery failed')
    expect(materialised).toContain('draft.pdf')
    expect(await failureContext(booted.ctx)).toBe('')
  }, 30_000)

  it('leaves the spool untouched when polling is turned off', async () => {
    const booted = await boot(['    pollOnTurnStart: false'])
    await writeFile(join(booted.workspace, 'report.md'), '# Report\n')
    await writeFile(
      join(booted.spool, 'pending', '01.json'),
      JSON.stringify({ path: 'workspace/report.md', title: 'Report' }),
    )

    await turnStart(booted.ctx, booted.agent)

    expect(deliveries(booted.agent)).toHaveLength(0)
    await expect(readFile(join(booted.spool, 'pending', '01.json'), 'utf8')).resolves.toContain('workspace/report.md')
  }, 30_000)

  it('drains only at the first step of a turn', async () => {
    const booted = await boot()
    await writeFile(join(booted.workspace, 'report.md'), '# Report\n')
    await writeFile(
      join(booted.spool, 'pending', '01.json'),
      JSON.stringify({ path: 'workspace/report.md', title: 'Report' }),
    )

    await agentEvents(booted.ctx, booted.agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )

    expect(deliveries(booted.agent)).toHaveLength(0)
  }, 30_000)

  it('follows a renamed delivery directory through the config', async () => {
    const booted = await boot(['    deliveryDir: deliverables'])
    await mkdir(join(booted.project, 'deliverables'), { recursive: true })
    await writeFile(join(booted.project, 'deliverables', 'report.md'), '# Report\n')

    const description = booted.ctx.tools.schemas().find(schema => schema.name === DELIVER_TOOL)?.description ?? ''
    expect(description).toContain('deliverables/ directory')

    const result = await booted.ctx.tools.execute({
      signal: SIGNAL,
      callId: CallId('deliver-renamed'),
      name: DELIVER_TOOL,
      arguments: { files: [{ path: 'deliverables/report.md', title: 'Report' }] },
      agent: booted.agent,
    })

    expect(result.isError).toBe(false)
    expect(deliveries(booted.agent)).toHaveLength(1)
  }, 30_000)

  it.each([
    { label: 'the project root is omitted', configLines: [], omit: true, failure: /projectRoot/ },
    { label: 'the canvas depth is not positive', configLines: ['    canvasAssetDepth: 0'], omit: false, failure: /canvasAssetDepth/ },
    { label: 'the byte cap is fractional', configLines: ['    maxDeliveryBytes: 1.5'], omit: false, failure: /maxDeliveryBytes/ },
  ])('fails loading when $label', async ({ configLines, omit, failure }) => {
    await expect(boot(configLines, omit)).rejects.toThrow(failure)
  }, 30_000)
})
