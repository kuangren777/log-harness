// The tools' model-facing text is their contract with the model, so every
// rendering and refusal is pinned verbatim; calls go through the real tool
// registry so denial happens in the executor, and each mutation logs its
// ignorable event on the calling agent's session.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  COLLECT_TOOL,
  CREATE_TOOL,
  DELETE_TOOL,
  LIST_TOOL,
  RUN_TOOL,
  applyVariantTools,
  formatCollected,
  formatCreated,
  formatListing,
  formatRun,
  parseText,
  parseTimeout,
  parseVariantName,
} from '@deepseek-ai/dsh-camel-runtime'
import type { VariantEngine, VariantRecord } from '@deepseek-ai/dsh-camel-runtime'

const LIMITS = { maxVariants: 3, defaultTimeoutSeconds: 60, maxTimeoutSeconds: 600 }

const RECORD: VariantRecord = {
  name: 'a',
  project: 'projects/p1',
  sandboxID: 'sb-1',
  templateID: 'sci',
  createdAt: '2026-08-30T00:00:00.000Z',
  lastUsedAt: '2026-08-30T00:00:05.000Z',
}

describe('parsers', () => {
  it('trim a name and refuse a malformed one', () => {
    expect(parseVariantName(' a-1 ')).toBe('a-1')
    expect(() => parseVariantName('A')).toThrow('invalid variant name "A": use lowercase letters, digits, and dashes')
  })

  it('apply the default budget and refuse one outside the range', () => {
    expect(parseTimeout(undefined, LIMITS)).toBe(60)
    expect(parseTimeout(5, LIMITS)).toBe(5)
    for (const bad of [0, 1.5, 601]) expect(() => parseTimeout(bad, LIMITS)).toThrow('timeoutSeconds must be an integer between 1 and 600')
  })

  it('trim text and refuse blank text', () => {
    expect(parseText(' make ', 'command')).toBe('make')
    expect(() => parseText('  ', 'command')).toThrow('`command` must be a non-empty string')
  })
})

describe('renderers', () => {
  it('render a creation from a project and from a sibling', () => {
    expect(formatCreated(RECORD, 1, 3)).toBe('variant a created, copied from projects/p1; 1/3 slots used')
    expect(formatCreated({ ...RECORD, name: 'b', from: 'a' }, 2, 3)).toBe('variant b created, forked from variant a (projects/p1); 2/3 slots used')
  })

  it('render a run with stdout, and stderr only on failure', () => {
    expect(formatRun({ name: 'a', exitCode: 0, stdoutTail: 'ok\n', stderrTail: 'warn', durationMs: 12 })).toBe('variant a: exit 0 (12 ms)\nok')
    expect(formatRun({ name: 'a', exitCode: 2, stdoutTail: '', stderrTail: 'bad\n', durationMs: 3 })).toBe('variant a: exit 2 (3 ms)\nstderr: bad')
  })

  it('render a collection with the singular and plural', () => {
    expect(formatCollected({ name: 'a', path: 'out', destination: '/w/.sci/variants/a/collect/out', files: 1 })).toBe('collected 1 file from variant a:out into /w/.sci/variants/a/collect/out')
    expect(formatCollected({ name: 'a', path: '.', destination: '/w/.sci/variants/a/collect', files: 0 })).toBe('collected 0 files from variant a:. into /w/.sci/variants/a/collect')
  })

  it('render an empty and a populated listing', () => {
    expect(formatListing([], 3)).toBe('no variants; 0/3 slots used')
    expect(formatListing([
      { ...RECORD, state: 'running' },
      { ...RECORD, name: 'b', from: 'a', state: 'missing' },
    ], 3).split('\n')).toEqual([
      '2/3 slots used',
      '- a: projects/p1, running, last used 2026-08-30T00:00:05.000Z',
      '- b: projects/p1, missing, forked from a, last used 2026-08-30T00:00:05.000Z',
    ])
  })
})

type Result = { isError: boolean; content: { type: string; text?: string }[] }

interface Harness {
  ctx: Context
  agent: Agent
  session: Session
  engine: {
    create: ReturnType<typeof vi.fn>
    run: ReturnType<typeof vi.fn>
    collect: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    registry: { load: ReturnType<typeof vi.fn> }
  }
}

/** A tool registry with one agent over a fake engine. */
async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const engine = {
    create: vi.fn(),
    run: vi.fn(),
    collect: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    registry: { load: vi.fn().mockResolvedValue([RECORD]) },
  }
  applyVariantTools(ctx, engine as unknown as VariantEngine, LIMITS, '.sci/variants')
  const scope = ctx.plugin(() => {})
  const id = SessionId('camel-runtime-tools')
  const session = Session.create(id)
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
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent, session, engine }
}

function call(ctx: Context, agent: Agent | undefined, name: string, args: Record<string, unknown>): Promise<Result> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(name),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Result): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('create_variant', () => {
  it('creates, renders the slot count, and logs sci/variant-created', async () => {
    const h = await harness()
    h.engine.create.mockResolvedValue(RECORD)
    const result = await call(h.ctx, h.agent, CREATE_TOOL, { name: ' a ', project: ' projects/p1 ' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('variant a created, copied from projects/p1; 1/3 slots used')
    expect(h.engine.create).toHaveBeenCalledWith('a', 'projects/p1', undefined)
    expect(h.session.events.filter(event => event.type === 'sci/variant-created').map(event => [event.data, event.ignorable]))
      .toEqual([[{ name: 'a', project: 'projects/p1', sandboxID: 'sb-1' }, true]])
    await h.ctx.fiber.dispose()
  })

  it('forwards `from` and logs it', async () => {
    const h = await harness()
    h.engine.create.mockResolvedValue({ ...RECORD, name: 'b', from: 'a' })
    h.engine.registry.load.mockResolvedValue([RECORD, { ...RECORD, name: 'b' }])
    const result = await call(h.ctx, h.agent, CREATE_TOOL, { name: 'b', project: 'projects/p1', from: 'a' })
    expect(text(result)).toBe('variant b created, forked from variant a (projects/p1); 2/3 slots used')
    expect(h.engine.create).toHaveBeenCalledWith('b', 'projects/p1', 'a')
    expect(h.session.events.at(-1)?.data).toEqual({ name: 'b', project: 'projects/p1', sandboxID: 'sb-1', from: 'a' })
    await h.ctx.fiber.dispose()
  })

  it.each([
    { label: 'a bad name', args: { name: 'A', project: 'p' }, failure: 'invalid variant name "A"' },
    { label: 'a blank project', args: { name: 'a', project: ' ' }, failure: '`project` must be a non-empty string' },
    { label: 'a bad from', args: { name: 'a', project: 'p', from: 'B' }, failure: 'invalid variant name "B"' },
  ])('refuses $label in the executor without touching the engine', async ({ args, failure }) => {
    const h = await harness()
    const result = await call(h.ctx, h.agent, CREATE_TOOL, args)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(failure)
    expect(h.engine.create).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('reports the engine\'s refusal (the cap) as the tool error and logs nothing', async () => {
    const h = await harness()
    h.engine.create.mockRejectedValue(new Error('variant limit reached: 3/3 slots are in use (a, b, c); delete one with delete_variant before creating another'))
    const result = await call(h.ctx, h.agent, CREATE_TOOL, { name: 'd', project: 'projects/p1' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('variant limit reached: 3/3 slots are in use (a, b, c); delete one with delete_variant before creating another')
    expect(h.session.events.some(event => event.type === 'sci/variant-created')).toBe(false)
    await h.ctx.fiber.dispose()
  })

  it('refuses a caller with no agent session', async () => {
    const h = await harness()
    const result = await call(h.ctx, undefined, CREATE_TOOL, { name: 'a', project: 'p' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('create_variant requires an owning agent session')
    await h.ctx.fiber.dispose()
  })

  it('presents the call with the project as its location', async () => {
    const h = await harness()
    expect(h.ctx.tools.get(CREATE_TOOL)!.presentCall?.({ name: 'a', project: 'projects/p1' })).toEqual({ card: 'generic', title: 'Create variant a', locations: [{ path: 'projects/p1' }] })
    await h.ctx.fiber.dispose()
  })
})

describe('run_in_variant', () => {
  it('runs with the default budget, renders, and logs sci/variant-run', async () => {
    const h = await harness()
    h.engine.run.mockResolvedValue({ name: 'a', exitCode: 0, stdoutTail: 'rmse=0.1', stderrTail: '', durationMs: 42 })
    const result = await call(h.ctx, h.agent, RUN_TOOL, { name: 'a', command: ' make ' })
    expect(text(result)).toBe('variant a: exit 0 (42 ms)\nrmse=0.1')
    expect(h.engine.run).toHaveBeenCalledWith('a', 'make', 60)
    expect(h.session.events.at(-1)).toMatchObject({ type: 'sci/variant-run', data: { name: 'a', exitCode: 0, durationMs: 42 }, ignorable: true })
    await h.ctx.fiber.dispose()
  })

  it('passes an explicit budget and refuses one over the cap', async () => {
    const h = await harness()
    h.engine.run.mockResolvedValue({ name: 'a', exitCode: 1, stdoutTail: '', stderrTail: 'boom', durationMs: 1 })
    await call(h.ctx, h.agent, RUN_TOOL, { name: 'a', command: 'x', timeoutSeconds: 5 })
    expect(h.engine.run).toHaveBeenCalledWith('a', 'x', 5)
    const refused = await call(h.ctx, h.agent, RUN_TOOL, { name: 'a', command: 'x', timeoutSeconds: 601 })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('timeoutSeconds must be an integer between 1 and 600')
    await h.ctx.fiber.dispose()
  })

  it('refuses a blank command and a missing agent', async () => {
    const h = await harness()
    expect(text(await call(h.ctx, h.agent, RUN_TOOL, { name: 'a', command: ' ' }))).toContain('`command` must be a non-empty string')
    expect(text(await call(h.ctx, undefined, RUN_TOOL, { name: 'a', command: 'x' }))).toContain('run_in_variant requires an owning agent session')
    expect(h.engine.run).not.toHaveBeenCalled()
    expect(h.ctx.tools.get(RUN_TOOL)!.presentCall?.({ name: 'a', command: 'x' })).toEqual({ card: 'generic', title: 'Run in variant a', locations: [] })
    await h.ctx.fiber.dispose()
  })
})

describe('collect_variant', () => {
  it('collects the whole project when no path is given, and a trimmed path otherwise', async () => {
    const h = await harness()
    h.engine.collect.mockResolvedValue({ name: 'a', path: '.', destination: '/w/.sci/variants/a/collect', files: 2 })
    expect(text(await call(h.ctx, h.agent, COLLECT_TOOL, { name: 'a' }))).toBe('collected 2 files from variant a:. into /w/.sci/variants/a/collect')
    expect(h.engine.collect).toHaveBeenCalledWith('a', '.')
    await call(h.ctx, h.agent, COLLECT_TOOL, { name: 'a', path: ' out ' })
    expect(h.engine.collect).toHaveBeenLastCalledWith('a', 'out')
    await call(h.ctx, h.agent, COLLECT_TOOL, { name: 'a', path: '  ' })
    expect(h.engine.collect).toHaveBeenLastCalledWith('a', '.')
    expect(h.ctx.tools.get(COLLECT_TOOL)!.presentCall?.({ name: 'a', path: 'out' })).toEqual({ card: 'generic', title: 'Collect from variant a', locations: [{ path: 'out' }] })
    expect(h.ctx.tools.get(COLLECT_TOOL)!.presentCall?.({ name: 'a' })).toEqual({ card: 'generic', title: 'Collect from variant a', locations: [] })
    await h.ctx.fiber.dispose()
  })

  it('refuses a missing agent', async () => {
    const h = await harness()
    expect(text(await call(h.ctx, undefined, COLLECT_TOOL, { name: 'a' }))).toContain('collect_variant requires an owning agent session')
    await h.ctx.fiber.dispose()
  })
})

describe('delete_variant', () => {
  it('deletes, renders the freed slot count, and logs sci/variant-deleted', async () => {
    const h = await harness()
    h.engine.delete.mockResolvedValue(RECORD)
    h.engine.registry.load.mockResolvedValue([])
    const result = await call(h.ctx, h.agent, DELETE_TOOL, { name: 'a' })
    expect(text(result)).toBe('variant a deleted; 0/3 slots used')
    expect(h.session.events.at(-1)).toMatchObject({ type: 'sci/variant-deleted', data: { name: 'a', sandboxID: 'sb-1' }, ignorable: true })
    expect(h.ctx.tools.get(DELETE_TOOL)!.presentCall?.({ name: 'a' })).toEqual({ card: 'generic', title: 'Delete variant a', locations: [] })
    await h.ctx.fiber.dispose()
  })

  it('reports an unknown slot as the tool error and refuses a missing agent', async () => {
    const h = await harness()
    h.engine.delete.mockRejectedValue(new Error('variant "zzz" does not exist; list_variants shows the current slots'))
    expect(text(await call(h.ctx, h.agent, DELETE_TOOL, { name: 'zzz' }))).toContain('variant "zzz" does not exist')
    expect(text(await call(h.ctx, undefined, DELETE_TOOL, { name: 'a' }))).toContain('delete_variant requires an owning agent session')
    await h.ctx.fiber.dispose()
  })
})

describe('list_variants', () => {
  it('lists without needing an agent', async () => {
    const h = await harness()
    h.engine.list.mockResolvedValue([{ ...RECORD, state: 'paused' }, { ...RECORD, name: 'b', from: 'a', state: 'running' }])
    const result = await call(h.ctx, undefined, LIST_TOOL, {})
    expect(result.isError).toBe(false)
    expect(text(result).split('\n')).toEqual([
      '2/3 slots used',
      '- a: projects/p1, paused, last used 2026-08-30T00:00:05.000Z',
      '- b: projects/p1, running, forked from a, last used 2026-08-30T00:00:05.000Z',
    ])
    expect(h.ctx.tools.get(LIST_TOOL)!.presentCall?.({})).toEqual({ card: 'generic', title: 'List variants', locations: [] })
    await h.ctx.fiber.dispose()
  })
})

describe('disposal', () => {
  it('unregisters all five tools when the fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.inject(['tools'], (child: Context) => { applyVariantTools(child, {} as VariantEngine, LIMITS, '.sci/variants') })
    await fiber
    const names = [CREATE_TOOL, RUN_TOOL, COLLECT_TOOL, DELETE_TOOL, LIST_TOOL]
    for (const name of names) expect(ctx.tools.get(name)).toBeDefined()
    await fiber.dispose()
    for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
