/**
 * The persona document format and the roster text assembled from it.
 *
 * A charter is a Markdown file with YAML frontmatter, the same shape a skill
 * body uses, so the six documents in `config/agents/` are reviewed and
 * translated as prose rather than maintained as string literals. Everything
 * here is pure: the loader in the package entry supplies the file contents.
 * @module @deepseek-ai/dsh-sci-profile/src/persona-file
 */

import { parse } from 'yaml'
import { ICON_PERSONA, PERSONA_NAMES, type PersonaName, type PlanIcon } from '@deepseek-ai/dsh-sci-plan'
import type { SciPersona } from './types.ts'

/** Display name of the roster section, and the title a `sci:*` context may cite. */
export const SECTION_PERSONAS = 'Research personas'

/**
 * Assembly order of the roster section: after `Agent-cluster orchestration`
 * (150), which explains that fan-out exists at all, and before
 * `Irreversible actions` (165), which is about the calling thread rather than
 * about the children it starts.
 */
export const PERSONAS_SECTION_ORDER = 155

/** Frontmatter delimiter opening and closing the block. */
const FENCE = '---'

/** The frontmatter block and the body that follows it, or undefined when the file opens with no block. */
function splitDocument(text: string): { frontmatter: string; body: string } | undefined {
  const normalized = text.replaceAll('\r\n', '\n')
  if (!normalized.startsWith(`${FENCE}\n`)) return undefined
  const end = normalized.indexOf(`\n${FENCE}\n`, FENCE.length)
  if (end === -1) return undefined
  return {
    frontmatter: normalized.slice(FENCE.length + 1, end + 1),
    body: normalized.slice(end + FENCE.length + 2),
  }
}

/**
 * Read one frontmatter field as a non-empty string.
 * @param fields - the parsed frontmatter mapping.
 * @param key - the field to read.
 * @param source - the document path, for the thrown message.
 * @returns the trimmed value.
 * @throws Error when the field is absent, not a string, or blank.
 */
function requireField(fields: Record<string, unknown>, key: string, source: string): string {
  const value = fields[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`sci-profile: persona document ${source} must declare a non-empty "${key}" in its frontmatter`)
  }
  return value.trim()
}

/**
 * Parse one persona charter document.
 *
 * This is a durable-file boundary — the documents ship as package resources and
 * a deployment may point `agentsRoot` at its own tree — so every field is
 * validated and a malformed document throws at load rather than reaching a
 * model as a half-empty roster line.
 * @param text - the document's full contents.
 * @param source - the document's path, quoted in every thrown message.
 * @returns the parsed persona.
 * @throws Error when the frontmatter is missing or malformed, when `name` is not
 *   one of the six personas `@deepseek-ai/dsh-sci-plan` defines, when `icon` is
 *   present but is not the icon that selects this persona, or when the body is blank.
 */
export function parsePersonaDocument(text: string, source: string): SciPersona {
  const split = splitDocument(text)
  if (split === undefined) {
    throw new Error(`sci-profile: persona document ${source} must open with a "${FENCE}" frontmatter block`)
  }
  const parsed: unknown = parse(split.frontmatter)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`sci-profile: persona document ${source} has frontmatter that is not a mapping`)
  }
  const fields = parsed as Record<string, unknown>
  const name = requireField(fields, 'name', source)
  if (!(PERSONA_NAMES as readonly string[]).includes(name)) {
    throw new Error(
      `sci-profile: persona document ${source} declares name ${JSON.stringify(name)}, `
      + `which is not one of the personas @deepseek-ai/dsh-sci-plan defines (${PERSONA_NAMES.join(', ')})`,
    )
  }
  const summary = requireField(fields, 'summary', source)
  const charter = split.body.trim()
  if (charter === '') {
    throw new Error(`sci-profile: persona document ${source} has an empty charter body`)
  }
  const persona: SciPersona = { name: name as PersonaName, summary, charter }
  if (fields.icon === undefined) return persona
  const icon = requireField(fields, 'icon', source)
  const routed: string | undefined = (ICON_PERSONA as Readonly<Record<string, string>>)[icon]
  if (routed !== name) {
    throw new Error(
      `sci-profile: persona document ${source} claims icon ${JSON.stringify(icon)}, `
      + `but @deepseek-ai/dsh-sci-plan routes that icon to ${JSON.stringify(routed ?? 'no persona')}`,
    )
  }
  return { ...persona, icon: icon as PlanIcon }
}

/**
 * Reject a roster that is not exactly the six personas, in declaration order.
 *
 * The check is on the SET rather than on each document because a missing
 * charter is invisible at the call site that needs it: the orchestrating thread
 * writes a child prompt from the roster, so a persona absent from the roster is
 * a persona that silently never runs, and `declare_research_plan` would still
 * hand a user's card the name of an agent no charter defines.
 * @param personas - the parsed documents, in the order they will be listed.
 * @throws Error when a persona is missing or declared twice.
 */
export function assertCompleteRoster(personas: readonly SciPersona[]): void {
  const seen = new Set<string>()
  for (const persona of personas) {
    if (seen.has(persona.name)) {
      throw new Error(`sci-profile: persona ${JSON.stringify(persona.name)} is declared by two documents`)
    }
    seen.add(persona.name)
  }
  const missing = PERSONA_NAMES.filter(name => !seen.has(name))
  if (missing.length > 0) {
    throw new Error(`sci-profile: the persona roster is missing ${missing.map(name => JSON.stringify(name)).join(', ')}`)
  }
}

/**
 * Assemble the roster section the orchestrating thread reads.
 * @param personas - the complete roster, in listing order.
 * @returns the section text.
 */
export function renderPersonaRoster(personas: readonly SciPersona[]): string {
  const lines = [
    'Six personas are defined for this profile. A subagent or workflow step runs as one of them: '
    + 'open the child prompt with that persona\'s charter, verbatim, before the task text. '
    + 'A `declare_research_plan` icon selects the persona for its step, and the two personas no icon reaches are chosen from the step\'s own task text.',
    '',
  ]
  for (const persona of personas) {
    const selector = persona.icon === undefined
      ? 'no icon selects it'
      : `selected by the \`${persona.icon}\` icon`
    lines.push(`### ${persona.name} (${selector})`, '', persona.summary, '', persona.charter, '')
  }
  return lines.join('\n').trimEnd()
}
