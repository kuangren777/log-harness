/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-sci-search`.
 * @module @deepseek-ai/dsh-client-ui-sci-search/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-sci-search'

/** Cordis companion plugin name. */
export const name = 'client-ui-sci-search-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: all three registrations are effect-owned with
 * disposal proven by this package's plugin spec, the one store handle is
 * created inside `apply` (so its instance dies with the fiber), and the
 * search history lives on the host rather than in any cache here — this
 * package owns no cross-plugin mutable state and emits no cordis events.
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
