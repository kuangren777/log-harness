/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-camel-runtime`.
 *
 * The relationship this asserts over the session log: a variant name is live
 * from its `sci/variant-created` until its `sci/variant-deleted`, and no
 * second `sci/variant-created` for that name appears while it is live. The
 * registry refuses such a creation; this companion checks the committed
 * result at the log, so a bypassing caller or a registry write that lost the
 * race is caught where it would leave two sandboxes behind one slot.
 * @module @deepseek-ai/dsh-camel-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-camel-runtime'

/** Cordis companion plugin name. */
export const name = 'camel-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the one-live-creation-per-name rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateVariantCreated(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/variant-created') return
  const created = event.data
  let live = false
  for (const prior of session.events) {
    if (prior.seq >= event.seq) break
    if (prior.type === 'sci/variant-created' && prior.data.name === created.name) live = true
    else if (prior.type === 'sci/variant-deleted' && prior.data.name === created.name) live = false
  }
  if (live) {
    fail(`variant ${JSON.stringify(created.name)} was created twice in one session without a deletion in between; one slot name owns one sandbox`)
  }
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateVariantCreated(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
