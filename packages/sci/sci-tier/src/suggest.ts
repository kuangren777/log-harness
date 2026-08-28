/**
 * The `suggest_tier_upgrade` half of the tier layer, as its own mountable
 * plugin.
 *
 * It is separate from the package entry because the two halves have different
 * audiences. The entry registers the tier section and the gates and belongs in
 * BOTH science-research presets; this tool belongs only in `sci-balanced`, where
 * suggesting an upgrade is the model's one legitimate exit. Mounting it in
 * `sci-cluster` would offer the model an upgrade out of the tier it is already
 * in.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject` injection
 * metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-tier/suggest
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { applySuggestTool } from './suggest-tool.ts'

export { SUGGEST_TOOL, applySuggestTool, describeSuggestTool } from './suggest-tool.ts'

/** Cordis plugin name. */
export const name = 'sci-tier-suggest'

/** The tool registry the suggestion tool joins. */
export const inject = ['tools']

/**
 * Register the tier-upgrade suggestion tool on the mounting context.
 * @param ctx - the mounting context, carrying `tools`.
 */
export function apply(ctx: Context): void {
  applySuggestTool(ctx)
}
