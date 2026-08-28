// One composed tier layer plus one agent to call tools through it, shared by
// the gate, suggestion, and invariant suites. The registries are the real ones:
// a gate that only refuses inside a hand-built stub proves nothing about the
// registry's own pre-dispatch waterfall, which is where both gates live.
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Config } from '../src/config.ts'

/** Cancellation every harness call shares; no case exercises cancellation. */
const SIGNAL = new AbortController().signal

/** One tool result as the registry returns it. */
export interface ToolResult {
  readonly isError: boolean
  readonly content: { type: string; text?: string }[]
}

/** A composed tier layer with one live session and the agent that calls through it. */
export interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  /** Command lines every mounted fixture tool actually ran, in call order. */
  readonly ran: string[]
}

/** How one harness composes its registries around the tier layer. */
export interface HarnessOptions {
  /** Fixture tools mounted BEFORE the tier layer, as the balanced load check sees them. */
  readonly toolsBefore?: readonly string[]
  /** Fixture tools mounted AFTER the tier layer, which only a guard can stop. */
  readonly toolsAfter?: readonly string[]
  /** Session id, so a case that restarts the process can reopen the same log. */
  readonly sessionId?: string
  /** Seed events, standing in for a log this process did not write. */
  readonly seed?: readonly SessionEvent[]
  /** Agent preset the session was composed from. */
  readonly agentPreset?: string
}

/** Register one fixture tool that records the calls it received. */
function mountFixture(ctx: Context, name: string, ran: string[]): void {
  ctx.tools.register(defineContentToolFixture({
    name,
    description: `Fixture standing in for the ${name} tool.`,
    parameters: { note: { type: 'string', description: 'Ignored; the fixture records the call.' } },
    execute: () => {
      ran.push(name)
      return Promise.resolve([{ type: 'text' as const, text: `ran ${name}` }])
    },
  }))
}

/**
 * Compose the tier layer over real registries and open one session on it.
 * @param config - the tier configuration to mount.
 * @param options - which fixture tools to mount on either side of it, and the session to open.
 * @returns the composed context, session, agent, and the fixtures' call record.
 */
export async function harness(config: Config, options: HarnessOptions = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const ran: string[] = []
  for (const name of options.toolsBefore ?? []) mountFixture(ctx, name, ran)
  const SciTier = await import('../src/index.ts')
  await ctx.plugin(SciTier, config)
  for (const name of options.toolsAfter ?? []) mountFixture(ctx, name, ran)

  const id = SessionId(options.sessionId ?? 'sci-tier-session')
  const session = ctx.sessions.create(id, {
    ...options.seed === undefined ? {} : { seed: [...options.seed] },
    meta: {
      ...options.seed === undefined ? {} : { seedLength: options.seed.length },
      ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
    },
  })
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

/**
 * Run one tool call through the composed registry.
 * @param booted - the composed harness.
 * @param name - the tool to call.
 * @param callId - the call identity, which the log records and the latch rebuild excludes.
 * @param args - the model arguments.
 * @param withAgent - whether the call carries the owning agent.
 * @returns the registry's normalized result.
 */
export function call(
  booted: Harness,
  name: string,
  callId: string,
  args: unknown = {},
  withAgent = true,
): Promise<ToolResult> {
  return booted.ctx.tools.execute({
    signal: SIGNAL,
    callId: CallId(callId),
    name,
    arguments: args,
    ...withAgent ? { agent: booted.agent } : {},
  })
}

/**
 * Log the `tool/call` the agent loop would have written before dispatching.
 * @param booted - the composed harness.
 * @param name - the tool being called.
 * @param callId - the call identity.
 */
export function logCall(booted: Harness, name: string, callId: string): void {
  booted.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: CallId(callId),
    name,
    arguments: '{}',
  })
}

/**
 * Join the text blocks of one tool result.
 * @param result - the registry's normalized result.
 * @returns the concatenated text.
 */
export function text(result: ToolResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Every event of one type in a session's log.
 * @param session - the session to read.
 * @param type - the event type to select.
 * @returns the matching events, in log order.
 */
export function eventsOf(session: Session, type: string): SessionEvent[] {
  return session.events.filter(event => event.type === type)
}
