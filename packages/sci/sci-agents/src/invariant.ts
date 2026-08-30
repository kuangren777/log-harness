/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sci-agents`.
 * @module @deepseek-ai/dsh-sci-agents/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-agents'

/** Cordis companion plugin name. */
export const name = 'sci-agents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no session state, no projection, and
 * no durable table. Its one write goes through the settings seam, whose own
 * companion checks the layering, and everything it reads is a fold over a log
 * another package owns — the relations worth asserting are properties of the
 * pure folds in `src/stats.ts` and `src/permissions.ts`, which `tests/` asserts
 * directly. There is no runtime stream here for an observer to watch.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
