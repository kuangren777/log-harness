/**
 * Package-owned delivery invariant for `@deepseek-ai/dsh-sci-deliver`.
 *
 * The relationship this asserts, over the authoritative session log as it
 * grows: within one session, no bundle manifest is delivered twice. Delivering
 * a manifest opens a live workbench on the user's side, so a second delivery of
 * the same manifest would put a second, diverging workbench in front of the
 * user for one document. Both delivery channels are supposed to refuse it —
 * that is step three of the validation chain — and this companion checks the
 * committed result rather than the gate, so a bypassing caller, a widened
 * predicate, or a spool round that skipped the chain is caught at the log.
 *
 * Ordinary files are deliberately exempt: delivering the same report twice is
 * wasteful, not wrong, and a user simply sees two cards.
 * @module @deepseek-ai/dsh-sci-deliver/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SciDeliveredData } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-deliver'

/** Cordis companion plugin name. */
export const name = 'sci-deliver-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the once-per-session manifest rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateDelivered(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/delivered') return
  const delivered: SciDeliveredData = event.data
  if (delivered.kind === 'file') return
  const earlier = session.events.some(prior => prior.seq !== event.seq
    && prior.type === 'sci/delivered'
    && prior.data.path === delivered.path)
  if (earlier) {
    fail(`${delivered.kind} manifest ${JSON.stringify(delivered.path)} was delivered twice in one session; a manifest opens a live workbench and may be delivered once`)
  }
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateDelivered(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
