/**
 * Reading and repairing the memory-node frontmatter block.
 *
 * The studied platform wrote `metadata.originSessionId` into every memory node
 * so a distilled fact could be traced back to the transcript that produced it,
 * but nothing enforced it: a node written without the field simply lost its
 * provenance forever. Here a missing field is repaired in place from the
 * session that performed the write, so the back-pointer is a property of the
 * mechanism rather than of the model's diligence.
 * @module @deepseek-ai/dsh-sci-memory/src/frontmatter
 */

import { parse as parseYaml } from 'yaml'
import type { FsEditRequest } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MemoryFrontmatter, MemoryNodeType } from './types.ts'

/** Leading YAML frontmatter block, including its closing delimiter line. */
const FRONTMATTER = /^---(\r?\n)([\s\S]*?\r?\n)---(\r?\n|$)/

/** Frontmatter key holding the transcript back-pointer, nested under `metadata`. */
export const ORIGIN_SESSION_KEY = 'originSessionId'

/** Frontmatter key holding the nested platform metadata mapping. */
export const METADATA_KEY = 'metadata'

/** One matched frontmatter block, split into the pieces an edit rebuilds it from. */
interface FrontmatterMatch {
  /** The whole matched block, delimiters included. */
  readonly whole: string
  /** Line ending the block uses. */
  readonly eol: string
  /** Block body, ending in its own line ending. */
  readonly block: string
  /** Text between the closing delimiter and the body, empty at end of file. */
  readonly tail: string
}

/**
 * Match the leading frontmatter block of one file.
 * @param text - the whole file content.
 * @returns the matched pieces, or `undefined` when the file opens with no frontmatter.
 */
function matchFrontmatter(text: string): FrontmatterMatch | undefined {
  const match = FRONTMATTER.exec(text)
  if (match === null) return undefined
  // Every group in FRONTMATTER is mandatory, so all three captures are present
  // whenever the pattern matches; the array index signature cannot say so.
  const [eol, block, tail] = match.slice(1) as [string, string, string]
  return { whole: match[0], eol, block, tail }
}

/** The four node classifications the studied platform used. */
const NODE_TYPES: ReadonlySet<string> = new Set<MemoryNodeType>(['user', 'feedback', 'project', 'reference'])

/**
 * Read one trimmed non-empty string field from a parsed mapping.
 * @param data - the parsed mapping.
 * @param key - field name.
 * @returns the trimmed value, or `undefined` when absent, blank, or not a string.
 */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Narrow the nested `metadata` value to a mapping.
 * @param value - the raw frontmatter `metadata` value.
 * @returns the mapping, or `undefined` when the node declares none.
 */
function metadataMapping(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Parse the frontmatter block of one memory node.
 *
 * A file with no frontmatter, with unparseable YAML, or whose frontmatter is
 * not a mapping is not a memory node and yields `undefined`; the observer then
 * records nothing rather than rewriting a file it does not understand.
 * @param text - the whole file content.
 * @returns the recognized frontmatter fields, or `undefined` when the file carries no frontmatter mapping.
 */
export function parseMemoryFrontmatter(text: string): MemoryFrontmatter | undefined {
  const match = matchFrontmatter(text)
  if (match === undefined) return undefined
  let parsed: unknown
  try {
    parsed = parseYaml(match.block)
  } catch {
    // Frontmatter the model left syntactically broken is not a memory node.
    // Nothing else in this package can interpret it, and the write itself was
    // already accepted, so there is no other outcome to report.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const data = parsed as Record<string, unknown>
  const metadata = metadataMapping(data[METADATA_KEY])
  const type = metadata === undefined ? undefined : stringField(metadata, 'type')
  const origin = metadata === undefined ? undefined : stringField(metadata, ORIGIN_SESSION_KEY)
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  return {
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...type === undefined || !NODE_TYPES.has(type) ? {} : { type: type as MemoryNodeType },
    ...origin === undefined ? {} : { originSessionId: origin as SessionId },
  }
}

/**
 * Indentation used by the `metadata` mapping's existing entries, so a
 * backfilled line matches the file's own style instead of a fixed guess.
 * @param block - the frontmatter block body.
 * @returns the leading whitespace of the first nested entry, defaulting to two spaces.
 */
function metadataIndent(block: string): string {
  const nested = /^[ \t]*metadata[ \t]*:[^\n]*\n([ \t]+)\S/m.exec(block)
  return nested?.[1] ?? '  '
}

/**
 * Plan the literal edit that adds `metadata.originSessionId` to a memory node.
 *
 * The whole frontmatter block is the anchor, so the replacement cannot land on
 * a `metadata:` line that happens to appear in the node's prose, and it
 * composes with the filesystem's compare-and-set guard: a concurrent writer
 * that changed the block makes the edit fail rather than corrupt the node.
 * @param text - the whole file content as it was just written.
 * @param sessionId - the session to record as the node's origin.
 * @returns the literal edit, or `undefined` when the file has no frontmatter or already records an origin.
 */
export function planOriginBackfill(text: string, sessionId: SessionId): FsEditRequest | undefined {
  const match = matchFrontmatter(text)
  if (match === undefined) return undefined
  const parsed = parseMemoryFrontmatter(text)
  if (parsed === undefined || parsed.originSessionId !== undefined) return undefined
  const { whole: oldString, eol, block, tail } = match
  const indent = metadataIndent(block)
  const line = `${indent}${ORIGIN_SESSION_KEY}: ${sessionId}${eol}`
  const existing = /^[ \t]*metadata[ \t]*:[^\n]*\n/m.exec(block)
  const cut = existing === null ? block.length : existing.index + existing[0].length
  const newBlock = existing === null
    ? `${block}${METADATA_KEY}:${eol}${line}`
    : `${block.slice(0, cut)}${line}${block.slice(cut)}`
  return {
    oldString,
    newString: `---${eol}${newBlock}---${tail}`,
    replaceAll: false,
  }
}
