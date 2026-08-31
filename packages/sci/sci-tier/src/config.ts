/**
 * Deployment-varying description of the tier one composition runs at: which
 * tier, and which registered tool names count as fanning work out across
 * subagents.
 * @module @deepseek-ai/dsh-sci-tier/config
 */

import z from '@deepseek-ai/schemastery'
import { PERSONA_NAMES, type PersonaName } from '@deepseek-ai/dsh-sci-plan'
import type { SciTierMode } from './types.ts'

/** Deployment-varying choices for the science-research tier layer. */
export interface Config {
  /**
   * Which tier this composition runs at, or `auto`. Required and with no
   * default: the value decides which prompt section the model reads and which
   * gates are live, and a guessed tier would either state a rule nothing
   * enforces or enforce a rule the model was never told about. `auto` mounts
   * the cluster composition and keeps every fan-out shut until the model has
   * resolved the session's tier with `resolve_tier`.
   */
  tier: SciTierMode
  /**
   * Registered tool names that fan work out across subagents. Both gates read
   * this one list: in the cluster tier a call to one of these names spends a
   * declared plan, and in the balanced tier it is denied outright. It is
   * configurable because the delegation tools a deployment mounts are its own
   * choice — a composition carrying a differently named fan-out tool would
   * otherwise walk straight past both gates.
   */
  fanoutTools: string[]
}

/**
 * Prefix of the registered name of a persona-bound delegation tool.
 *
 * `@deepseek-ai/dsh-tool-subagent` binds one persona per MOUNTED row, so the
 * science presets mount the package once per persona and name each instance
 * after the persona it carries. The name is what the G1 latch counts, what the
 * roster prompt tells the model to call, and what `subagent.<toolName>` settings
 * and the browser's agent view are keyed by — one derivation, here, so those
 * four never disagree.
 */
export const SUBAGENT_TOOL_PREFIX = 'subagent_'

/**
 * The registered name of one persona's delegation tool.
 * @param persona - the persona the mounted row binds.
 * @returns the tool name that row registers.
 */
export function subagentToolName(persona: PersonaName): string {
  return `${SUBAGENT_TOOL_PREFIX}${persona}`
}

/**
 * The six persona-bound delegation tools, in `PERSONA_NAMES` order.
 *
 * Derived rather than listed so a persona added to
 * `@deepseek-ai/dsh-sci-plan` cannot reach a preset without also reaching both
 * gates.
 */
export const PERSONA_FANOUT_TOOLS: string[] = PERSONA_NAMES.map(subagentToolName)

/**
 * The fan-out tools this repository ships, by their registered names.
 *
 * `ralph`, `subagent_codex`, and `subagent_claude_code` are listed even though
 * neither science-research preset mounts them: the list is what the gates
 * refuse, so naming a tool the composition does not have costs nothing, while
 * omitting one a deployment later adds silently opens the tier. The unsuffixed
 * `subagent` stays listed for the same reason — the science presets replaced it
 * with the six persona instances, and a composition that still mounts it must
 * not walk past the gates.
 */
export const DEFAULT_FANOUT_TOOLS: string[] = [
  'workflow',
  'subagent',
  ...PERSONA_FANOUT_TOOLS,
  'subagent_fork',
  'subagent_codex',
  'subagent_claude_code',
  'ralph',
]

/** Schemastery schema for the science-research tier layer. */
export const Config: z<Config> = z.object({
  tier: z.union(['balanced', 'cluster', 'auto'] as const).required(),
  fanoutTools: z.array(z.string()).default(DEFAULT_FANOUT_TOOLS),
})
