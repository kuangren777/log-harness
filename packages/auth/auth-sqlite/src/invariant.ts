/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auth-sqlite`.
 * @module @deepseek-ai/dsh-auth-sqlite/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth-sqlite'

/** Cordis companion plugin name. */
export const name = 'auth-sqlite-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every relation this provider owns — a lockout holding,
 * a consumed token staying consumed, an attempt cap killing a challenge — is a
 * property of durable rows across separate calls, observable only by querying
 * the database, and the seam publishes no event stream to check one against.
 * The package's own suite asserts each relation by round-tripping the medium.
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
