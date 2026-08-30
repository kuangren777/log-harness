/** Types owned by the science-research profile layer. */

import type { PersonaName, PlanIcon } from '@deepseek-ai/dsh-sci-plan'

/**
 * The person-facing copy of one persona, from the document's `display`
 * frontmatter.
 *
 * Kept apart from the charter because the two face opposite directions: the
 * charter is model-facing English that a child reads as its own instructions,
 * while this is what the browser's agent roster draws for the user. Both live in
 * the same document so a deployment that rewrites a charter cannot forget to
 * rewrite the card that describes it — the pair is reviewed and translated
 * together, as one file.
 */
export interface SciPersonaDisplay {
  /** Roster card title. */
  readonly name: string
  /** One line under the title: what this persona is for. */
  readonly role: string
  /** Card body: what the charter actually asks of the child. */
  readonly description: string
}

/**
 * One subagent persona charter shipped with the `sci` profile.
 *
 * A persona is not a mountable agent definition — this harness has no roster of
 * those, and `@deepseek-ai/dsh-tool-subagent` takes one persona per MOUNTED row,
 * not one per call. `sci-cluster` therefore mounts that package six times, once
 * per charter, and the child of `subagent_<persona>` receives that charter as
 * its own persona section. The roster stays a system-prompt section because the
 * calling thread still has to choose which of the six tools a step belongs to.
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
  /**
   * Tool names the document's `tools.deny` frontmatter withholds from this
   * persona's children, absent when it declares none. The list reaches
   * `ctx.tools.restrict()` through the mounted row's `toolFilter.deny`, so every
   * name must already be in the child's catalog — an unmounted name throws at
   * child creation rather than being ignored.
   */
  readonly deny?: readonly string[]
  /**
   * Person-facing card copy, absent when the document declares no `display`
   * block. A roster surface with no copy falls back to {@link name} and
   * {@link summary} rather than inventing text.
   */
  readonly display?: SciPersonaDisplay
}
