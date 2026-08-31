// Proves the audit projection is real, Loader-composed configurability and not
// a hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the session store, the storage hub/domain, the session-query backend,
// the command registry, and dsh-sci-audit, and the durable output it owns — the
// three projected tables, the `/audit-rebuild` command, and the on-demand
// summary — appears from that composition alone. It covers 04-T3 (a cold
// rebuild reproduces the live projection of a seeded log) and 08-T6 (a session
// with one denial and one delivery projects exactly those two rows).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, LoggerLevel } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import * as Commands from '@deepseek-ai/dsh-commands'
import * as SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import * as SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as SciMemory from '@deepseek-ai/dsh-sci-memory'
import * as SciAudit from '@deepseek-ai/dsh-sci-audit'
// Type-only: the seeded log below appends the plan declaration this package projects.
import type {} from '@deepseek-ai/dsh-sci-plan'

const SIGNAL = new AbortController().signal
const DIGEST = 'c'.repeat(64)

const MEMORY_NODE = [
  '---',
  'name: gh-auth-via-host-config',
  'description: How gh authenticates inside the sandbox',
  'metadata:',
  '  node_type: memory',
  '  type: reference',
  '---',
  '',
  'Export GH_CONFIG_DIR.',
  '',
].join('\n')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the audit projection.
 * @param withMemory - whether the composition also mounts `dsh-sci-memory`, whose index a summary reads.
 * @returns the booted context.
 */
async function boot(withMemory = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-audit-loader-'))
  const sandbox = join(root, 'sci')
  await mkdir(join(sandbox, 'memory'), { recursive: true })
  await mkdir(join(root, 'storage'), { recursive: true })

  const configPath = join(root, 'cordis.yml')
  const memoryLines = withMemory
    ? [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: ${JSON.stringify(sandbox)}`,
      "- name: '@deepseek-ai/dsh-tool-fs'",
      "- name: '@deepseek-ai/dsh-sci-memory'",
      '  config:',
      `    memoryDir: ${JSON.stringify(join(sandbox, 'memory'))}`,
    ]
    : []
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-session-query-sqlite'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'query.sqlite'))}`,
    ...memoryLines,
    "- name: '@deepseek-ai/dsh-sci-audit'",
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
    ['@deepseek-ai/dsh-commands', Commands],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-query-sqlite', SessionQuerySqlite],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-sci-memory', SciMemory],
    ['@deepseek-ai/dsh-sci-audit', SciAudit],
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
  return ctx
}

/**
 * Register one agent whose session the command registry can dispatch against.
 * @param ctx - the booted context.
 * @param session - the session the agent owns.
 * @returns the registered agent.
 */
function registerAgent(ctx: Context, session: Session): Agent {
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
  return agent
}

/**
 * Append the seeded log 04-T3 rebuilds: one refused tool call, one delivery, a
 * declared plan, the workflow run that plan authorized, and a cited answer.
 * @param session - the session to seed.
 */
function seed(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('request/context', { provider: 'deepseek', model: 'deepseek-chat' })
  session.append('tool/call', { turn: 1, step: 1, callId: CallId('c-1'), name: 'web_search', arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: CallId('c-1'), content: [{ type: 'text', text: 'ok' }], isError: false }),
  }, { surfaceOp: 'append' })
  session.append('sci/fs-denied', {
    op: 'read', path: '/sci/projects/p1/a.pdf', rule: 'binary', reason: 'convert it with pdftotext first',
  }, { ignorable: true })
  session.append('sci/plan-declared', {
    planId: 'p-1',
    agents: [{ id: 'a', name: 'Scout', icon: 'search', task: 'find sources' }],
    edges: [],
  } as never)
  session.append('tool-workflow/run-start', { runId: 'r-1', name: 'survey' } as never, { ignorable: true })
  session.append('sci/delivered', {
    deliveryId: 'd-1',
    path: '/sci/projects/p1/workspace/report.md',
    sha256: DIGEST,
    size: 9,
    title: 'Report',
    kind: 'file',
    via: 'tool',
  } as never, { ignorable: true })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Done, see ([source](https://arxiv.org/abs/1)).' }],
      source: { provider: 'deepseek', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

/**
 * Snapshot the three owned tables for one session.
 * @param ctx - the booted context.
 * @param session - the session to read.
 * @returns the committed rows.
 */
function tables(ctx: Context, session: Session) {
  return {
    audit: ctx.sciAudit.auditRows(session.header.id),
    delivery: ctx.sciAudit.deliveryRows(),
    plan: ctx.sciAudit.planRows(),
  }
}

/**
 * Resolve after every queued projection write has settled. A rebuild joins the
 * same single write chain, so an empty one is the chain's own drain point.
 * @param ctx - the booted context.
 */
async function settled(ctx: Context): Promise<void> {
  await ctx.sciAudit.rebuild([])
}

/**
 * Collect every warning the context logs from now on.
 * @param ctx - the context whose logger service is observed.
 * @returns the growing list of formatted first arguments.
 */
function warnings(ctx: Context): string[] {
  const collected: string[] = []
  ctx.logger.exporter({
    levels: { default: LoggerLevel.DEBUG },
    export: (message) => {
      if (message.type === 'warn') collected.push(String(message.args[0]))
    },
  })
  return collected
}

describe('sci-audit real Loader composition through cordis.yml', () => {
  it('projects a seeded log live and rebuilds the identical tables cold (04-T3)', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    seed(session)
    await settled(ctx)

    const live = tables(ctx, session)
    expect(live.audit.map(record => record.kind)).toEqual([
      'request-context',
      'tool-call',
      'tool-result',
      'fs-denied',
      'plan-declared',
      'workflow-run-start',
      'delivered',
      'turn-end',
    ])
    expect(live.plan).toEqual([expect.objectContaining({ planId: 'p-1', workflowRunId: 'r-1' })])
    expect(live.delivery).toEqual([expect.objectContaining({ deliveryId: 'd-1', sha256: DIGEST })])

    const report = await ctx.sciAudit.rebuild([session.header.id])

    expect(tables(ctx, session)).toEqual(live)
    expect(report.removed).toBe(live.audit.length + live.delivery.length + live.plan.length)
    expect(report.sessionIds).toEqual([session.header.id])
  }, 30_000)

  it('projects exactly one denial row and one delivery row for a session that had one of each (08-T6)', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    session.append('sci/fs-denied', {
      op: 'write', path: '/sci/projects/p1/tmp/out.csv', rule: 'workspace', reason: 'write under workspace/ instead',
    }, { ignorable: true })
    session.append('sci/delivered', {
      deliveryId: 'd-2',
      path: '/sci/projects/p1/workspace/report.md',
      sha256: DIGEST,
      size: 9,
      title: 'Report',
      kind: 'file',
      via: 'tool',
    } as never, { ignorable: true })
    await settled(ctx)

    expect(ctx.sciAudit.auditRows(session.header.id).map(record => record.kind)).toEqual(['fs-denied', 'delivered'])
    expect(ctx.sciAudit.deliveryRows()).toHaveLength(1)
    expect(ctx.sciAudit.planRows()).toEqual([])
  }, 30_000)

  it('re-projects every session in the corpus through the human command', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    seed(session)
    const agent = registerAgent(ctx, session)
    await settled(ctx)

    const execution = await ctx.commands.execute(agent, `/${SciAudit.REBUILD_COMMAND}`, [], SIGNAL)

    expect(execution?.result.kind).toBe('success')
    expect(execution?.result.text).toContain('Re-projected 1 session(s)')
    expect(ctx.sciAudit.auditRows(session.header.id)).not.toEqual([])
  }, 30_000)

  it('re-projects only the sessions the command names', async () => {
    const ctx = await boot()
    const first = ctx.sessions.create()
    seed(first)
    const second = ctx.sessions.create()
    seed(second)
    const agent = registerAgent(ctx, first)
    await settled(ctx)

    const execution = await ctx.commands.execute(agent, `/${SciAudit.REBUILD_COMMAND} ${first.header.id}`, [], SIGNAL)

    expect(execution?.result.kind).toBe('success')
    expect(execution?.result.text).toContain('Re-projected 1 session(s)')
    expect(ctx.sciAudit.auditRows(second.header.id)).not.toEqual([])
  }, 30_000)

  it('refuses to truncate anything when the corpus cannot serve a requested session', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    seed(session)
    const agent = registerAgent(ctx, session)
    await settled(ctx)
    const before = tables(ctx, session)

    const execution = await ctx.commands.execute(
      ctx.agents.get(agent.id) ?? agent,
      `/${SciAudit.REBUILD_COMMAND} 00000000-0000-4000-8000-000000000000`,
      [],
      SIGNAL,
    )

    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'No session log is available for 1 of the 1 requested sessions; nothing was re-projected.',
    })
    expect(tables(ctx, session)).toEqual(before)
  }, 30_000)

  it('summarizes a session on demand without a memory index composed', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    seed(session)
    await settled(ctx)

    await expect(ctx.sciAudit.summarize(session.header.id)).resolves.toEqual({
      sessionId: session.header.id,
      denied: 1,
      delivered: 1,
      authorized: 0,
      citationMissing: false,
      planMismatches: 1,
      deliveriesWithoutExecution: 1,
    })
  }, 30_000)

  it('scores memory write timing from the index its owning package keeps', async () => {
    const ctx = await boot(true)
    const session = ctx.sessions.create()
    seed(session)
    await ctx.tools.execute({
      signal: SIGNAL,
      callId: CallId('c-memory'),
      name: 'write',
      arguments: { file_path: join(root!, 'sci', 'memory', 'gh-auth-via-host-config.md'), content: MEMORY_NODE },
      agent: { id: session.header.id, session } as Agent,
    })
    await settled(ctx)

    const summary = await ctx.sciAudit.summarize(session.header.id)

    expect(ctx.sciMemory.memoryIndex()).toEqual([expect.objectContaining({
      slug: 'gh-auth-via-host-config',
      originSessionId: session.header.id,
    })])
    // One node written in the only turn the session ran: as late as it could be.
    expect(summary.memoryTimingScore).toBe(0)
  }, 30_000)

  it('keeps the session running and warns when a projection cannot be committed', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    const logged = warnings(ctx)
    await ctx.storageDomain.closeAll()

    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settled(ctx)

    expect(logged).toEqual([expect.stringContaining('sci-audit could not project turn/end')])
    expect(session.events.at(-1)?.type).toBe('turn/end')
  }, 30_000)
})
