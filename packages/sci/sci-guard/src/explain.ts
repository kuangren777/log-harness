/**
 * The text the user reads when this gate asks for authorization.
 *
 * Each reason answers the three questions the *Irreversible actions* chapter
 * requires of the agent before it asks — what the action does, what it touches,
 * and what cannot be undone — so the question a human sees carries the same
 * three facts whether the agent stated them or the gate raised the question on
 * its own. The `execUnsigned` reason adds the chapter's evidence rule, that a
 * README's description of a binary is not evidence of what the binary does,
 * because that is the case where the agent has a document and no observation.
 * @module @deepseek-ai/dsh-sci-guard/explain
 */

import type { CommandFinding, RiskCategory } from './types.ts'

/** The three-sentence reason for each category, given the path or token it rests on. */
const REASONS: Readonly<Record<RiskCategory, (subject: string) => string>> = {
  execUnsigned: subject =>
    `Running ${subject} executes a file that appeared inside this session rather than one the image ships, so nothing observed so far establishes what it does. `
    + 'It runs as the sandbox user, with that user\'s access to the whole project tree, the network, and every credential readable from it. '
    + 'Anything it writes, sends, or destroys before it is stopped cannot be taken back from here. '
    + 'A README\'s description of a binary is not evidence of what the binary does: inspect it with `file`, `readelf`, `strings`, and `sha256sum`, and report any discrepancy before this is approved.',
  egress: subject =>
    `This command transmits local content to an endpoint outside this machine, named by ${subject}. `
    + 'It reads whatever that operand covers — data, documents, keys, or an archive assembled from them — out of the sandbox and hands the bytes to the receiving side. '
    + 'A transfer that starts leaves a copy no later command here can reach or delete.',
  credential: subject =>
    `This command writes to ${subject}, which holds SSH key material or another private credential. `
    + 'It replaces the file the machine authenticates with, not a copy of it. '
    + 'The current key material is gone once it is overwritten, and every access it granted stays broken until the user issues a new one.',
  destructive: subject =>
    `This command recursively deletes ${subject}. `
    + 'That path is inside a region holding manuscripts, figures, delivered files, or memory — work produced across turns, not scratch output under `tmp/`. '
    + 'A recursive delete there removes appended versions the workbench cannot regenerate, and nothing in the sandbox restores them.',
}

/**
 * The approval question for one classified command.
 * @param finding - the category and the path or token the classification rests on.
 * @returns the reason text presented to the user and, on refusal, to the model.
 */
export function explainFinding(finding: CommandFinding): string {
  return REASONS[finding.category](finding.subject)
}
