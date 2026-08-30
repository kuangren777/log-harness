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
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import type { SciPersona, SciPersonaDisplay } from './types.ts'

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
 * Read the optional `tools.deny` frontmatter list.
 *
 * A charter states its exclusions in prose ("do not deliver files"), which the
 * child reads and may still disregard. `tools.deny` is the same sentence made
 * enforceable: the names go into the mounted row's `toolFilter.deny`, which
 * `ctx.tools.restrict()` applies at child creation, so a denied tool is absent
 * from the child's prompt and refuses to execute. None of the six charters this
 * package ships declares one — their exclusions cover tools a deployment may
 * rename — so the field exists for a deployment that points `agentsRoot` at its
 * own tree.
 * @param fields - the parsed frontmatter mapping.
 * @param source - the document path, for the thrown message.
 * @returns the denied tool names, or `undefined` when the document declares none.
 * @throws Error when `tools` is present but is not a mapping whose `deny` is a
 *   non-empty array of non-empty strings.
 */
function readToolDenials(fields: Record<string, unknown>, source: string): readonly string[] | undefined {
  const tools = fields.tools
  if (tools === undefined) return undefined
  if (typeof tools !== 'object' || tools === null || Array.isArray(tools)) {
    throw new Error(`sci-profile: persona document ${source} has a "tools" frontmatter field that is not a mapping`)
  }
  const deny = (tools as Record<string, unknown>).deny
  if (!Array.isArray(deny) || deny.length === 0 || deny.some(name => typeof name !== 'string' || name.trim() === '')) {
    throw new Error(
      `sci-profile: persona document ${source} declares "tools" but its "deny" is not a non-empty list of tool names`,
    )
  }
  return (deny as string[]).map(name => name.trim())
}

/**
 * Read one field of a `display` block as a non-empty string.
 * @param block - the parsed `display` mapping.
 * @param key - the field to read.
 * @param source - the document path, for the thrown message.
 * @returns the trimmed value.
 * @throws Error when the field is absent, not a string, or blank.
 */
function requireDisplayField(block: Record<string, unknown>, key: string, source: string): string {
  const value = block[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`sci-profile: persona document ${source} declares "display" without a non-empty "${key}"`)
  }
  return value.trim()
}

/**
 * Read the optional `display` frontmatter block.
 *
 * All three fields are required together once the block exists: a card drawn
 * with a title and no body would be worse than one drawn from the English
 * fallback, because the gap is invisible to whoever wrote the document.
 * @param fields - the parsed frontmatter mapping.
 * @param source - the document path, for the thrown message.
 * @returns the card copy, or `undefined` when the document declares none.
 * @throws Error when `display` is present but is not a mapping carrying all
 *   three non-empty string fields.
 */
function readDisplay(fields: Record<string, unknown>, source: string): SciPersonaDisplay | undefined {
  const display = fields.display
  if (display === undefined) return undefined
  if (typeof display !== 'object' || display === null || Array.isArray(display)) {
    throw new Error(`sci-profile: persona document ${source} has a "display" frontmatter field that is not a mapping`)
  }
  const block = display as Record<string, unknown>
  return {
    name: requireDisplayField(block, 'name', source),
    role: requireDisplayField(block, 'role', source),
    description: requireDisplayField(block, 'description', source),
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
 *   present but is not the icon that selects this persona, when `tools` is
 *   present but carries no usable `deny` list, when `display` is present but
 *   incomplete, or when the body is blank.
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
  const deny = readToolDenials(fields, source)
  const display = readDisplay(fields, source)
  const persona: SciPersona = {
    name: name as PersonaName,
    summary,
    charter,
    ...deny === undefined ? {} : { deny },
    ...display === undefined ? {} : { display },
  }
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
    'Six personas are defined for this profile, and each one is a delegation tool of its own: '
    + 'delegate a step to a persona by calling `subagent_<persona>`. The tool carries that persona\'s '
    + 'charter into its child, so the `prompt` you send is the task alone — do not restate the charter, '
    + 'and do not ask one persona to do another\'s work. '
    + 'A `declare_research_plan` icon selects the persona for its step; `plotter`, which no icon reaches, '
    + 'is chosen from the step\'s own task text.',
    '',
  ]
  for (const persona of personas) {
    const selector = persona.icon === undefined
      ? 'no icon selects it'
      : `selected by the \`${persona.icon}\` icon`
    lines.push(
      `### ${persona.name} — \`${subagentToolName(persona.name)}\` (${selector})`,
      '',
      persona.summary,
      '',
      persona.charter,
      '',
    )
  }
  return lines.join('\n').trimEnd()
}
