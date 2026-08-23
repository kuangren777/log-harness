/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mail`.
 * @module @deepseek-ai/dsh-mail/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mail'

/** Cordis companion plugin name. */
export const name = 'mail-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the seam declares one asynchronous `send` and no event
 * stream or mutable data, so it owns no relation two observations could
 * disagree about. Delivery facts live in each provider's transport, and each
 * provider's suite pins them.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
