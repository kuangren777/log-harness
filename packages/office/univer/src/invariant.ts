/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-office-univer`.
 * @module @deepseek-ai/dsh-office-univer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-office-univer'

/** Cordis companion plugin name. */
export const name = 'office-univer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every relation this package could assert lives in the
 * out-of-process Univer Gateway's own collaboration store, which this package
 * reads over HTTP rather than owns. The relations it does own — tool
 * registration and route registration — are effects, which the invariant rules
 * exclude.
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
