/**
 * Package-owned credit invariant for `@deepseek-ai/dsh-sci-credit`.
 *
 * The relationship this asserts, over the authoritative session log as it
 * grows: within one session, no two `sci/credit-charged` records share a
 * `requestId`. That id is the gate's idempotency key — the ledger's `ref` is
 * `req:<requestId>` under a UNIQUE index, and a replay is answered from the
 * existing row rather than charged again. Two records carrying one id in one
 * session therefore mean two metered model calls collapsed onto a single ledger
 * row: the tenant paid for one of them, and if the two prices differ, for the
 * wrong one. A duplicate can only come from a broken id mint or a caller that
 * replayed a payload, neither of which the metering path itself can produce,
 * which is why the check lives at the log rather than at the mint.
 *
 * The converse relationship — every `assistant/message` carrying `usage` has
 * exactly one `sci/credit-charged` beside it — is deliberately NOT asserted
 * here, because the live stream cannot decide it. The charge is appended after
 * the response it prices, a call that ends in an error finish reports usage
 * without producing an `assistant/message` at all, and an undelivered charge
 * legitimately waits in `$DSH_HOME/.sci/credit-spool.jsonl` across a process
 * restart. The gate's UNIQUE `ref` is the authority for that direction; a
 * reconciliation that reads the ledger and the log together is what checks it,
 * not an assertion over one growing log.
 * @module @deepseek-ai/dsh-sci-credit/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SciCreditChargedData } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-credit'

/** Cordis companion plugin name. */
export const name = 'sci-credit-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the unique-charge-identity rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateCreditCharged(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/credit-charged') return
  const charged: SciCreditChargedData = event.data
  const earlier = session.events.some(prior => prior.seq !== event.seq
    && prior.type === 'sci/credit-charged'
    && prior.data.requestId === charged.requestId)
  if (earlier) {
    fail(`credit request id ${JSON.stringify(charged.requestId)} was charged twice in one session; the gate keys its ledger on that id, so the second call collapsed onto the first call's charge`)
  }
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateCreditCharged(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
