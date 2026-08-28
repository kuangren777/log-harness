/**
 * Package-owned authorization invariant for `@deepseek-ai/dsh-sci-guard`.
 *
 * The relationship this asserts, over the authoritative session log as it
 * grows: every `sci/authorized` record is preceded, in the same session, by the
 * complete `approval/asked` → `approval/decided` pair for the tool call it
 * names. The record's whole value is that a human decided; `sci-audit` counts
 * these rows as authorizations and the web stats page reports them as such, so
 * a record without its pair would present a decision nobody was asked to make.
 *
 * The check is on the committed log rather than on the gate that writes it,
 * which is what makes it worth having: a future producer that recorded an
 * approval it inferred, cached, or assumed — instead of one the seam settled —
 * is caught here even though every gate believed it was correct.
 * @module @deepseek-ai/dsh-sci-guard/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
// Type-only: merges the approval audit events this companion reads.
import type {} from '@deepseek-ai/dsh-user-approval'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-guard'

/** Cordis companion plugin name. */
export const name = 'sci-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The approval request one call was asked about, before a given log position.
 * @param events - the session's events in log order.
 * @param before - the seq the search stops at, exclusive.
 * @param callId - the tool call the question was about.
 * @returns the request id of the earliest matching `approval/asked`, or `undefined` when the call was never asked about.
 */
function askedRequestFor(
  events: readonly SessionEvent[],
  before: number,
  callId: CallId,
): ApprovalRequestId | undefined {
  for (const event of events) {
    if (event.seq >= before) break
    if (event.type === 'approval/asked' && event.data.callId === callId) return event.data.id
  }
  return undefined
}

/**
 * Whether one approval request reached a decision before a given log position.
 * @param events - the session's events in log order.
 * @param before - the seq the search stops at, exclusive.
 * @param id - the approval request to look for.
 * @returns whether a matching `approval/decided` is already in the log.
 */
function decidedBefore(events: readonly SessionEvent[], before: number, id: ApprovalRequestId): boolean {
  return events.some(event => event.seq < before && event.type === 'approval/decided' && event.data.id === id)
}

/**
 * Assert the asked-and-decided rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateAuthorized(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/authorized') return
  const { callId } = event.data
  const requestId = askedRequestFor(session.events, event.seq, callId)
  if (requestId === undefined) {
    fail(`sci/authorized names call ${JSON.stringify(callId)}, which no earlier approval/asked in this session put to the user`)
    return
  }
  if (decidedBefore(session.events, event.seq, requestId)) return
  fail(`sci/authorized names call ${JSON.stringify(callId)}, whose approval request ${JSON.stringify(requestId)} has no earlier approval/decided in this session`)
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateAuthorized(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
