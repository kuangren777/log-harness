/**
 * The `resolve_tier` half of the tier layer, as its own mountable plugin.
 *
 * It is separate from the package entry for the same reason `./suggest` is:
 * the entry registers the tier section and the gates and belongs in every
 * science-research preset, while this tool belongs only in `sci-auto`, the one
 * composition whose tier the model resolves. Mounting it in `sci-balanced` or
 * `sci-cluster` would offer the model a resolution the preset already made.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject` injection
 * metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-tier/resolve
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { applyResolveTool } from './resolve-tool.ts'

export { RESOLVABLE_TIERS, RESOLVE_TOOL, applyResolveTool, describeResolveTool, formatResolveResult } from './resolve-tool.ts'

/** Cordis plugin name. */
export const name = 'sci-tier-resolve'

/** The tool registry the resolution tool joins. */
export const inject = ['tools']

/**
 * Register the tier resolution tool on the mounting context.
 * @param ctx - the mounting context, carrying `tools`.
 */
export function apply(ctx: Context): void {
  applyResolveTool(ctx)
}
