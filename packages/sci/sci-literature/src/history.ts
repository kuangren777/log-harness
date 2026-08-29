/**
 * The pure half of the search history: row identity, the optional-column
 * filter, and which rows the retention limit drops.
 *
 * A row is keyed by its query rather than by the moment it ran, so searching
 * the same thing twice moves one chip to the front of the "recent" strip
 * instead of stacking two identical ones.
 * @module @deepseek-ai/dsh-sci-literature/src/history
 */

import { createHash } from 'node:crypto'
import type { LiteratureHistoryEntry, LiteratureSourceError } from './types.ts'

/** Columns a history row may leave unfilled. */
const OPTIONAL_COLUMNS = ['sourceErrors'] as const

/**
 * Stable id of one query's history row.
 * @param query - the query text as the caller sent it.
 * @returns the row key: a digest of the case-folded, whitespace-collapsed query.
 */
export function historyId(query: string): string {
  return createHash('sha1').update(query.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex')
}

/**
 * Render source failures as the one column the history row stores them in.
 * @param errors - the failures one search collected.
 * @returns comma-joined `<source>:<code>` pairs, or `undefined` when every source answered.
 */
export function formatSourceErrors(errors: readonly LiteratureSourceError[]): string | undefined {
  if (errors.length === 0) return undefined
  return errors.map(error => `${error.source}:${error.code}`).join(',')
}

/**
 * Build one history row with every unfilled optional column left absent.
 *
 * An empty string is "no value": the read-side schema requires a present
 * `sourceErrors` to be non-empty, and one row storing `''` would refuse the
 * whole domain at the next boot rather than at the write that produced it.
 * @param draft - the row's required columns plus whichever optional ones apply.
 * @returns the row, carrying only the columns that hold a value.
 */
export function historyRow(draft: LiteratureHistoryEntry): LiteratureHistoryEntry {
  const record: Record<string, unknown> = {
    id: draft.id,
    query: draft.query,
    at: draft.at,
    hits: draft.hits,
  }
  for (const column of OPTIONAL_COLUMNS) {
    const value = draft[column]
    if (value !== undefined && value !== '') record[column] = value
  }
  return record as unknown as LiteratureHistoryEntry
}

/**
 * Order history rows the way the "recent" strip shows them.
 * @param entries - the stored rows in table order.
 * @returns the rows newest first; equal timestamps order by id so the result is stable.
 */
export function sortHistory(entries: readonly LiteratureHistoryEntry[]): readonly LiteratureHistoryEntry[] {
  return [...entries].sort((left, right) => right.at - left.at
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

/**
 * Which rows the retention limit drops.
 * @param entries - the stored rows in table order.
 * @param limit - how many rows the deployment retains.
 * @returns the ids to delete, oldest first.
 */
export function expiredHistoryIds(entries: readonly LiteratureHistoryEntry[], limit: number): readonly string[] {
  return sortHistory(entries).slice(limit).map(entry => entry.id).reverse()
}
