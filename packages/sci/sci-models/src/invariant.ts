/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sci-models`.
 * @module @deepseek-ai/dsh-sci-models/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-models'

/** Cordis companion plugin name. */
export const name = 'sci-models-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the catalog is refreshed in memory and never persisted,
 * and the one decision it makes — refusing a model call — is a stream chunk, so
 * neither the session log nor any durable data carries a relation this
 * companion could read as it grows. The gate's own tenant table is the
 * authority for which models are open, and reconciling a VM against it is a
 * query across two processes rather than an assertion over one event stream.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
