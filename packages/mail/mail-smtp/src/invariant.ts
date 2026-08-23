/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mail-smtp`.
 * @module @deepseek-ai/dsh-mail-smtp/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mail-smtp'

/** Cordis companion plugin name. */
export const name = 'mail-smtp-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the transport-reuse and credential-resolution
 * relations are observable only inside one `send` call against a transport
 * double, which the package suite drives; the package emits no event stream
 * and shares no mutable data an independent companion could watch.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
