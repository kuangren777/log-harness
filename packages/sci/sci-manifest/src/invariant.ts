/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sci-manifest`.
 * @module @deepseek-ai/dsh-sci-manifest/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-manifest'

/** Cordis companion plugin name. */
export const name = 'sci-manifest-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: these validators are pure functions over values their
 * callers supply; the package owns no event stream, registry, or mutable
 * runtime data to relate. The owning gates (`sci-workspace`, `sci-deliver`)
 * register the invariants over the decisions they make with these results.
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
