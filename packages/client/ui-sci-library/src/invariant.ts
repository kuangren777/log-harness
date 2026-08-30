/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-sci-library`.
 * @module @deepseek-ai/dsh-client-ui-sci-library/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-sci-library'

/** Cordis companion plugin name. */
export const name = 'client-ui-sci-library-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: all four registrations plus the Remote mount are
 * effect-owned with disposal proven by this package's plugin spec, the one
 * store handle is created inside `apply` (so its instance dies with the
 * fiber), and every entry, tag, and file it draws lives on the host rather
 * than in any cache here — this package owns no cross-plugin mutable state
 * and emits no cordis events.
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
