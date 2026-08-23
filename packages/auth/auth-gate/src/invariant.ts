/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auth-gate`.
 * @module @deepseek-ai/dsh-auth-gate/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth-gate'

/** Cordis companion plugin name. */
export const name = 'auth-gate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no durable data and no event stream.
 * Its relations are between one request and the provider's rows — a cookie
 * resolving to the account its session was issued for, a token minted only by
 * a verified second factor — and both sides of each live in `ctx.auth`, whose
 * provider owns the storage the relation would have to be checked against.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
