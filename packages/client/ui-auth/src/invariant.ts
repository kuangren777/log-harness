/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-auth`.
 * @module @deepseek-ai/dsh-client-ui-auth/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-auth'

/** Cordis companion plugin name. */
export const name = 'client-ui-auth-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a browser surface that calls one wire channel and
 * renders what it answered — it emits no cordis events, and the sign-in state
 * it shows is the Host's, held nowhere else.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
