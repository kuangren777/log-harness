/**
 * Pure derivations over one pool: what the selected group shows, how many
 * citations each bucket holds, which tone a confidence reads in, and the
 * plain-text block the copy button writes.
 *
 * Every one of them is a function of the pool the host returned, so the list
 * on screen, the counts beside the group names, and the copied text cannot
 * disagree with each other.
 */

import type { Citation } from './contract.ts'

/** Left-column selection showing the whole pool. */
export const ALL_GROUP = 'all'

/** Left-column selection showing the citations the host holds out. */
export const QUARANTINE_GROUP = 'quarantine'

/** Group key of a citation no user group has taken. */
export const UNGROUPED = 'ungrouped'

/** Confidence at or above which a citation reads as settled. */
const HIGH_CONFIDENCE = 90

/** Confidence at or above which a citation reads as workable. */
const MID_CONFIDENCE = 75

/** How a confidence reading is toned. */
export type ConfidenceTone = 'high' | 'mid' | 'low'

/**
 * The citations one left-column selection shows.
 *
 * The quarantine bucket reads the flag rather than the group key: the host
 * holds a citation out without moving it, so a quarantined citation stays
 * visible in the group its user put it in.
 * @param citations - the pool's citations.
 * @param selection - `all`, `quarantine`, or a group key.
 * @returns the citations that selection shows, in pool order.
 */
export function visibleCitations(
  citations: readonly Citation[],
  selection: string,
): readonly Citation[] {
  if (selection === ALL_GROUP) return citations
  if (selection === QUARANTINE_GROUP) return citations.filter(row => row.quarantined)
  return citations.filter(row => row.group === selection)
}

/**
 * How many citations one left-column selection shows.
 * @param citations - the pool's citations.
 * @param selection - `all`, `quarantine`, or a group key.
 * @returns the count beside that row.
 */
export function selectionCount(citations: readonly Citation[], selection: string): number {
  return visibleCitations(citations, selection).length
}

/**
 * The tone one confidence reading carries.
 * @param confidence - the host's 0..100 score.
 * @returns which of the three tones draws it.
 */
export function confidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= HIGH_CONFIDENCE) return 'high'
  if (confidence >= MID_CONFIDENCE) return 'mid'
  return 'low'
}

/**
 * One citation as a line of the copied block: `[citekey] authors. title.
 * venue year. doi`.
 *
 * A field the record does not carry loses its slot rather than leaving an
 * empty one, so the block never claims a venue, a year, or a DOI the host
 * did not report.
 * @param citation - the citation as the host reported it.
 * @returns the line.
 */
export function citationLine(citation: Citation): string {
  const { authors, venue, year, doi } = citation
  const parts = [`[${citation.citekey}]`]
  if (authors.length > 0) parts.push(`${authors.join(', ')}.`)
  parts.push(`${citation.title}.`)
  const published = [venue, year === undefined ? undefined : String(year)]
    .filter((part): part is string => part !== undefined)
    .join(' ')
  if (published !== '') parts.push(`${published}.`)
  if (doi !== undefined) parts.push(doi)
  return parts.join(' ')
}

/**
 * The citation block the copy button writes: one line per listed citation.
 * @param citations - the citations the list is showing.
 * @returns the block, newline-separated.
 */
export function citationBlock(citations: readonly Citation[]): string {
  return citations.map(citationLine).join('\n')
}

/**
 * The `group` argument one export takes.
 *
 * `all` and the quarantine bucket export the whole project: the host filters
 * an export by group key, and the quarantine bucket is a flag over every
 * group rather than a group of its own.
 * @param selection - the left column's selection.
 * @returns the group key to export, or undefined for the whole project.
 */
export function exportGroupOf(selection: string): string | undefined {
  return selection === ALL_GROUP || selection === QUARANTINE_GROUP ? undefined : selection
}
