// The tool's model-facing text is its contract with the model, so the result
// rendering and every refusal reason are pinned verbatim; the call is driven
// through the real tool registry so denial happens in the executor.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  FORK_TOOL,
  VARIANT_NAME,
  applyForkTool,
  describeForkTool,
  formatForkResult,
  parseForkRequest,
} from '@deepseek-ai/dsh-camel-runtime'
import type { ForkOutcome, ForkRunner } from '@deepseek-ai/dsh-camel-runtime'

const LIMITS = { maxVariants: 3, defaultTimeoutSeconds: 60, maxTimeoutSeconds: 600 }

describe('parseForkRequest', () => {
  it('trims names and commands, applies the default budget, and drops a blank collect', () => {
    expect(parseForkRequest({ variants: [{ name: ' a ', command: ' make ' }], collect: '  ' }, LIMITS))
      .toEqual({ variants: [{ name: 'a', command: 'make' }], timeoutSeconds: 60 })
  })

  it('keeps an explicit budget and collect directory', () => {
    expect(parseForkRequest({ variants: [{ name: 'a', command: 'make' }], collect: ' out ', timeoutSeconds: 5 }, LIMITS))
      .toEqual({ variants: [{ name: 'a', command: 'make' }], timeoutSeconds: 5, collect: 'out' })
  })

  it.each([
    { label: 'no variants', args: { variants: [] }, failure: 'fork_workspace requires at least one variant' },
    { label: 'too many variants', args: { variants: [1, 2, 3, 4].map(n => ({ name: `v${n}`, command: 'x' })) }, failure: 'fork_workspace accepts at most 3 variants per call; got 4' },
    { label: 'an uppercase name', args: { variants: [{ name: 'Alpha', command: 'x' }] }, failure: 'invalid variant name "Alpha": use lowercase letters, digits, and dashes' },
    { label: 'a name with a slash', args: { variants: [{ name: 'a/b', command: 'x' }] }, failure: 'invalid variant name "a/b"' },
    { label: 'a duplicate name', args: { variants: [{ name: 'a', command: 'x' }, { name: ' a', command: 'y' }] }, failure: 'duplicate variant name "a"' },
    { label: 'a blank command', args: { variants: [{ name: 'a', command: '  ' }] }, failure: 'variant "a": `command` must be a non-empty string' },
    { label: 'a zero budget', args: { variants: [{ name: 'a', command: 'x' }], timeoutSeconds: 0 }, failure: 'timeoutSeconds must be an integer between 1 and 600' },
    { label: 'a fractional budget', args: { variants: [{ name: 'a', command: 'x' }], timeoutSeconds: 1.5 }, failure: 'timeoutSeconds must be an integer between 1 and 600' },
    { label: 'an over-cap budget', args: { variants: [{ name: 'a', command: 'x' }], timeoutSeconds: 601 }, failure: 'timeoutSeconds must be an integer between 1 and 600' },
  ])('refuses $label (T6)', ({ args, failure }) => {
    expect(() => parseForkRequest(args, LIMITS)).toThrow(failure)
  })

  it('bounds a variant name at 64 characters', () => {
    expect(VARIANT_NAME.test('a'.repeat(64))).toBe(true)
    expect(VARIANT_NAME.test('a'.repeat(65))).toBe(false)
  })
})

describe('formatForkResult', () => {
  it('lists every variant with its exit code and result directory, quoting stdout and a failing stderr', () => {
    expect(formatForkResult({
      forkId: 'f1',
      variants: [
        { name: 'a', exitCode: 0, stdoutTail: 'rmse=0.12\n', stderrTail: 'warn: slow', resultDir: '/w/.sci/forks/f1/a' },
        { name: 'b', exitCode: 2, stdoutTail: '', stderrTail: 'no such file\n', resultDir: '/w/.sci/forks/f1/b' },
      ],
    }).split('\n')).toEqual([
      'fork f1: 2 variants',
      '- a: exit 0, results in /w/.sci/forks/f1/a',
      '    rmse=0.12',
      '- b: exit 2, results in /w/.sci/forks/f1/b',
      '    stderr: no such file',
    ])
  })

  it('uses the singular for one variant', () => {
    expect(formatForkResult({ forkId: 'f1', variants: [{ name: 'a', exitCode: 0, stdoutTail: '', stderrTail: '', resultDir: '/r' }] }))
      .toBe('fork f1: 1 variant\n- a: exit 0, results in /r')
  })
})

describe('describeForkTool', () => {
  it('names the results directory and the variant cap, which is what the model must get right', () => {
    const text = describeForkTool('.sci/forks', 8)
    expect(text).toContain('.sci/forks/<forkId>/<variant>/')
    expect(text).toContain('Up to 8 variants per call')
  })
})

/** A tool registry with one agent and the runner the tool was given. */
async function harness(run: ForkRunner): Promise<{ ctx: Context; agent: Agent; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  applyForkTool(ctx, run, LIMITS, '.sci/forks')
  const scope = ctx.plugin(() => {})
  const id = SessionId('camel-runtime-tool')
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
  return { ctx, agent, session }
}

type Result = { isError: boolean; content: { type: string; text?: string }[] }

function call(ctx: Context, agent: Agent | undefined, args: Record<string, unknown>): Promise<Result> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('fork'),
    name: FORK_TOOL,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const OUTCOME: ForkOutcome = {
  forkId: 'f1',
  snapshotID: 'snap-1',
  durationMs: 1234,
  variants: [
    { name: 'a', exitCode: 0, stdoutTail: 'ok', stderrTail: '', resultDir: '/w/.sci/forks/f1/a' },
    { name: 'b', exitCode: 1, stdoutTail: '', stderrTail: 'bad', resultDir: '/w/.sci/forks/f1/b' },
  ],
}

describe('fork_workspace through the tool registry', () => {
  it('hands the validated request to the engine, renders the outcome, and logs the ignorable completion event', async () => {
    const run = vi.fn<ForkRunner>().mockResolvedValue(OUTCOME)
    const { ctx, agent, session } = await harness(run)

    const result = await call(ctx, agent, { variants: [{ name: 'a', command: 'make a' }, { name: 'b', command: 'make b' }], collect: 'out' })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe([
      'fork f1: 2 variants',
      '- a: exit 0, results in /w/.sci/forks/f1/a',
      '    ok',
      '- b: exit 1, results in /w/.sci/forks/f1/b',
      '    stderr: bad',
    ].join('\n'))
    expect(run).toHaveBeenCalledWith({ variants: [{ name: 'a', command: 'make a' }, { name: 'b', command: 'make b' }], timeoutSeconds: 60, collect: 'out' })
    const completed = session.events.filter(event => event.type === 'sci/fork-completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]!.data).toEqual({ forkId: 'f1', snapshotID: 'snap-1', durationMs: 1234, variants: [{ name: 'a', exitCode: 0 }, { name: 'b', exitCode: 1 }] })
    expect(completed[0]!.ignorable).toBe(true)
    await ctx.fiber.dispose()
  })

  it('refuses an invalid request in the executor without calling the engine (T6)', async () => {
    const run = vi.fn<ForkRunner>()
    const { ctx, agent } = await harness(run)
    const result = await call(ctx, agent, { variants: [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('duplicate variant name "a"')
    expect(run).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('refuses a caller with no agent session', async () => {
    const run = vi.fn<ForkRunner>()
    const { ctx } = await harness(run)
    const result = await call(ctx, undefined, { variants: [{ name: 'a', command: 'x' }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('fork_workspace requires an owning agent session')
    expect(run).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports an engine failure as the tool error and logs no completion', async () => {
    const { ctx, agent, session } = await harness(() => Promise.reject(new Error('camel-runtime: agentenv POST /sandboxes failed with 503')))
    const result = await call(ctx, agent, { variants: [{ name: 'a', command: 'x' }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('agentenv POST /sandboxes failed with 503')
    expect(session.events.some(event => event.type === 'sci/fork-completed')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('presents the call with the variant count and the collect directory as its location', async () => {
    const { ctx } = await harness(vi.fn<ForkRunner>())
    const tool = ctx.tools.get(FORK_TOOL)!
    expect(tool.presentCall?.({ variants: [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }], collect: 'out' }))
      .toEqual({ card: 'generic', title: 'Fork workspace × 2', locations: [{ path: 'out' }] })
    expect(tool.presentCall?.({ variants: [{ name: 'a', command: 'x' }] })).toEqual({ card: 'generic', title: 'Fork workspace × 1', locations: [] })
    await ctx.fiber.dispose()
  })

  it('unregisters the tool when its fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.inject(['tools'], (child: Context) => { applyForkTool(child, vi.fn<ForkRunner>(), LIMITS, '.sci/forks') })
    await fiber
    expect(ctx.tools.get(FORK_TOOL)).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get(FORK_TOOL)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
