/**
 * Static reading of the bundled skill tree.
 *
 * The studied platform shipped a listing in which three skills had lost their
 * description to a truncation bug and were injected as bare names for weeks.
 * Here the whole tree is parsed while the plugin loads and a skill without a
 * usable description fails the load by name, so the defect cannot reach a
 * model-visible catalog.
 * @module @deepseek-ai/dsh-sci-skills/src/scan
 */

import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SkillSourceReader } from './hash.ts'

/** Skill entrypoint file name inside every skill directory. */
export const SKILL_FILE = 'SKILL.md'

/** One parsed skill bundle, complete enough to serve both `list()` and `get()`. */
export interface ScannedSkill {
  /** Kebab-case skill name; equals the directory name. */
  readonly name: string
  /** Routing description shown in the catalog. */
  readonly description: string
  /** Extra routing guidance from frontmatter. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Frontmatter `metadata` object when the skill declares one. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** Instruction body with the frontmatter block removed. */
  readonly content: string
  /** sha256 hex of {@link content} as UTF-8; the content commitment a referenced-text block carries. */
  readonly bodySha256: string
}

/** The whole leading frontmatter block, both fences included. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

/** The two fences of a matched {@link FRONTMATTER} block, stripped to leave the YAML. */
const FRONTMATTER_FENCES = /^---\r?\n|\r?\n---\r?\n?$/g

/**
 * Read a required frontmatter string field.
 * @param data - the parsed frontmatter mapping.
 * @param key - field name.
 * @returns the trimmed value, or `undefined` when absent or not a non-empty string.
 */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read an optional frontmatter boolean.
 * @param data - the parsed frontmatter mapping.
 * @param key - field name.
 * @param skill - skill name used in the failure message.
 * @returns the value, or `undefined` when the field is absent.
 */
function booleanField(data: Record<string, unknown>, key: string, skill: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value !== 'boolean') {
    throw new TypeError(`sci-skills: skill "${skill}" frontmatter field "${key}" must be a boolean`)
  }
  return value
}

/**
 * Split a SKILL.md into its frontmatter mapping and its instruction body.
 * @param raw - the whole file content.
 * @param skill - skill name used in failure messages.
 * @returns the parsed mapping and the trimmed body.
 */
export function parseSkillDocument(raw: string, skill: string): {
  data: Record<string, unknown>
  body: string
} {
  const match = FRONTMATTER.exec(raw)
  if (match === null) {
    throw new Error(`sci-skills: skill "${skill}" ${SKILL_FILE} has no YAML frontmatter block`)
  }
  const block = match[0]
  let parsed: unknown
  try {
    parsed = parseYaml(block.replace(FRONTMATTER_FENCES, ''))
  } catch (error) {
    throw new Error(`sci-skills: skill "${skill}" ${SKILL_FILE} has invalid YAML frontmatter: ${String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`sci-skills: skill "${skill}" ${SKILL_FILE} frontmatter is not a mapping`)
  }
  return { data: parsed as Record<string, unknown>, body: raw.slice(block.length).trim() }
}

/**
 * Parse one skill bundle's SKILL.md.
 * @param raw - the whole file content.
 * @param skill - directory name, which the frontmatter `name` must match.
 * @returns the parsed skill.
 */
export function parseSkill(raw: string, skill: string): ScannedSkill {
  const { data, body } = parseSkillDocument(raw, skill)
  const name = stringField(data, 'name')
  if (name !== skill) {
    throw new Error(`sci-skills: skill directory "${skill}" declares frontmatter name ${JSON.stringify(name ?? null)}; they must match`)
  }
  if (!isSkillName(name)) {
    throw new Error(`sci-skills: skill "${skill}" is not a valid kebab-case skill name`)
  }
  const description = stringField(data, 'description')
  if (description === undefined) {
    throw new Error(`sci-skills: skill "${skill}" has an empty ${SKILL_FILE} frontmatter description; every listed skill must state when to use it`)
  }
  const whenToUse = stringField(data, 'whenToUse')
  const metadata = data.metadata
  return {
    name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    invocation: {
      modelInvocable: booleanField(data, 'disable-model-invocation', skill) !== true,
      userInvocable: booleanField(data, 'user-invocable', skill) !== false,
    },
    ...typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? { metadata: metadata as Record<string, unknown> }
      : {},
    content: body,
    bodySha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  }
}

/**
 * Parse every skill bundle under one root, in stable name order.
 * @param root - absolute path of the skill root.
 * @param reader - read side of the bundled tree.
 * @returns the parsed skills; the first defective bundle throws.
 */
export async function scanSkillRoot(
  root: string,
  reader: SkillSourceReader,
): Promise<readonly ScannedSkill[]> {
  const names = [...await reader.listSkillNames(root)].sort()
  const skills: ScannedSkill[] = []
  for (const name of names) {
    const files = await reader.listFiles(`${root}/${name}`)
    if (!files.includes(SKILL_FILE)) {
      throw new Error(`sci-skills: skill directory "${name}" has no ${SKILL_FILE}`)
    }
    skills.push(parseSkill(await reader.readFile(`${root}/${name}`, SKILL_FILE), name))
  }
  return skills
}

/**
 * The exact form a skill body uses to cite a system-prompt chapter. Skill
 * bodies inherited from the studied platform cited chapters as italic titles
 * of a prompt the archive never captured; here every citation is normalised to
 * one quoted form so the reference can be checked mechanically against the
 * chapters `@deepseek-ai/dsh-sci-prompt` actually assembles.
 */
const CHAPTER_REFERENCE = /"[^"]+" section of the system prompt/g

/** The quote and trailing phrase around a {@link CHAPTER_REFERENCE} match, stripped to leave the title. */
const CHAPTER_REFERENCE_AFFIXES = /^"|" section of the system prompt$/g

/**
 * Collect the system-prompt chapter titles one skill body cites.
 * @param content - the skill instruction body.
 * @returns each cited chapter display name, in first-occurrence order, deduplicated.
 */
export function collectChapterReferences(content: string): readonly string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(CHAPTER_REFERENCE)) {
    found.add(match[0].replace(CHAPTER_REFERENCE_AFFIXES, ''))
  }
  return [...found]
}
