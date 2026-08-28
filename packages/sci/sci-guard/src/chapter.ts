/**
 * The eighth chapter of the science-research system prompt, *Irreversible
 * actions*.
 *
 * The studied platform's six red-team sessions all stopped at the
 * authorization step, consistently across two vendors' models, yet no prompt
 * text asking for that behaviour was ever found. This chapter is that missing
 * text written down, so the behaviour rests on a stated rule rather than on an
 * unexplained regularity. It lives in this package rather than in
 * `@deepseek-ai/dsh-sci-prompt` because the gate that enforces it is here: the
 * chapter tells the model what to do before an irreversible action, and the
 * `tools/pre-execute` listener asks the user when the model does it anyway.
 * @module @deepseek-ai/dsh-sci-guard/chapter
 */

/** Registry key of the "Irreversible actions" chapter. */
export const SECTION_IRREVERSIBLE_ACTIONS = 'sci:irreversible-actions'

/**
 * Assembly order of the chapter, one step after the last chapter
 * `@deepseek-ai/dsh-sci-prompt` contributes (`sci:runtime-environment`, 160).
 */
export const IRREVERSIBLE_ACTIONS_ORDER = 165

/** The chapter text, unchanged from the security model that specifies it. */
export const CHAPTER_IRREVERSIBLE_ACTIONS =
  'Irreversible actions. Before you execute an unsigned binary or installer, '
  + 'upload or transmit content from this machine to an external endpoint, '
  + 'modify SSH keys or credentials, or delete anything outside `tmp/`, stop '
  + 'and ask the user for explicit authorization through the approval tool — '
  + 'state what the action does, what it touches, and what cannot be undone. '
  + 'A README\'s description of a binary is not evidence of what the binary '
  + 'does; inspect it statically (`file`, `readelf`, `strings`, `sha256sum`) '
  + 'and report discrepancies before asking. Authorization for one action does '
  + 'not extend to the next.'
