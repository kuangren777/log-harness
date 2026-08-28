/**
 * `@deepseek-ai/dsh-office-univer/tools` — the `univer_*` tool Consumer as a
 * standalone cordis.yml row.
 *
 * An agent preset composes its own tool surface: the Univer Provider lives on
 * the host plane and is shared, while each agent decides which office tools its
 * persona may call. Mounting this entry gives an agent scope exactly that
 * choice without also giving it a second Provider, a second Gateway, or a
 * second copy of the Provider's timeouts — those are read from
 * `ctx.univer.config`, and the only key this row owns is `disabledTools`.
 *
 * The package entry (`@deepseek-ai/dsh-office-univer`) still mounts the same
 * Consumer itself when its `tools` flag is left on; a deployment picks one of
 * the two, because mounting both would register every tool name twice.
 * @module @deepseek-ai/dsh-office-univer/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDisabledTools } from './host/config.ts'
import { apply as applyUniverTools } from './host/tools/plugin.ts'

/** Cordis plugin name. */
export const name = 'univer-tools'

/** The Provider's service and the tool registry the tools are contributed to. */
export const inject = ['univer', 'tools']

/** Configuration of one mounted `univer_*` tool row. */
export interface Config {
  /**
   * Tool names withheld from registration, for an agent whose host cannot
   * satisfy a tool's requirements (no Chromium for `univer_screenshot`, no
   * network for `univer_resources`). Every entry must name a real tool.
   */
  disabledTools?: string[]
}

/** Cordis configuration schema. */
export const Config: z<Config> = z.object({
  disabledTools: z.array(z.string()).default([]),
})

/**
 * Register the `univer_*` tools this row did not withhold.
 * @param ctx - Cordis context carrying the `univer` and `tools` services.
 * @param config - the row's configuration; defaults to withholding nothing.
 * @throws {Error} when `disabledTools` names a tool that does not exist, which
 * would otherwise leave the agent advertising a tool the row meant to remove.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applyUniverTools(ctx, { disabledTools: resolveDisabledTools(config.disabledTools) })
}
