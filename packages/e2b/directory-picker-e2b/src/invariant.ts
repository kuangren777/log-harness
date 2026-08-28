/**
 * Package-owned invariant companion for the sandbox directory-picker backend.
 * @module @deepseek-ai/dsh-host-directory-picker-e2b/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-directory-picker-e2b'

/** Cordis companion plugin name. */
export const name = 'host-directory-picker-e2b-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each list/create is one stateless round trip to the
 * sandbox, whose filesystem is the authoritative state, and this backend keeps
 * no cache or event stream to cross-check it against.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the sandbox directory-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
