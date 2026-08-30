// The four `sci.agents` endpoints over the REAL settings sections the six
// `tool-subagent` rows register: what the roster reports, what a configuration
// gesture writes, what the delegation log reads out of a corpus, and what the
// model catalog offers. The delegation tools are the shipping plugin, so a
// permission this suite writes is the same value `ctx.tools.restrict()` would
// receive; only the corpus, the preset roster, and the model directory are
// stood in for, and each of those is consumed through one interface method.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import { BUNDLED_AGENTS_ROOT, loadPersonas } from '@deepseek-ai/dsh-sci-profile'
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import * as toolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { subagentSettingsNamespace } from '@deepseek-ai/dsh-tool-subagent'
import AgentsRuntime, { AGENTS_NAMESPACE, DEFAULT_CALL_LIMIT, SERVICE_KEY } from '@deepseek-ai/dsh-sci-agents'
import type { Config } from '@deepseek-ai/dsh-sci-agents'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { childLog, toolCall, toolResult } from './log.ts'

const CHARTERS = loadPersonas(BUNDLED_AGENTS_ROOT)
const SCOUT = CHARTERS.find(persona => persona.name === 'scout')

/** One session the stood-in corpus serves. */
interface CorpusEntry {
  readonly id: string
  readonly parent?: string
  readonly events: readonly SessionEvent[]
  /** Whether reading this log fails, as an archived one does. */
  readonly unreadable?: boolean
}

interface Bench {
  readonly ctx: Context
  readonly standingKeyFor: ReturnType<typeof vi.fn>
}

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Compose the roster over the real settings seam and the real delegation tools.
 * @param options - the corpus to serve, the model directory to publish, which
 *   personas the preset mounts, the stored settings document, whether the audit
 *   projection is composed, and which charter directory to read.
 * @returns the booted context and the preset-mount spy.
 */
async function bench(options: {
  corpus?: readonly CorpusEntry[]
  providers?: readonly { id: string; models?: readonly string[]; error?: unknown }[]
  mounted?: readonly string[]
  doc?: Record<string, unknown>
  audit?: readonly { sessionId: string; ts: number; kind: string; toolName?: string }[] | false
  agentsRoot?: string
} = {}): Promise<Bench> {
  const corpus = options.corpus ?? []
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'capture',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.reject(new Error('this suite never starts a child')),
  })
  await ctx.plugin(MemorySettings, { doc: options.doc ?? {} }).await()

  const standingKeyFor = vi.fn(() => Promise.resolve('standing-key'))
  ctx.provide('agentPresets', { standingKeyFor } as never)
  ctx.provide('sessionQuery', {
    listSessions: () => Promise.resolve(corpus.map(entry => ({
      header: {
        id: SessionId(entry.id),
        ...entry.parent === undefined ? {} : { parentSession: SessionId(entry.parent) },
      },
      live: false,
      persisted: true,
    }))),
    readSession: (sessionId: string) => {
      const entry = corpus.find(item => item.id === sessionId)
      return entry === undefined || entry.unreadable === true
        ? Promise.reject(new Error(`no log for ${sessionId}`))
        : Promise.resolve({ events: entry.events })
    },
  } as never)
  ctx.provide('llm', {
    listProviders: () => (options.providers ?? []).map(provider => ({ id: provider.id, name: provider.id })),
    listModels: (id: string) => {
      const provider = (options.providers ?? []).find(entry => entry.id === id)
      // The directory rejects with whatever the adapter threw, Error or not.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is one of the two paths under test
      if (provider?.error !== undefined) return Promise.reject(provider.error)
      return Promise.resolve((provider?.models ?? []).map(model => ({ provider: id, id: model, name: model })))
    },
  } as never)
  if (options.audit !== false) {
    const rows = options.audit ?? []
    ctx.provide('sciAudit', {
      auditRows: (sessionId: string) => rows.filter(row => row.sessionId === sessionId),
    } as never)
  }

  for (const persona of options.mounted ?? PERSONA_NAMES) {
    await ctx.plugin(toolSubagent, {
      provider: 'capture',
      toolName: subagentToolName(persona as never),
      maxDepth: 'provider-managed',
      persona: CHARTERS.find(entry => entry.name === persona)?.charter ?? persona,
    })
  }
  // Resolve through the real schema, exactly as the Loader does for a
  // composition row, so the bench runs on the shipped defaults and states only
  // what it varies. The cast is the schema's own contract: it accepts the
  // partial document a `cordis.yml` row carries.
  await ctx.plugin(AgentsRuntime, AgentsRuntime.Config({
    ...options.agentsRoot === undefined ? {} : { agentsRoot: options.agentsRoot },
  } as Config))
  return { ctx, standingKeyFor }
}

/** A charter directory whose documents declare no `display` block. */
function plainCharterRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sci-agents-charters-'))
  roots.push(root)
  for (const persona of PERSONA_NAMES) {
    writeFileSync(
      join(root, `${persona}.md`),
      ['---', `name: ${persona}`, `summary: What ${persona} does.`, '---', '', `Charter of ${persona}.`, ''].join('\n'),
    )
  }
  return root
}

describe('sci-agents composition', () => {
  it('publishes itself under the service key and namespace consumers import', async () => {
    const booted = await bench()

    expect(SERVICE_KEY).toBe('sciAgents')
    expect(AGENTS_NAMESPACE).toBe('sci.agents')
    expect(DEFAULT_CALL_LIMIT).toBe(50)
    expect(booted.ctx.sciAgents).toBeInstanceOf(AgentsRuntime)
  })

  it('defaults to the cluster preset, the bundled charters, and the shipped tool groups', () => {
    expect(AgentsRuntime.Config({} as Config)).toEqual({
      preset: 'sci-cluster',
      agentsRoot: BUNDLED_AGENTS_ROOT,
      webTools: ['web_search', 'web_fetch', 'literature_search'],
      codeTools: ['bash', 'write', 'edit', 'univer_execute'],
      libraryTools: ['library_add', 'citations_add'],
    })
  })

  it('refuses to mount over a charter directory that is not a complete roster', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sci-agents-empty-'))
    roots.push(root)
    await expect(bench({ agentsRoot: root })).rejects.toThrow(/roster is missing/)
  })
})

describe('roster', () => {
  it('reports the six personas with the card copy their documents carry', async () => {
    const booted = await bench()

    const { agents } = await booted.ctx.sciAgents.roster()

    expect(agents.map(agent => agent.persona)).toEqual([...PERSONA_NAMES])
    expect(agents.map(agent => agent.toolName)).toEqual(PERSONA_NAMES.map(name => subagentToolName(name)))
    expect(agents[0]).toMatchObject({
      persona: 'researcher',
      toolName: 'subagent_researcher',
      name: '检索体',
      role: '来源搜集 · 引用溯源',
      icon: 'web',
      enabled: true,
      permissions: { web: true, code: true, writeLibrary: true },
      stats: { monthCalls: 0 },
    })
    // `plotter` is the persona no plan icon reaches, so its row carries none.
    expect(agents.find(agent => agent.persona === 'plotter')).not.toHaveProperty('icon')
    expect(agents[0]).not.toHaveProperty('model')
  })

  it('ensures the preset that mounts the delegation tools before reading settings', async () => {
    const booted = await bench()

    await booted.ctx.sciAgents.roster()

    expect(booted.standingKeyFor).toHaveBeenCalledWith('sci-cluster')
  })

  it('falls back to the charter\'s own name and summary when a document declares no display block', async () => {
    const booted = await bench({ agentsRoot: plainCharterRoot() })

    const { agents } = await booted.ctx.sciAgents.roster()

    expect(agents[0]).toMatchObject({
      persona: 'researcher',
      name: 'researcher',
      role: 'What researcher does.',
      summary: 'What researcher does.',
    })
  })

  it('reports a persona the composition mounts no tool for as unable to accept work', async () => {
    const booted = await bench({ mounted: ['scout'] })

    const { agents } = await booted.ctx.sciAgents.roster()

    expect(agents.find(agent => agent.persona === 'scout')?.enabled).toBe(true)
    expect(agents.find(agent => agent.persona === 'writer')?.enabled).toBe(false)
  })

  it('reports the stored route and the permissions the stored denials encode', async () => {
    const booted = await bench({
      doc: {
        'subagent-scout': {
          enabled: false,
          model: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
          toolFilter: { deny: ['web_search', 'web_fetch', 'literature_search'] },
        },
      },
    })

    const scout = (await booted.ctx.sciAgents.roster()).agents.find(agent => agent.persona === 'scout')

    expect(scout).toMatchObject({
      enabled: false,
      model: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
      permissions: { web: false, code: true, writeLibrary: true },
    })
  })

  it('counts this month\'s delegations from the audit projection and times them from the children', async () => {
    const now = Date.now()
    const lastMonth = new Date(now)
    lastMonth.setMonth(lastMonth.getMonth() - 1)
    const booted = await bench({
      corpus: [
        {
          id: 'parent',
          events: [
            toolCall(1, now, 'subagent_scout', { description: 'Find the methods file', prompt: 'p' }, 'c1'),
            toolResult(2, now + 10, 'c1'),
            toolCall(3, lastMonth.getTime(), 'subagent_scout', { description: 'Old work', prompt: 'p' }, 'c0'),
            toolResult(4, lastMonth.getTime() + 10, 'c0'),
          ],
        },
        {
          id: 'child',
          parent: 'parent',
          events: childLog('Find the methods file', SCOUT?.charter, [{ start: 1_000, end: 3_500 }]),
        },
      ],
      audit: [
        { sessionId: 'parent', ts: now, kind: 'tool-call', toolName: 'subagent_scout' },
        { sessionId: 'parent', ts: now, kind: 'tool-result', toolName: 'subagent_scout' },
        { sessionId: 'parent', ts: now, kind: 'tool-call', toolName: 'web_search' },
        { sessionId: 'parent', ts: lastMonth.getTime(), kind: 'tool-call', toolName: 'subagent_scout' },
      ],
    })

    const scout = (await booted.ctx.sciAgents.roster()).agents.find(agent => agent.persona === 'scout')

    // Only the `tool-call` row of THIS tool, inside this month.
    expect(scout?.stats).toEqual({ monthCalls: 1, avgDurationMs: 2_500 })
  })

  it('counts the rows it scanned when the deployment composes no audit projection', async () => {
    const now = Date.now()
    const booted = await bench({
      audit: false,
      corpus: [{
        id: 'parent',
        events: [
          toolCall(1, now, 'subagent_scout', { description: 'a', prompt: 'p' }, 'c1'),
          toolResult(2, now + 10, 'c1'),
          toolCall(3, now, 'subagent_scout', { description: 'b', prompt: 'p' }, 'c2'),
        ],
      }],
    })

    const scout = (await booted.ctx.sciAgents.roster()).agents.find(agent => agent.persona === 'scout')

    expect(scout?.stats).toEqual({ monthCalls: 2 })
  })

  it('skips a session the corpus lists but can no longer serve', async () => {
    const now = Date.now()
    const booted = await bench({
      audit: false,
      corpus: [
        { id: 'archived', events: [], unreadable: true },
        { id: 'parent', events: [toolCall(1, now, 'subagent_scout', { description: 'a' }, 'c1')] },
        // A child whose log carries no descriptor contributes no timing.
        { id: 'stranger', parent: 'parent', events: [toolCall(1, now, 'web_search', { description: 'x' })] },
      ],
    })

    const scout = (await booted.ctx.sciAgents.roster()).agents.find(agent => agent.persona === 'scout')

    expect(scout?.stats).toEqual({ monthCalls: 1 })
  })
})

describe('configure', () => {
  it('writes availability and the base route into the delegation tool\'s own section', async () => {
    const booted = await bench()

    const answer = await booted.ctx.sciAgents.configure({
      persona: 'scout',
      patch: { enabled: false, model: { provider: 'deepseek-official', model: 'deepseek-chat' } },
    })

    expect(answer.agent).toMatchObject({
      persona: 'scout',
      enabled: false,
      model: { provider: 'deepseek-official', model: 'deepseek-chat' },
    })
    // The value the delegation tool itself now resolves — one section, one truth.
    expect(booted.ctx.settings.get(subagentSettingsNamespace('subagent_scout'))).toMatchObject({
      enabled: false,
      model: { provider: 'deepseek-official', model: 'deepseek-chat' },
    })
  })

  it('turns a permission off by denying its whole tool group', async () => {
    const booted = await bench()

    const answer = await booted.ctx.sciAgents.configure({
      persona: 'scout',
      patch: { permissions: { web: false, code: true, writeLibrary: true } },
    })

    expect(answer.agent.permissions).toEqual({ web: false, code: true, writeLibrary: true })
    expect(booted.ctx.settings.get(subagentSettingsNamespace('subagent_scout')))
      .toMatchObject({ toolFilter: { deny: ['web_search', 'web_fetch', 'literature_search'] } })
  })

  it('removes the deny list when every permission goes back on', async () => {
    const booted = await bench({
      doc: { 'subagent-scout': { toolFilter: { deny: ['web_search', 'web_fetch', 'literature_search'] } } },
    })

    const answer = await booted.ctx.sciAgents.configure({
      persona: 'scout',
      patch: { permissions: { web: true, code: true, writeLibrary: true } },
    })

    expect(answer.agent.permissions).toEqual({ web: true, code: true, writeLibrary: true })
    expect(booted.ctx.settings.get(subagentSettingsNamespace('subagent_scout')))
      .not.toHaveProperty('toolFilter.deny')
  })

  it('leaves a denial this mapping does not own standing', async () => {
    const booted = await bench({ doc: { 'subagent-scout': { toolFilter: { deny: ['job_kill'] } } } })

    await booted.ctx.sciAgents.configure({
      persona: 'scout',
      patch: { permissions: { web: true, code: true, writeLibrary: false } },
    })

    expect(booted.ctx.settings.get(subagentSettingsNamespace('subagent_scout')))
      .toMatchObject({ toolFilter: { deny: ['job_kill', 'library_add', 'citations_add'] } })
  })

  it.each([
    { label: 'no toolFilter at all', section: { enabled: true } },
    { label: 'a toolFilter that only whitelists', section: { toolFilter: { allow: ['read'] } } },
  ])('starts the deny list from scratch when the user layer has $label', async ({ section }) => {
    const booted = await bench({ doc: { 'subagent-scout': section } })

    await booted.ctx.sciAgents.configure({
      persona: 'scout',
      patch: { permissions: { web: true, code: true, writeLibrary: false } },
    })

    expect(booted.ctx.settings.get(subagentSettingsNamespace('subagent_scout')))
      .toMatchObject({ toolFilter: { deny: ['library_add', 'citations_add'] } })
  })

  it('writes nothing for a patch that changed nothing, and still answers with the row', async () => {
    const booted = await bench()
    const before = booted.ctx.settings.describe().find(row => String(row.ns) === 'subagent-scout')?.revision

    const answer = await booted.ctx.sciAgents.configure({ persona: 'scout', patch: {} })

    expect(answer.agent.persona).toBe('scout')
    expect(booted.ctx.settings.describe().find(row => String(row.ns) === 'subagent-scout')?.revision).toBe(before)
  })

  it('refuses a persona no charter defines', async () => {
    const booted = await bench()

    await expect(booted.ctx.sciAgents.configure({ persona: 'omega', patch: { enabled: true } }))
      .rejects.toThrow(/no persona is named "omega"/)
  })

  it('refuses a persona the composition mounts no delegation tool for', async () => {
    const booted = await bench({ mounted: ['scout'] })

    await expect(booted.ctx.sciAgents.configure({ persona: 'writer', patch: { enabled: false } }))
      .rejects.toThrow(/mounts no delegation tool for "writer"/)
  })
})

describe('calls', () => {
  const now = Date.now()

  it('reads one persona\'s delegations newest first, with the child\'s own timing', async () => {
    const booted = await bench({
      corpus: [
        {
          id: 'parent',
          events: [
            toolCall(1, now - 1_000, 'subagent_scout', { description: 'First', prompt: 'p' }, 'c1'),
            toolResult(2, now - 900, 'c1'),
            toolCall(3, now, 'subagent_scout', { description: 'Second', prompt: 'p' }, 'c2'),
            toolResult(4, now + 5, 'c2', { isError: true }),
            toolCall(5, now + 10, 'subagent_writer', { description: 'Other persona', prompt: 'p' }, 'c3'),
          ],
        },
        {
          id: 'child',
          parent: 'parent',
          events: childLog('First', SCOUT?.charter, [{ start: 0, end: 4_200 }]),
        },
      ],
    })

    const { calls } = await booted.ctx.sciAgents.calls({ persona: 'scout' })

    expect(calls.map(call => call.callId)).toEqual(['c2', 'c1'])
    expect(calls[0]).toMatchObject({ status: 'error', task: 'Second', sessionId: 'parent' })
    expect(calls[1]).toMatchObject({ status: 'ok', task: 'First', durationMs: 4_200 })
  })

  it('times each of several children the same turn started', async () => {
    const booted = await bench({
      corpus: [
        {
          id: 'parent',
          events: [
            toolCall(1, now, 'subagent_scout', { description: 'Left', prompt: 'p' }, 'c1'),
            toolCall(2, now + 1, 'subagent_scout', { description: 'Right', prompt: 'p' }, 'c2'),
            toolResult(3, now + 2, 'c1'),
            toolResult(4, now + 3, 'c2'),
          ],
        },
        { id: 'left', parent: 'parent', events: childLog('Left', SCOUT?.charter, [{ start: 0, end: 1_100 }]) },
        { id: 'right', parent: 'parent', events: childLog('Right', SCOUT?.charter, [{ start: 0, end: 2_200 }]) },
      ],
    })

    const { calls } = await booted.ctx.sciAgents.calls({ persona: 'scout' })

    expect(calls.map(call => [call.task, call.durationMs])).toEqual([['Right', 2_200], ['Left', 1_100]])
  })

  it('caps the log at the requested limit', async () => {
    const events = [0, 1, 2].flatMap(index => [
      toolCall(index * 2 + 1, now + index, 'subagent_scout', { description: `d${index}` }, `c${index}`),
      toolResult(index * 2 + 2, now + index + 1, `c${index}`),
    ])
    const booted = await bench({ corpus: [{ id: 'parent', events }] })

    await expect(booted.ctx.sciAgents.calls({ persona: 'scout', limit: 2 }))
      .resolves.toMatchObject({ calls: [{ callId: 'c2' }, { callId: 'c1' }] })
    await expect(booted.ctx.sciAgents.calls({ persona: 'scout', limit: -5 }))
      .resolves.toEqual({ calls: [] })
  })

  it('refuses a persona no charter defines', async () => {
    const booted = await bench()

    await expect(booted.ctx.sciAgents.calls({ persona: 'omega' })).rejects.toThrow(/no persona is named "omega"/)
  })
})

describe('models', () => {
  it('offers every provider the host directory advertises', async () => {
    const booted = await bench({
      providers: [
        { id: 'deepseek-official', models: ['deepseek-chat', 'deepseek-reasoner'] },
        { id: 'empty-route', models: [] },
      ],
    })

    await expect(booted.ctx.sciAgents.models()).resolves.toEqual({
      providers: [{
        provider: 'deepseek-official',
        models: [{ model: 'deepseek-chat' }, { model: 'deepseek-reasoner' }],
      }],
      failures: [],
    })
  })

  it('reports a provider that did not answer and keeps the others choosable', async () => {
    const booted = await bench({
      providers: [
        { id: 'deepseek-official', models: ['deepseek-chat'] },
        { id: 'broken', error: new Error('endpoint refused') },
        { id: 'odd', error: 'not an Error' },
      ],
    })

    const catalog = await booted.ctx.sciAgents.models()

    expect(catalog.providers.map(provider => provider.provider)).toEqual(['deepseek-official'])
    expect(catalog.failures).toEqual([
      { provider: 'broken', message: 'endpoint refused' },
      { provider: 'odd', message: 'not an Error' },
    ])
  })
})
