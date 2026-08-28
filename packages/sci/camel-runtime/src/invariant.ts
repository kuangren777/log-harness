/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-camel-runtime`.
 *
 * The relationship this asserts over the session log: within one session, no
 * two `sci/fork-completed` events share a `forkId`. A fork id names the result
 * directory the model reads back, so a repeated id would mean two forks wrote
 * into one directory and the model can no longer tell whose files it is reading.
 * @module @deepseek-ai/dsh-camel-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SciForkCompletedData } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-camel-runtime'

/** Cordis companion plugin name. */
export const name = 'camel-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the unique-fork-id rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateForkCompleted(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/fork-completed') return
  const completed: SciForkCompletedData = event.data
  const earlier = session.events.some(prior => prior.seq !== event.seq
    && prior.type === 'sci/fork-completed'
    && prior.data.forkId === completed.forkId)
  if (earlier) {
    fail(`fork ${JSON.stringify(completed.forkId)} completed twice in one session; a fork id names one result directory`)
  }
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validateForkCompleted(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
