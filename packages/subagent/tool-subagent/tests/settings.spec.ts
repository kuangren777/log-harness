/** The per-instance `RuntimeConfig` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** A minimal parent Agent: the capture provider never reads more than its id. */
function fakeAgent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

interface Bench {
  ctx: Context
  requests: SubagentStartRequest[]
  settingsFiber: Fiber | undefined
  pluginFiber: Fiber
}

/**
 * Mount the real plugin over a request-capturing provider, with or without a
 * settings service, so both the stored-section and entry-only paths run the
 * shipping `execute()`.
 * @param config - the composition entry beyond `provider`.
 * @param options - `settings: false` composes no settings service; `doc` seeds
 *   the stored document before the plugin registers its namespace.
 * @returns the booted context, the captured start requests, and both fibers.
 */
async function bench(
  config: Omit<tool.Config, 'provider'> = {},
  options: { settings?: boolean; doc?: Record<string, unknown> } = {},
): Promise<Bench> {
  const requests: SubagentStartRequest[] = []
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'capture',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async (request) => {
      requests.push(request)
      return {
        id: SessionId(`capture-child-${requests.length}`),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const }),
        dispose: async () => {},
      }
    },
  })
  let settingsFiber: Fiber | undefined
  if (options.settings !== false) {
    settingsFiber = ctx.plugin(MemorySettings, { doc: options.doc ?? {} })
    await settingsFiber.await()
  }
  const pluginFiber = ctx.plugin(tool, { provider: 'capture', ...config })
  await pluginFiber.await()
  return { ctx, requests, settingsFiber, pluginFiber }
}

let callCounter = 0
function callSubagent(ctx: Context, name = 'subagent') {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`settings-call-${++callCounter}`),
    name,
    arguments: { description: 'd', prompt: 'p', run_in_background: false },
    agent: fakeAgent(),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('tool-subagent runtime settings', () => {
  it('names the section after the model-facing tool, in namespace spelling', () => {
    expect(String(tool.subagentSettingsNamespace('subagent'))).toBe('subagent')
    expect(String(tool.subagentSettingsNamespace('subagent_researcher'))).toBe('subagent-researcher')
    expect(() => tool.subagentSettingsNamespace('Subagent')).toThrow(TypeError)
  })

  it('publishes the composition entry as the section base a configuration surface reads', async () => {
    const booted = await bench({
      toolName: 'subagent_researcher',
      agentOptions: { provider: 'entry', model: 'entry-model', maxTokens: 1024 },
      toolFilter: { deny: ['bash'] },
      maxDepth: 'provider-managed',
    })

    const descriptor = booted.ctx.settings.describe()
      .find(row => String(row.ns) === 'subagent-researcher')

    expect(descriptor?.base).toEqual({
      enabled: true,
      model: { provider: 'entry', model: 'entry-model' },
      toolFilter: { deny: ['bash'] },
    })
    expect(descriptor?.value).toEqual(descriptor?.base)
    await booted.ctx.fiber.dispose()
  })

  it('omits a base route when the entry names no complete provider/model pair', async () => {
    const booted = await bench({ agentOptions: { model: 'entry-model' }, maxDepth: 'provider-managed' })

    const descriptor = booted.ctx.settings.describe().find(row => String(row.ns) === 'subagent')

    expect(descriptor?.base).toEqual({ enabled: true })
    await booted.ctx.fiber.dispose()
  })

  it('serves a stored model route to the next delegation without re-registering the tool', async () => {
    const booted = await bench({
      agentOptions: { provider: 'entry', model: 'entry-model', maxTokens: 1024 },
      maxDepth: 'provider-managed',
    })
    await callSubagent(booted.ctx)
    expect(booted.requests[0]?.agentOptions).toEqual({ provider: 'entry', model: 'entry-model', maxTokens: 1024 })

    await booted.ctx.settings.update(tool.subagentSettingsNamespace('subagent'), {
      model: { provider: 'stored', model: 'stored-model' },
    })

    await callSubagent(booted.ctx)
    // The entry's token budget is not part of the stored route, so it stands.
    expect(booted.requests[1]?.agentOptions).toEqual({ provider: 'stored', model: 'stored-model', maxTokens: 1024 })
    expect(booted.ctx.tools.schemas().filter(schema => schema.name === 'subagent')).toHaveLength(1)
    await booted.ctx.fiber.dispose()
  })

  it('sends a stored route on an entry that configured no agent options at all', async () => {
    const booted = await bench({ maxDepth: 'provider-managed' }, {
      doc: { subagent: { model: { provider: 'stored', model: 'stored-model' } } },
    })

    await callSubagent(booted.ctx)

    expect(booted.requests[0]?.agentOptions).toEqual({ provider: 'stored', model: 'stored-model' })
    await booted.ctx.fiber.dispose()
  })

  it('refuses every delegation while disabled, and starts no child', async () => {
    const booted = await bench({ maxDepth: 'provider-managed' })
    await booted.ctx.settings.update(tool.subagentSettingsNamespace('subagent'), { enabled: false })

    const refused = await callSubagent(booted.ctx)

    expect(refused.isError).toBe(true)
    // The registry renders a thrown refusal as `Error: <message>`; the copy
    // itself is pinned verbatim so a product surface can show it unchanged.
    expect(text(refused)).toBe(`Error: ${tool.SUBAGENT_DISABLED_MESSAGE}`)
    expect(tool.SUBAGENT_DISABLED_MESSAGE).toBe('该智能体已停用，请在「智能体」页启用后再委派。')
    expect(booted.requests).toHaveLength(0)
    // The tool stays advertised: the refusal is what the model observes.
    expect(booted.ctx.tools.schemas().map(schema => schema.name)).toContain('subagent')

    await booted.ctx.settings.update(tool.subagentSettingsNamespace('subagent'), { enabled: true })
    const allowed = await callSubagent(booted.ctx)
    expect(allowed.isError).toBe(false)
    expect(booted.requests).toHaveLength(1)
    await booted.ctx.fiber.dispose()
  })

  it('unions stored denials with the entry list and drops the duplicate', async () => {
    const booted = await bench({ toolFilter: { deny: ['bash'] }, maxDepth: 'provider-managed' }, {
      doc: { subagent: { toolFilter: { deny: ['bash', 'web_search'] } } },
    })

    await callSubagent(booted.ctx)

    expect(booted.requests[0]?.toolFilter).toEqual({ deny: ['bash', 'web_search'] })
    await booted.ctx.fiber.dispose()
  })

  it('keeps the entry denial when the stored section names only an allow list', async () => {
    const booted = await bench({ toolFilter: { allow: ['read'], deny: ['bash'] }, maxDepth: 'provider-managed' }, {
      doc: { subagent: { toolFilter: { allow: ['grep'] } } },
    })

    await callSubagent(booted.ctx)

    // A whitelist replaces (intersecting two whitelists would empty the child),
    // while the entry's denial floor survives.
    expect(booted.requests[0]?.toolFilter).toEqual({ allow: ['grep'], deny: ['bash'] })
    await booted.ctx.fiber.dispose()
  })

  it('sends an allow-only filter when neither layer denies anything', async () => {
    const booted = await bench({ toolFilter: { allow: ['read'] }, maxDepth: 'provider-managed' }, {
      doc: { subagent: { toolFilter: { allow: ['grep'] } } },
    })

    await callSubagent(booted.ctx)

    // No empty `deny` may reach the child: `restrict()` reads it as a mask.
    expect(booted.requests[0]?.toolFilter).toEqual({ allow: ['grep'] })
    expect(booted.requests[0]?.toolFilter).not.toHaveProperty('deny')
    await booted.ctx.fiber.dispose()
  })

  it('sends no filter when neither layer names one', async () => {
    const booted = await bench({ maxDepth: 'provider-managed' }, { doc: { subagent: { enabled: true } } })

    await callSubagent(booted.ctx)

    expect(booted.requests[0]?.toolFilter).toBeUndefined()
    await booted.ctx.fiber.dispose()
  })

  it('runs on the composition entry when the deployment composes no settings service', async () => {
    const booted = await bench({
      agentOptions: { provider: 'entry', model: 'entry-model' },
      toolFilter: { deny: ['bash'] },
      maxDepth: 'provider-managed',
    }, { settings: false })

    const result = await callSubagent(booted.ctx)

    expect(result.isError).toBe(false)
    expect(booted.requests[0]?.agentOptions).toEqual({ provider: 'entry', model: 'entry-model' })
    expect(booted.requests[0]?.toolFilter).toEqual({ deny: ['bash'] })
    await booted.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const booted = await bench({
      agentOptions: { provider: 'entry', model: 'entry-model' },
      maxDepth: 'provider-managed',
    }, { doc: { subagent: { model: { provider: 'stored', model: 'stored-model' } } } })
    await callSubagent(booted.ctx)
    expect(booted.requests[0]?.agentOptions).toMatchObject({ provider: 'stored' })

    await booted.settingsFiber?.dispose()

    await callSubagent(booted.ctx)
    expect(booted.requests[1]?.agentOptions).toEqual({ provider: 'entry', model: 'entry-model' })
    await booted.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const booted = await bench({ maxDepth: 'provider-managed' })
    expect(booted.ctx.settings.describe().map(row => String(row.ns))).toContain('subagent')

    await booted.pluginFiber.dispose()

    expect(booted.ctx.settings.describe().map(row => String(row.ns))).not.toContain('subagent')
    await booted.ctx.fiber.dispose()
  })
})

describe('tool-subagent runtime settings over the real child boundary', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('restricts the spawned child with the union of the entry and stored denials', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const root = mkdtempSync(path.join(tmpdir(), 'dsh-tool-subagent-settings-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks, {})
    const settingsFiber = ctx.plugin(MemorySettings, {
      doc: { subagent: { toolFilter: { deny: ['job_kill'] } } },
    })
    await settingsFiber.await()
    await ctx.plugin(tool, {
      provider: 'spawn',
      backgroundMode: 'continuable',
      toolFilter: { deny: ['job_output'] },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('child answer')]))
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })

    const started = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('settings-restrict'),
      name: 'subagent',
      arguments: { description: 'scoped work', prompt: 'dig in' },
      agent: parent,
    })
    expect(started.isError).toBe(false)
    const childId = /^started subagent (\S+)$/.exec(text(started))?.[1]
    expect(childId).toBeDefined()
    await vi.waitFor(() => {
      expect(ctx.agents.get(SessionId(childId!))).toBeUndefined()
    }, { timeout: 5_000 })

    const loaded = await ctx.sessionPersistence.load(SessionId(childId!))
    const header = loaded.events.findLast(event => event.type === 'request/header')
    expect(header).toBeDefined()
    const names = (header?.data as { header: { tools?: { name: string }[] } }).header.tools?.map(schema => schema.name) ?? []
    // `restrict()` is the enforcement point: both denials removed the tool from
    // the child's own request, and the parent still advertises them.
    expect(names).not.toContain('job_output')
    expect(names).not.toContain('job_kill')
    expect(names).toContain('subagent')
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(
      expect.arrayContaining(['job_output', 'job_kill']),
    )
    await ctx.fiber.dispose()
  })
})
