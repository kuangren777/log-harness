/**
 * Package-owned plan invariant for `@deepseek-ai/dsh-sci-plan`.
 *
 * The relationship this asserts, over the authoritative session log as it
 * grows: within one session, no two `sci/plan-declared` events share a
 * `planId`. The id is the token `sci-tier`'s G1 latch consumes exactly once, so
 * a repeated id would let one declaration authorize two fan-outs — the model
 * would declare once, fan out, and fan out again on a latch that looks fresh
 * because it carries an id the gate has already seen. A duplicate can only come
 * from a broken identity source or a caller that replayed a payload, neither of
 * which the tool's own path can produce, which is why the check lives at the
 * log rather than at the mint.
 * @module @deepseek-ai/dsh-sci-plan/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SciPlanDeclaredData } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-plan'

/** Cordis companion plugin name. */
export const name = 'sci-plan-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the unique-plan-identity rule for one appended event.
 * @param session - the session whose log received the event.
 * @param event - the event just appended.
 * @param fail - the package-attributed invariant reporter.
 */
export function validatePlanDeclared(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/plan-declared') return
  const declared: SciPlanDeclaredData = event.data
  const earlier = session.events.some(prior => prior.seq !== event.seq
    && prior.type === 'sci/plan-declared'
    && prior.data.planId === declared.planId)
  if (earlier) {
    fail(`plan id ${JSON.stringify(declared.planId)} was declared twice in one session; the fan-out latch consumes a plan id once, so a repeat would authorize a second fan-out`)
  }
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    validatePlanDeclared(session, event, fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
