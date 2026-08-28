// Proves the gate is real, Loader-composed configurability and not a hand-built
// ctx.plugin() suite: a cordis.yml booted through the real Loader mounts the
// tool registry, a real filesystem, the prompt layer, the approval seam, and
// dsh-sci-guard, and everything this package owns — the prompt chapter, the
// approval question, the registry's denial, and the `sci/authorized` record —
// appears from that composition alone.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import * as SciGuard from '@deepseek-ai/dsh-sci-guard'
import { SECTION_IRREVERSIBLE_ACTIONS } from '@deepseek-ai/dsh-sci-guard'

const SIGNAL = new AbortController().signal
const ELF_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])

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
  readonly session: Session
  readonly agent: Agent
  readonly project: string
  readonly ran: string[]
  /** What the composed answerer replies to the next question. */
  answer: ApprovalOutcome
}

/**
 * Boot a cordis.yml carrying the given sci-guard config block over a fresh
 * sandbox layout, and open one session's turn so an approval may be asked.
 * @param configLines - additional indented config lines for the sci-guard entry.
 * @param projectRoot - the `projectRoot` value, or `undefined` to omit the field.
 * @returns the booted context and the session that receives the records.
 */
async function boot(configLines: readonly string[] = [], projectRoot?: string | null): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-guard-loader-'))
  const project = join(root, 'projects', 'p1')
  await mkdir(join(project, 'tmp'), { recursive: true })
  await mkdir(join(project, 'workspace'), { recursive: true })
  await writeFile(join(project, 'tmp', 'installer'), ELF_BYTES)

  const declared = projectRoot === null ? undefined : projectRoot ?? join(root, 'projects')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(project)}`,
    "- name: '@deepseek-ai/dsh-sci-guard'",
    '  config:',
    ...declared === undefined ? [] : [`    projectRoot: ${JSON.stringify(declared)}`],
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
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-sci-guard', SciGuard],
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

  const ran: string[] = []
  ctx.tools.register(defineContentToolFixture({
    name: 'bash',
    description: 'Run one shell command.',
    parameters: { command: { type: 'string', required: true, description: 'The command line to run.' } },
    execute: (args) => {
      ran.push(args.command)
      return Promise.resolve([{ type: 'text' as const, text: `ran ${args.command}` }])
    },
  }))

  const session = ctx.sessions.create(SessionId('sci-guard-loader'), { meta: { cwd: project } })
  session.append('turn/start', { turn: 1 })
  const booted: Booted = {
    ctx,
    session,
    agent: { session } as unknown as Agent,
    project,
    ran,
    answer: 'rejected',
  }
  ctx.on('approval/request', () => Promise.resolve(booted.answer))
  return booted
}

/** Run one shell command line through the composed registry. */
function bash(booted: Booted, command: string): Promise<ToolExecutionResult> {
  return booted.ctx.tools.execute({
    signal: SIGNAL,
    callId: CallId(`call-${booted.session.events.length}`),
    name: 'bash',
    arguments: { command },
    agent: booted.agent,
  })
}

/** The text a tool result carries. */
function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

/** The authorization records the session log holds, in order. */
function authorizations(session: Session): SessionEvent<'sci/authorized'>[] {
  return session.events.filter((event): event is SessionEvent<'sci/authorized'> => event.type === 'sci/authorized')
}

describe('sci-guard real Loader composition through cordis.yml', () => {
  it('carries the chapter into the assembly and the question through the registry', async () => {
    const booted = await boot()

    const assembly = await booted.ctx.systemPrompt.assemble({})
    const result = await bash(booted, './tmp/installer')

    expect(assembly.sections.some(section => section.name === SECTION_IRREVERSIBLE_ACTIONS)).toBe(true)
    expect(booted.ran).toEqual([])
    expect(text(result)).toBe('Error: the user rejected tool "bash"')
    expect(authorizations(booted.session)).toHaveLength(1)
    expect(authorizations(booted.session)[0]?.data).toMatchObject({ category: 'execUnsigned', decision: 'denied' })
  }, 30_000)

  it('runs the command once the composed answerer grants it, and asks again next time', async () => {
    const booted = await boot()
    booted.answer = 'allowed-once'

    await bash(booted, './tmp/installer')
    await bash(booted, './tmp/installer')

    expect(booted.ran).toEqual(['./tmp/installer', './tmp/installer'])
    expect(authorizations(booted.session)).toHaveLength(2)
    expect(authorizations(booted.session).every(event => event.data.decision === 'approved')).toBe(true)
  }, 30_000)

  it('follows a switched-off category through the config', async () => {
    const booted = await boot(['    categories:', '      execUnsigned: false'])

    await bash(booted, './tmp/installer')

    expect(booted.ran).toEqual(['./tmp/installer'])
    expect(authorizations(booted.session)).toHaveLength(0)
  }, 30_000)

  it.each([
    { label: 'the project root is omitted', configLines: [], projectRoot: null, failure: /projectRoot/ },
    { label: 'the project root is relative', configLines: [], projectRoot: 'projects', failure: /must be an absolute path/ },
    { label: 'the probe cap is fractional', configLines: ['    probeMaxBytes: 1.5'], projectRoot: undefined, failure: /probeMaxBytes/ },
  ])('fails loading when $label', async ({ configLines, projectRoot, failure }) => {
    await expect(boot(configLines, projectRoot)).rejects.toThrow(failure)
  }, 30_000)
})
