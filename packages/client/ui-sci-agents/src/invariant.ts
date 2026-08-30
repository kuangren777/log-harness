/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-sci-agents`.
 * @module @deepseek-ai/dsh-client-ui-sci-agents/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-sci-agents'

/** Cordis companion plugin name. */
export const name = 'client-ui-sci-agents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the two registrations and the namespace mount are all
 * effect-owned with disposal proven by this package's plugin spec, the one
 * store handle is created inside `apply` (so its instance dies with the
 * fiber), and every agent fact on screen is re-read from the host rather than
 * cached across fibers — this package owns no cross-plugin mutable state and
 * emits no cordis events.
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
