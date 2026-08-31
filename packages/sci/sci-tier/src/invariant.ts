/**
 * Package-owned tier invariant for `@deepseek-ai/dsh-sci-tier`.
 *
 * The relationship this asserts, over the authoritative session log as it grows:
 * a session whose `sci/tier-resolved` says `balanced` never carries a SUCCEEDING
 * call to a fan-out tool. The tier is the user's decision about how much compute
 * this session may spend, and both of the things that enforce it — the missing
 * tool in the preset and `ctx.tools.guard()` — sit inside one process's
 * composition. A successful fan-out in a balanced session means the composition
 * was assembled without the lock, and the log is where that is visible no matter
 * which of the two failed.
 *
 * A refused call is deliberately not a violation: the model may attempt a
 * fan-out, and the `tool/call` recording the attempt is followed by an error
 * result. The invariant reads the RESULT, so it separates a gate that worked
 * from a gate that was not there.
 *
 * The fan-out names are {@link DEFAULT_FANOUT_TOOLS}, not the mounted
 * `Config.fanoutTools`: an invariant companion is installed once per process and
 * reads a log that may carry sessions from other compositions, so it checks the
 * delegation tools this repository ships. A deployment that renames its fan-out
 * tools keeps the two runtime gates, which read its own configuration.
 * @module @deepseek-ai/dsh-sci-tier/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { DEFAULT_FANOUT_TOOLS } from './config.ts'
import { rebuildResolvedTier } from './latch.ts'
// Type-only: merges the tier events this companion reads.
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-tier'

/** Cordis companion plugin name. */
export const name = 'sci-tier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The fan-out names this companion recognises. */
const FANOUT_TOOLS: ReadonlySet<string> = new Set(DEFAULT_FANOUT_TOOLS)

/**
 * Whether one session is currently resolved to the balanced tier: its LAST
 * `sci/tier-resolved` names `balanced`. The last record decides because the
 * auto composition raises a session from balanced to cluster by appending a
 * second one, after which a fan-out is exactly what the session may do.
 * @param events - the session's events in log order.
 * @returns whether the latest resolution is `balanced`.
 */
function isBalanced(events: readonly SessionEvent[]): boolean {
  return rebuildResolvedTier(events) === 'balanced'
}

/**
 * The tool name one earlier call in the same session requested.
 * @param events - the session's events in log order.
 * @param callId - the call the result answers.
 * @returns the requested tool's registered name, or `undefined` when no call carries that id.
 */
function calledToolName(events: readonly SessionEvent[], callId: CallId): string | undefined {
  const call = events.find(event => event.type === 'tool/call' && event.data.callId === callId)
  return call?.type === 'tool/call' ? call.data.name : undefined
}

/**
 * Assert the balanced-tier rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateToolResult(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'tool/result') return
  const block = event.data.message.content[0]
  if (block.isError === true) return
  const toolName = calledToolName(session.events, block.toolCallId)
  if (toolName === undefined || !FANOUT_TOOLS.has(toolName)) return
  if (!isBalanced(session.events)) return
  fail(`tool ${JSON.stringify(toolName)} fanned out successfully in a session resolved to the balanced tier, where no fan-out tool is mounted and tools.guard() denies every one of them`)
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateToolResult(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
