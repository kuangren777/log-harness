// Proves the tier is real, Loader-composed configurability and not a hand-built
// ctx.plugin() suite: a cordis.yml booted through the real Loader mounts the
// tool registry, the prompt layer, the session store, and the three modules this
// package ships — the tier layer, its `./suggest` half, and the host-plane fork
// service — and everything the package owns appears from that composition alone.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as SciTier from '../src/index.ts'
import * as SciTierSuggest from '../src/suggest.ts'
import * as SciTierResolve from '../src/resolve.ts'
import SciTierForkService from '../src/fork.ts'
import { RESOLVE_TOOL, SECTION_TIER_AUTO, SECTION_TIER_BALANCED, SUGGEST_TOOL } from '../src/index.ts'

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
  readonly session: Session
  readonly agent: Agent
  readonly ran: string[]
}

/**
 * Boot a cordis.yml carrying the given tier config block, then open one session.
 * @param configLines - indented config lines for the `dsh-sci-tier` entry.
 * @param extraRows - additional top-level rows for the composition.
 * @returns the booted context and the session the tier layer recorded itself on.
 */
async function boot(configLines: readonly string[], extraRows: readonly string[] = []): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-tier-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-sci-tier'",
    '  config:',
    ...configLines,
    ...extraRows,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-sci-tier', SciTier],
    ['@deepseek-ai/dsh-sci-tier/suggest', SciTierSuggest],
    ['@deepseek-ai/dsh-sci-tier/resolve', SciTierResolve],
    ['@deepseek-ai/dsh-sci-tier/fork', SciTierForkService],
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
    name: 'workflow',
    description: 'Fixture standing in for the workflow tool.',
    parameters: { note: { type: 'string', description: 'Ignored.' } },
    execute: () => {
      ran.push('workflow')
      return Promise.resolve([{ type: 'text' as const, text: 'ran workflow' }])
    },
  }))

  const id = SessionId('sci-tier-loader')
  const session = ctx.sessions.create(id, { meta: { agentPreset: 'sci-balanced' } })
  const scope = ctx.plugin(() => {})
  const agent: Agent = {
    id,
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
  return { ctx, session, agent, ran }
}

/** Run one tool call through the composed registry. */
function call(booted: Booted, name: string, args: unknown = {}): Promise<ToolExecutionResult> {
  return booted.ctx.tools.execute({
    signal: SIGNAL,
    callId: CallId(`call-${booted.session.events.length}`),
    name,
    arguments: args,
    agent: booted.agent,
  })
}

/** The text a tool result carries. */
function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('sci-tier real Loader composition through cordis.yml', () => {
  it('carries the balanced section, the guard, and the tier record out of one config', async () => {
    const booted = await boot(
      ['    tier: balanced', '    fanoutTools: [workflow]'],
      ["- name: '@deepseek-ai/dsh-sci-tier/suggest'"],
    )

    const assembly = await booted.ctx.systemPrompt.assemble({})
    const denied = await call(booted, 'workflow')
    const suggested = await call(booted, SUGGEST_TOOL, { reason: 'six vendors need independent reading' })

    expect(assembly.sections.some(section => section.name === SECTION_TIER_BALANCED)).toBe(true)
    expect(booted.ran).toEqual([])
    expect(text(denied)).toContain('Solo mode')
    expect(suggested.isError).toBe(false)
    expect(booted.session.events.filter(event => event.type.startsWith('sci/')).map(event => event.type))
      .toEqual(['sci/tier-resolved', 'sci/tool-denied', 'sci/tier-upgrade-suggested'])
    expect(booted.session.events[0]?.data).toEqual({ tier: 'balanced', presetName: 'sci-balanced' })
  }, 30_000)

  it('carries the cluster gate, and forks a session through the composed service', async () => {
    const booted = await boot(
      ['    tier: cluster', '    fanoutTools: [workflow]'],
      ["- name: '@deepseek-ai/dsh-sci-tier/fork'"],
    )

    const denied = await call(booted, 'workflow')
    const forked = booted.ctx.sciTierFork.fork({ sessionId: booted.session.id, tier: 'cluster' })

    expect(booted.ran).toEqual([])
    expect(text(denied)).toContain('declare_research_plan')
    expect(forked.ok).toBe(true)
    if (!forked.ok) return
    expect(booted.ctx.sessions.get(forked.value.sessionId)?.header.parentSession).toBe(booted.session.id)
  }, 30_000)

  it('carries the auto section, the resolution lock, and the resolve tool out of one config', async () => {
    const booted = await boot(
      ['    tier: auto', '    fanoutTools: [workflow]'],
      ["- name: '@deepseek-ai/dsh-sci-tier/resolve'"],
    )

    const assembly = await booted.ctx.systemPrompt.assemble({})
    const unresolved = await call(booted, 'workflow')
    const resolved = await call(booted, RESOLVE_TOOL, { tier: 'cluster', reason: 'six corpora need parallel close reading' })
    const undeclared = await call(booted, 'workflow')

    expect(assembly.sections.some(section => section.name === SECTION_TIER_AUTO)).toBe(true)
    expect(booted.ran).toEqual([])
    expect(text(unresolved)).toContain('resolve_tier')
    expect(resolved.isError).toBe(false)
    expect(text(undeclared)).toContain('declare_research_plan')
    expect(booted.session.events.filter(event => event.type.startsWith('sci/')).map(event => event.type))
      .toEqual(['sci/tool-denied', 'sci/tier-resolved', 'sci/tool-denied'])
  }, 30_000)

  it.each([
    { label: 'the tier is missing', configLines: ['    fanoutTools: [workflow]'], failure: /tier/ },
    { label: 'the tier is not one of the three', configLines: ['    tier: ultra'], failure: /tier/ },
    { label: 'a fan-out name is not a string', configLines: ['    tier: cluster', '    fanoutTools: [3]'], failure: /fanoutTools/ },
  ])('fails loading when $label', async ({ configLines, failure }) => {
    await expect(boot(configLines)).rejects.toThrow(failure)
  }, 30_000)
})
