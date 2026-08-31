/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-sci-conversation`.
 * @module @deepseek-ai/dsh-client-ui-sci-conversation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-sci-conversation'

/** Cordis companion plugin name. */
export const name = 'client-ui-sci-conversation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every slot contribution, the stylesheet, and the model
 * menu's price-hint source are effect-owned with disposal proven by this
 * package's plugin spec, the cards hold only their own expansion state, and
 * every number they show is derived at render from the session snapshot or
 * read fresh from the gate — this package holds no mutable state of its own,
 * caches nothing, and emits no cordis events.
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
