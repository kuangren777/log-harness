/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mail-file`.
 * @module @deepseek-ai/dsh-mail-file/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mail-file'

/** Cordis companion plugin name. */
export const name = 'mail-file-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the mailbox line format and the owner-only file mode
 * are observable only by reading the file back after a write, which the
 * package suite does; no in-process event stream or mutable data relates two
 * observations here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
