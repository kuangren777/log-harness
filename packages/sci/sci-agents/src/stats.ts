/**
 * The pure projections behind the roster's numbers and the delegation log.
 *
 * Every figure here is folded from a durable session log or from the audit
 * table that projects one; nothing is estimated and nothing is cached. Keeping
 * the folds pure is what makes them testable without a running agent, and it
 * is the same discipline `@deepseek-ai/dsh-sci-audit` applies to its own
 * projection: one event in, one fact out, no clock and no I/O.
 * @module @deepseek-ai/dsh-sci-agents/src/stats
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor, subagentTimingProjectionDefinition } from '@deepseek-ai/dsh-subagent'
import type { TimingState } from '@deepseek-ai/dsh-subagent'
import type { AgentCall, AgentCallStatus } from './types.ts'

/**
 * Epoch milliseconds of the first instant of `now`'s month, in the host's own
 * time zone — the boundary "this month" means to whoever is reading the page.
 * @param now - the instant the reading happens at.
 * @returns the month's first millisecond.
 */
export function monthStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/**
 * Read `outputTokens` out of one tool result's `meta`.
 *
 * `meta` is tool-private and opaque to the core, so this reads structurally and
 * accepts nothing it cannot verify: only a finite non-negative number under
 * `usage.outputTokens` becomes a token figure. `@deepseek-ai/dsh-tool-subagent`
 * attaches no `meta` today, which is why the column is optional all the way to
 * the card rather than defaulting to zero.
 * @param meta - the `tool/result` event's `meta`, if any.
 * @returns the output tokens, or `undefined` when the result carried none.
 */
export function metaOutputTokens(meta: unknown): number | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const usage: unknown = (meta as Record<string, unknown>).usage
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return undefined
  const tokens: unknown = (usage as Record<string, unknown>).outputTokens
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? tokens : undefined
}

/**
 * Read the delegated task out of a `tool/call`'s raw arguments.
 *
 * The arguments are the model's own JSON string, so a malformed one is normal
 * rather than exceptional: the row still belongs in the log, with an empty
 * task, because the call happened.
 * @param args - the `tool/call` event's `arguments` string.
 * @returns the `description` the model sent, or `''` when it sent none.
 */
export function callTask(args: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return ''
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ''
  const description: unknown = (parsed as Record<string, unknown>).description
  return typeof description === 'string' ? description : ''
}

/** How the log says one delegation ended. */
function resultStatus(event: SessionEvent<'tool/result'>): AgentCallStatus {
  return event.data.error !== undefined || event.data.message.content[0].isError === true ? 'error' : 'ok'
}

/**
 * Collect one session's delegations through one registered tool name.
 *
 * `durationMs` is deliberately NOT filled here. The parent's own
 * call-to-result interval measures the dispatch, which for a `continuable`
 * delegation is milliseconds while the child works for minutes;
 * {@link attachChildTimings} supplies the child's real turn time instead.
 * @param sessionId - the session the events belong to.
 * @param events - that session's raw log, in ascending seq order.
 * @param toolName - the persona's registered delegation tool.
 * @returns one row per delegation, in log order.
 */
export function delegationCalls(
  sessionId: string,
  events: readonly SessionEvent[],
  toolName: string,
): AgentCall[] {
  const results = new Map<string, SessionEvent<'tool/result'>>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    results.set(String(event.data.message.source.callId), event)
  }
  const calls: AgentCall[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || event.data.name !== toolName) continue
    const callId = String(event.data.callId)
    const result = results.get(callId)
    const outputTokens = result === undefined ? undefined : metaOutputTokens(result.data.meta)
    calls.push({
      ts: event.time,
      sessionId,
      callId,
      task: callTask(event.data.arguments),
      status: result === undefined ? 'running' : resultStatus(result),
      ...outputTokens === undefined ? {} : { outputTokens },
    })
  }
  return calls
}

/** One child session's durable identity and the time it has spent on its own turns. */
export interface ChildRun {
  /** The delegation `description` its parent started it with. */
  readonly label: string
  /** The charter the child runs under, when its descriptor declares one. */
  readonly persona?: string
  /** Milliseconds of the child's own turns, open turn included. */
  readonly durationMs: number
  /** Web retrievals the child made, and how many repeated an earlier one. */
  readonly retrieval: { readonly calls: number; readonly repeats: number }
}

/**
 * Count one child's web retrievals and the repeats among them. Two calls repeat
 * when they name the same tool with the same arguments text; the arguments are
 * compared as the model wrote them, so a re-ordered JSON object counts as new —
 * the figure is a floor, never an overstatement.
 * @param events - the child session's raw log, in ascending seq order.
 * @param webTools - registered names of the tools that consult the web.
 * @returns the call count and the repeat count.
 */
export function retrievalFigures(events: readonly SessionEvent[], webTools: readonly string[]): ChildRun['retrieval'] {
  const seen = new Set<string>()
  let calls = 0
  let repeats = 0
  for (const event of events) {
    if (event.type !== 'tool/call' || !webTools.includes(event.data.name)) continue
    calls += 1
    const key = `${event.data.name}\u0000${event.data.arguments}`
    if (seen.has(key)) repeats += 1
    else seen.add(key)
  }
  return { calls, repeats }
}

/**
 * Fold one child session's log to its creation label and its turn time.
 *
 * The timing is `@deepseek-ai/dsh-subagent`'s own `subagentTiming` projection,
 * applied here rather than re-derived: it is the definition that knows a fork
 * seed's ancestor turns are not this child's work.
 * @param events - the child session's raw log, in ascending seq order.
 * @param webTools - registered names of the tools that consult the web, for the retrieval figures.
 * @returns the run, or `undefined` when the log carries no usable descriptor.
 */
export function childRun(events: readonly SessionEvent[], webTools: readonly string[] = []): ChildRun | undefined {
  let descriptor: ReturnType<typeof foldSubagentDescriptor>
  try {
    descriptor = foldSubagentDescriptor(events)
  } catch {
    // A descriptor this runtime cannot parse identifies no child; the session
    // is simply not one of ours, which is not an error for a read-only page.
    return undefined
  }
  if (descriptor === undefined || descriptor.label === undefined) return undefined
  let state: TimingState = subagentTimingProjectionDefinition.init()
  for (const event of events) state = subagentTimingProjectionDefinition.apply(state, event)
  const view = subagentTimingProjectionDefinition.wire.view(state)
  const open = view.active === undefined ? 0 : Math.max(0, view.active.through - view.active.since)
  return {
    label: descriptor.label,
    ...descriptor.mode === 'continuable' && descriptor.persona !== undefined
      ? { persona: descriptor.persona }
      : {},
    durationMs: view.settledMs + open,
    retrieval: retrievalFigures(events, webTools),
  }
}

/**
 * Attach each delegation's child turn time, matching by creation label.
 *
 * The label is the only link the parent's log and the child's descriptor share:
 * `tool/call.arguments.description` becomes the descriptor's `label`. A label
 * two calls share is therefore ambiguous, and ambiguity is resolved by
 * consumption in log order — the first call takes the first unclaimed child —
 * with `charter` narrowing the candidates to children this persona started, so
 * a sibling persona given the same task cannot lend its timing.
 * @param calls - one persona's delegations, in log order.
 * @param runs - the delegating session's children, in creation order.
 * @param charter - the persona text the mounted row binds, when one is known.
 * @returns the same rows, with `durationMs` and the retrieval figures where a child was matched.
 */
export function attachChildTimings(
  calls: readonly AgentCall[],
  runs: readonly ChildRun[],
  charter: string | undefined,
): AgentCall[] {
  const unclaimed = runs.filter(run =>
    charter === undefined || run.persona === undefined || run.persona === charter)
  const taken = new Set<number>()
  return calls.map((call) => {
    if (call.status === 'running') return call
    const index = unclaimed.findIndex((run, at) => !taken.has(at) && run.label === call.task)
    if (index === -1) return call
    taken.add(index)
    // `unclaimed[index]` exists: findIndex returned its position.
    const run = unclaimed[index] as ChildRun
    return { ...call, durationMs: run.durationMs, retrievalCalls: run.retrieval.calls, retrievalRepeats: run.retrieval.repeats }
  })
}

/**
 * Reduce one persona's delegations to the three card figures.
 * @param calls - every delegation to this persona since {@link monthStart}.
 * @param monthCalls - the count the audit projection reports, which stands even
 *   when a session's log is no longer readable.
 * @returns the figures, with the two optional ones absent when nothing reported them.
 */
export function summarizeCalls(
  calls: readonly AgentCall[],
  monthCalls: number,
): { monthCalls: number; avgDurationMs?: number; monthTokens?: number } {
  const durations = calls.flatMap(call => call.durationMs === undefined ? [] : [call.durationMs])
  const tokens = calls.flatMap(call => call.outputTokens === undefined ? [] : [call.outputTokens])
  return {
    monthCalls,
    ...durations.length === 0
      ? {}
      : { avgDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) },
    ...tokens.length === 0 ? {} : { monthTokens: tokens.reduce((sum, value) => sum + value, 0) },
  }
}
