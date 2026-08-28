/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sci-profile`.
 * @module @deepseek-ai/dsh-sci-profile/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-profile'

/** Cordis companion plugin name. */
export const name = 'sci-profile-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package contributes one system-prompt section,
 * disposed with the fiber by the registry whose own package audits that
 * relation, and its remaining artifacts — the bundle patch and the two preset
 * compositions — are static files consumed before any session exists, so there
 * is no authoritative stream in which they could disagree with anything. The
 * roster relation that COULD drift (a charter naming a persona
 * `@deepseek-ai/dsh-sci-plan` does not define) is refused at load by
 * `assertCompleteRoster`, which is the earliest resolvable point.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
