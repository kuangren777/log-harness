/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auth`.
 * @module @deepseek-ai/dsh-auth/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth'

/** Cordis companion plugin name. */
export const name = 'auth-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package declares the seam and exports pure
 * functions — rule evaluation, password hashing, token minting — whose
 * relations hold within one call and are pinned by unit tests. It owns no
 * event stream and no mutable data, and the durable relations the seam implies
 * (a digest matching its session row, an attempt cap holding) belong to
 * whichever provider owns that storage.
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
