/**
 * Validation of the host-computed `result.meta` the two tool rows draw.
 *
 * The rendering intent rides data this package does not own, so every field
 * is checked before it is drawn: a meta of another shape, another kind, or a
 * citations array holding something that is not a row leaves the seat empty
 * and the generic tool card renders instead. Nothing here is derived from the
 * call's arguments — a replay of the same log draws the same rows.
 */
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { SciCitationsKey } from './locales.ts'
import { QUARANTINE_GROUP, UNGROUPED } from './pool-view.ts'

/** One citation as a tool result reports it. */
export interface CitationRowMeta {
  /** BibTeX cite key. */
  citekey: string
  /** Work title. */
  title: string
  /** Publication year, when the host reported one. */
  year?: number
  /** Group key the citation sits in. */
  group?: string
  /** Deterministic 0..100 score. */
  confidence?: number
  /** How many times the prose cites this key. */
  uses?: number
  /** Whether the host is holding this citation out. */
  quarantined?: boolean
}

/**
 * Whether one optional field is absent or of the type the row declares.
 * @param value - the field as the meta carries it.
 * @param type - the `typeof` tag the field must have when present.
 * @returns whether the field is drawable.
 */
function optional(value: unknown, type: 'boolean' | 'number' | 'string'): boolean {
  return value === undefined || typeof value === type
}

/**
 * Whether one array element is a citation row this package can draw.
 * @param value - one element of the meta's citations array.
 * @returns whether every field the rows read is present and well-typed.
 */
function isRow(value: unknown): value is CitationRowMeta {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<CitationRowMeta>
  return typeof row.citekey === 'string'
    && typeof row.title === 'string'
    && optional(row.year, 'number')
    && optional(row.group, 'string')
    && optional(row.confidence, 'number')
    && optional(row.uses, 'number')
    && optional(row.quarantined, 'boolean')
}

/**
 * The meta of one call, as an object or not at all.
 * @param block - the running or settled call.
 * @returns the meta object, or null when the call carries none.
 */
function metaOf(block: ToolCallBlock): { kind?: unknown; citation?: unknown; citations?: unknown } | null {
  const meta: unknown = 'meta' in block ? block.meta : undefined
  if (typeof meta !== 'object' || meta === null) return null
  return meta
}

/**
 * The citations one settled `citations_list` call reported.
 * @param block - the running or settled call.
 * @returns the validated rows, or null to fall back to the generic card.
 */
export function citationRowsOf(block: ToolCallBlock): readonly CitationRowMeta[] | null {
  const meta = metaOf(block)
  if (meta === null) return null
  if (meta.kind !== 'citations' || !Array.isArray(meta.citations)) return null
  return meta.citations.filter(isRow)
}

/**
 * The one citation a settled `citations_add` call reported.
 *
 * Both spellings are accepted — the single `citation` field and a one-element
 * list — because the confirmation row draws the same fact either way.
 * @param block - the running or settled call.
 * @returns the validated row, or null to fall back to the generic card.
 */
export function addedCitationOf(block: ToolCallBlock): CitationRowMeta | null {
  const meta = metaOf(block)
  if (meta === null) return null
  if (meta.kind === 'citation' && isRow(meta.citation)) return meta.citation
  const [first] = citationRowsOf(block) ?? []
  return first ?? null
}

/**
 * The label one group key reads as inside a tool row.
 *
 * A tool result carries the key, not the project's groups, so a user group
 * shows its key: the row states what the host said rather than inventing a
 * label it cannot look up.
 * @param key - the group key the meta carries, if any.
 * @param t - localized row copy.
 * @returns the label, or undefined when the meta names no group.
 */
export function metaGroupLabel(
  key: string | undefined,
  t: Translate<SciCitationsKey>,
): string | undefined {
  if (key === undefined) return undefined
  if (key === UNGROUPED) return t('group.ungrouped')
  if (key === QUARANTINE_GROUP) return t('group.quarantine')
  return key
}
