/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-dormice`.
 * @module @deepseek-ai/dsh-dormice/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-dormice'

/** Cordis companion plugin name. */
export const name = 'dormice-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: acquisition is one promise against a remote daemon
 * that owns the sandbox lifecycle, and this package holds no event stream or
 * mutable data of its own to cross-check it against.
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
