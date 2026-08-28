/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sci-remote-hosts`.
 * @module @deepseek-ai/dsh-sci-remote-hosts/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-remote-hosts'

/** Cordis companion plugin name. */
export const name = 'sci-remote-hosts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no session state and no projection.
 * Its only durable relationship is between the managed block's bytes and the
 * roster they encode, which is a property of two pure functions and is asserted
 * over generated inputs by `tests/managed-block-roundtrip.spec.ts`; the file
 * itself lives in the sandbox, where no runtime stream reports an edit for an
 * observer to check the relation against.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
