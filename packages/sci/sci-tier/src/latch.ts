/**
 * The declare-before-fan-out latch (G1) and the refusal texts both tier gates
 * produce.
 *
 * A latch is one declared plan plus whether it has already been spent. The
 * authoritative copy lives in this process, because consumption has to be
 * ATOMIC: two `workflow` calls in one assistant message reach
 * `tools/pre-execute` before either one's `tool/result` is in the log, so a gate
 * that decided by re-reading the log would admit both. The log is the REPLAY
 * source instead — {@link rebuildLatch} recovers the same state after a restart,
 * from the last declaration and whatever fan-out followed it.
 * @module @deepseek-ai/dsh-sci-tier/latch
 */

import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SciPlanIdType } from '@deepseek-ai/dsh-sci-plan'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: merges `sci/plan-declared` into the event map this module reads.
import type {} from '@deepseek-ai/dsh-sci-plan'

/** One declared plan and whether a fan-out has already spent it. */
export interface FanoutLatch {
  /** Identity of the declaration this latch carries, from its `sci/plan-declared` event. */
  readonly planId: SciPlanIdType
  /** Whether a fan-out has already consumed the declaration. */
  consumed: boolean
}

/**
 * Recover one session's latch from its log.
 *
 * The last `sci/plan-declared` is the live declaration; any `tool/call` naming a
 * fan-out tool after it means that declaration was already spent. A refused call
 * is logged too and counts as spending, which is the safe direction: it costs
 * one extra declaration, where admitting an unauthorized fan-out costs a swarm.
 * @param events - the session's events in log order.
 * @param fanoutTools - the registered names that count as fanning out.
 * @param inFlightCallId - the call being decided right now, whose own `tool/call`
 *   is already in the log and must not be read as an earlier fan-out.
 * @returns the recovered latch, or `undefined` when the session declared no plan.
 */
export function rebuildLatch(
  events: readonly SessionEvent[],
  fanoutTools: ReadonlySet<string>,
  inFlightCallId?: CallId,
): FanoutLatch | undefined {
  let planId: SciPlanIdType | undefined
  let consumed = false
  for (const event of events) {
    if (event.type === 'sci/plan-declared') {
      planId = event.data.planId
      consumed = false
      continue
    }
    if (event.type !== 'tool/call' || planId === undefined) continue
    if (event.data.callId === inFlightCallId || !fanoutTools.has(event.data.name)) continue
    consumed = true
  }
  return planId === undefined ? undefined : { planId, consumed }
}

/**
 * The refusal a cluster-tier fan-out reads when no plan was ever declared.
 * @param toolName - the fan-out tool that was called.
 * @returns the refusal text, naming the tool that authorizes the call.
 */
export function denyUndeclared(toolName: string): string {
  return `${toolName} is refused: declare_research_plan has not been called in this session. `
    + 'Declare the swarm first — name each parallel line of work and what it produces — then call '
    + `${toolName} again.`
}

/**
 * The refusal a cluster-tier fan-out reads when the declared plan is spent.
 * @param toolName - the fan-out tool that was called.
 * @returns the refusal text, naming the tool that authorizes the next call.
 */
export function denyConsumed(toolName: string): string {
  return `${toolName} is refused: the declared plan was already consumed by an earlier fan-out. `
    + 'One declaration authorizes one fan-out, so call declare_research_plan again — with the shape of '
    + `this round — before calling ${toolName}.`
}

/**
 * The refusal a balanced-tier fan-out reads.
 * @param toolName - the fan-out tool that was called.
 * @returns the refusal text, naming the legitimate exit from the tier.
 */
export function denyBalanced(toolName: string): string {
  return `${toolName} is refused: this session runs in Solo mode, which has no subagent orchestration. `
    + 'Do the work directly in this thread; if it genuinely needs a swarm, deliver what one pass covers '
    + 'and call suggest_tier_upgrade with one sentence on what the swarm would add.'
}
