/**
 * Deployment-varying description of the tier one composition runs at: which
 * tier, and which registered tool names count as fanning work out across
 * subagents.
 * @module @deepseek-ai/dsh-sci-tier/config
 */

import z from '@deepseek-ai/schemastery'
import type { SciTier } from './types.ts'

/** Deployment-varying choices for the science-research tier layer. */
export interface Config {
  /**
   * Which tier this composition runs at. Required and with no default: the
   * value decides which prompt section the model reads and which of the two
   * gates is live, and a guessed tier would either state a rule nothing
   * enforces or enforce a rule the model was never told about.
   */
  tier: SciTier
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
 * The fan-out tools this repository ships, by their registered names.
 *
 * `ralph`, `subagent_codex`, and `subagent_claude_code` are listed even though
 * neither science-research preset mounts them: the list is what the gates
 * refuse, so naming a tool the composition does not have costs nothing, while
 * omitting one a deployment later adds silently opens the tier.
 */
export const DEFAULT_FANOUT_TOOLS: string[] = [
  'workflow',
  'subagent',
  'subagent_fork',
  'subagent_codex',
  'subagent_claude_code',
  'ralph',
]

/** Schemastery schema for the science-research tier layer. */
export const Config: z<Config> = z.object({
  tier: z.union(['balanced', 'cluster'] as const).required(),
  fanoutTools: z.array(z.string()).default(DEFAULT_FANOUT_TOOLS),
})
