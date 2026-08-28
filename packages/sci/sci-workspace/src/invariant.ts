/**
 * Package-owned invariant for `@deepseek-ai/dsh-sci-workspace`.
 *
 * The relationship this asserts, over the authoritative `sci/fs-denied` stream
 * as it is appended: every refusal this package logs names a rule from the
 * vocabulary it publishes. `sci-audit` buckets refusals by rule and the web
 * stats page counts those buckets, so a rule outside {@link FS_DENIAL_RULES}
 * would leave a refusal counted under nothing while the model has already been
 * told the call was denied.
 * @module @deepseek-ai/dsh-sci-workspace/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { FS_DENIAL_RULES } from './decide.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-workspace'

/** Cordis companion plugin name. */
export const name = 'sci-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the rule vocabulary for one appended session event.
 * @param event - the event just appended to a session log.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'sci/fs-denied') return
  const { rule } = event.data
  if (FS_DENIAL_RULES.has(rule)) return
  fail(`sci/fs-denied logged rule ${JSON.stringify(rule)}, which is outside the vocabulary this package publishes`)
}

/** Install validation on the authoritative session-event stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('session/event', (_session: Session, event: SessionEvent) => { validateEvent(event, fail) }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
