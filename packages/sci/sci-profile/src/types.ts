/** Types owned by the science-research profile layer. */

import type { PersonaName, PlanIcon } from '@deepseek-ai/dsh-sci-plan'

/**
 * One subagent persona charter shipped with the `sci` profile.
 *
 * A persona is not a mountable agent definition — this harness has no roster of
 * those, and `@deepseek-ai/dsh-tool-subagent` takes one persona per MOUNTED row,
 * not one per call. A persona is therefore what the orchestrating thread opens a
 * child prompt with, which makes the charter model-facing text and the roster a
 * system-prompt section.
 */
export interface SciPersona {
  /** Directory-unique persona id, and the name `declare_research_plan` echoes for a card. */
  readonly name: PersonaName
  /** The plan icon that selects this persona, absent for a persona no icon reaches. */
  readonly icon?: PlanIcon
  /** One sentence naming what the persona is for, rendered in the roster line. */
  readonly summary: string
  /** The charter body, verbatim from the document, with no frontmatter and no trailing blank line. */
  readonly charter: string
}
