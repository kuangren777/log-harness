/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-model-selection`.
 * @module @deepseek-ai/dsh-client-ui-model-selection/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-model-selection'

/** Cordis companion plugin name. */
export const name = 'client-ui-model-selection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command contribution, the composer seat, and the
 * at-most-one contributed hint source are registrations whose disposal is
 * proven by the HMR-safety spec, and this package emits no cordis events. Its
 * mutable state is the per-session directories, each deleted by the scope that
 * minted it, and the single hint-source slot, whose second registration fails
 * loud rather than leaving the occupant to registration order.
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
