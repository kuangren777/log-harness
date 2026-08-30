/**
 * The pure shape of a pool: row identity, the optional-column filter, the
 * `refs.bib` merge rule, and the header counters.
 *
 * Everything a `rescan` decides lives here rather than in the service, because
 * the merge rule is the one part of this layer a reader has to be able to check
 * line by line: it is what guarantees that re-reading `refs.bib` never destroys
 * a decision someone made in the view.
 * @module @deepseek-ai/dsh-sci-citations/src/pool
 */

import { formatBibtexEntry } from './bibtex.ts'
import { confidence, isBibOnly, BIB_SOURCE } from './confidence.ts'
import { QUARANTINE_BELOW, UNGROUPED } from './config.ts'
import type { BibEntry, Citation, CitationGroup, CitationPool } from './types.ts'

/** Columns a citation row may leave unfilled. */
const OPTIONAL_CITATION_COLUMNS = ['libraryId', 'year', 'venue', 'doi', 'arxivId', 'url', 'lastScanAt', 'note'] as const

/** Colors new groups cycle through when the caller names none. */
export const GROUP_PALETTE: readonly string[] = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']

/** Group key given to a label that folds to nothing. */
export const FALLBACK_GROUP_KEY = 'group'

/** Entry type written for a work with no venue. */
export const FALLBACK_BIB_TYPE = 'misc'

/** Entry type written for a work with a venue. */
export const DEFAULT_BIB_TYPE = 'article'

/**
 * The storage key of one citation.
 * @param project - the project slug.
 * @param citekey - the citekey.
 * @returns `${project}:${citekey}`, which is also {@link Citation.id}.
 */
export function citationId(project: string, citekey: string): string {
  return `${project}:${citekey}`
}

/**
 * The storage key of one group.
 * @param project - the project slug.
 * @param key - the group key.
 * @returns `${project}:${key}`.
 */
export function groupRowKey(project: string, key: string): string {
  return `${project}:${key}`
}

/**
 * Build one citation row with every unfilled optional column left absent.
 *
 * An empty string is "no value": the read-side schema requires a present
 * `note` or `venue` to be non-empty, so one row storing `''` would refuse the
 * whole domain at the next boot rather than at the write that produced it.
 * @param draft - the row's required columns plus whichever optional ones apply.
 * @returns the row, carrying only the columns that hold a value.
 */
export function citationRow(draft: Citation): Citation {
  const row: Record<string, unknown> = {
    id: draft.id,
    project: draft.project,
    citekey: draft.citekey,
    title: draft.title,
    authors: [...draft.authors],
    sources: [...draft.sources],
    group: draft.group,
    confidence: draft.confidence,
    quarantined: draft.quarantined,
    uses: draft.uses,
    addedAt: draft.addedAt,
    updatedAt: draft.updatedAt,
  }
  for (const column of OPTIONAL_CITATION_COLUMNS) {
    const value = draft[column]
    if (value !== undefined && value !== '') row[column] = value
  }
  return row as unknown as Citation
}

/**
 * Fold a BibTeX field value into plain text.
 * @param value - the raw value with its outer delimiter already removed.
 * @returns the value with grouping braces dropped and whitespace collapsed.
 */
export function cleanBibValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Normalize a DOI however the caller spelled it.
 * @param value - a bare DOI, a `doi:` form, or a `https://doi.org/` URL.
 * @returns the lowercase bare DOI, or `undefined` when nothing was left.
 */
export function normalizeDoi(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const bare = value.trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
  return bare === '' ? undefined : bare
}

/**
 * Read a BibTeX year field.
 * @param value - the raw field value, or `undefined`.
 * @returns the year, or `undefined` when the field held no four-digit number.
 */
export function bibYear(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const match = /\d{4}/.exec(value)
  return match === null ? undefined : Number(match[0])
}

/** The bibliographic half of a citation, as one `refs.bib` entry states it. */
export interface BibFacts {
  /** Work title, or `''` when the entry has no title field. */
  title: string
  /** Author names split from the `author` field. */
  authors: string[]
  /** Publication year. */
  year?: number
  /** `journal`, else `booktitle`. */
  venue?: string
  /** Normalized DOI. */
  doi?: string
  /** arXiv id from the `eprint` field. */
  arxivId?: string
  /** Landing page from the `url` field. */
  url?: string
}

/**
 * Project one `refs.bib` entry onto the fields a citation carries.
 * @param entry - the parsed entry.
 * @returns the bibliographic facts, with absent fields left out.
 */
export function bibFacts(entry: BibEntry): BibFacts {
  const venue = entry.fields['journal'] ?? entry.fields['booktitle']
  const doi = normalizeDoi(entry.fields['doi'])
  const arxivId = entry.fields['eprint']
  const url = entry.fields['url']
  const year = bibYear(entry.fields['year'])
  return {
    title: cleanBibValue(entry.fields['title'] ?? ''),
    authors: entry.authors.map(author => cleanBibValue(author)),
    ...year === undefined ? {} : { year },
    ...venue === undefined ? {} : { venue: cleanBibValue(venue) },
    ...doi === undefined ? {} : { doi },
    ...arxivId === undefined ? {} : { arxivId: cleanBibValue(arxivId) },
    ...url === undefined ? {} : { url: cleanBibValue(url) },
  }
}

/**
 * Apply the quarantine floor to a flag somebody asked for.
 *
 * The stored flag is the disjunction {@link Citation.quarantined} documents:
 * the automatic rule below {@link QUARANTINE_BELOW}, or a person's decision
 * above it. So a request to release an entry that scores under the threshold
 * only moves the decided half, and the row that comes back still reads
 * quarantined — which is the answer, not a silent refusal.
 * @param score - the row's confidence.
 * @param requested - the flag the caller asked the row to carry.
 * @returns the flag the row stores.
 */
export function quarantineFloor(score: number, requested: boolean): boolean {
  return requested || score < QUARANTINE_BELOW
}

/**
 * Whether a citation is held back at a newly computed score.
 *
 * A row that was quarantined while scoring at or above the threshold was
 * quarantined by a person, and no recomputation releases it: the threshold may
 * raise the flag but never lowers one somebody set by hand.
 * @param previous - the stored row, or `undefined` for a citation being created.
 * @param score - the freshly computed confidence.
 * @returns whether the row should carry the quarantine flag.
 */
export function quarantineFlag(previous: Citation | undefined, score: number): boolean {
  const manual = previous !== undefined && previous.quarantined && previous.confidence >= QUARANTINE_BELOW
  return quarantineFloor(score, manual)
}

/**
 * Build the citation one previously unknown `refs.bib` entry becomes.
 * @param project - the project slug.
 * @param entry - the parsed entry.
 * @param now - epoch milliseconds to stamp the row with.
 * @returns the new row, sourced `['bib']` and scored by the formula.
 */
export function citationFromBib(project: string, entry: BibEntry, now: number): Citation {
  const facts = bibFacts(entry)
  const sources = [BIB_SOURCE]
  const score = confidence({
    sources,
    ...facts.year === undefined ? {} : { year: facts.year },
    ...facts.venue === undefined ? {} : { venue: facts.venue },
    ...facts.doi === undefined ? {} : { doi: facts.doi },
  })
  return citationRow({
    id: citationId(project, entry.key),
    project,
    citekey: entry.key,
    title: facts.title === '' ? entry.key : facts.title,
    authors: facts.authors,
    ...facts.year === undefined ? {} : { year: facts.year },
    ...facts.venue === undefined ? {} : { venue: facts.venue },
    ...facts.doi === undefined ? {} : { doi: facts.doi },
    ...facts.arxivId === undefined ? {} : { arxivId: facts.arxivId },
    ...facts.url === undefined ? {} : { url: facts.url },
    sources,
    group: UNGROUPED,
    confidence: score,
    quarantined: score < QUARANTINE_BELOW,
    uses: 0,
    addedAt: now,
    updatedAt: now,
  })
}

/**
 * Merge one `refs.bib` entry into a citation that already exists.
 *
 * The bibliographic half is replaced by what the file says, because the file is
 * where the manuscript's own bibliography lives. The decided half — `group`,
 * `note`, `libraryId`, `addedAt`, and `uses` — is untouched. Confidence is
 * recomputed only for an entry whose sole provenance is `refs.bib`: a citation
 * that came from a real index carries signals (`citedBy` above all) that the
 * file never held, so recomputing it from the file would lower it every time.
 * @param existing - the stored row.
 * @param entry - the parsed entry naming the same citekey.
 * @param now - epoch milliseconds to stamp the update with.
 * @returns the merged row, or `existing` unchanged when nothing differed.
 */
export function mergeBibEntry(existing: Citation, entry: BibEntry, now: number): Citation {
  const facts = bibFacts(entry)
  const merged: Citation = {
    ...existing,
    title: facts.title === '' ? existing.title : facts.title,
    authors: facts.authors.length === 0 ? existing.authors : facts.authors,
    ...facts.year === undefined ? {} : { year: facts.year },
    ...facts.venue === undefined ? {} : { venue: facts.venue },
    ...facts.doi === undefined ? {} : { doi: facts.doi },
    ...facts.arxivId === undefined ? {} : { arxivId: facts.arxivId },
    ...facts.url === undefined ? {} : { url: facts.url },
  }
  if (isBibOnly(existing.sources)) {
    const score = confidence({
      sources: existing.sources,
      ...merged.year === undefined ? {} : { year: merged.year },
      ...merged.venue === undefined ? {} : { venue: merged.venue },
      ...merged.doi === undefined ? {} : { doi: merged.doi },
    })
    merged.confidence = score
    merged.quarantined = quarantineFlag(existing, score)
  }
  const next = citationRow({ ...merged, updatedAt: now })
  const unchanged = JSON.stringify(citationRow(existing)) === JSON.stringify(citationRow({ ...merged, updatedAt: existing.updatedAt }))
  return unchanged ? citationRow(existing) : next
}

/**
 * Render one citation as the `refs.bib` entry that represents it.
 * @param citation - the stored row.
 * @returns the entry, typed `article` when a venue is known and `misc` otherwise.
 */
export function bibEntryFromCitation(citation: Citation): BibEntry {
  const fields: Record<string, string> = { title: citation.title }
  if (citation.year !== undefined) fields['year'] = String(citation.year)
  if (citation.venue !== undefined) fields['journal'] = citation.venue
  if (citation.doi !== undefined) fields['doi'] = citation.doi
  if (citation.arxivId !== undefined) fields['eprint'] = citation.arxivId
  if (citation.url !== undefined) fields['url'] = citation.url
  return {
    type: citation.venue === undefined ? FALLBACK_BIB_TYPE : DEFAULT_BIB_TYPE,
    key: citation.citekey,
    fields,
    authors: [...citation.authors],
  }
}

/**
 * Render a selection of citations as one BibTeX file.
 * @param citations - the citations to export, in the order they should appear.
 * @returns the file text, ending in a newline; `''` for an empty selection.
 */
export function renderBibtexFile(citations: readonly Citation[]): string {
  if (citations.length === 0) return ''
  return `${citations.map(citation => formatBibtexEntry(bibEntryFromCitation(citation))).join('\n\n')}\n`
}

/**
 * Order citations the way every surface shows them.
 * @param citations - the rows in table order.
 * @returns the rows by citekey, which is the identity the manuscript uses.
 */
export function sortCitations(citations: readonly Citation[]): Citation[] {
  // Citekeys are unique within a project, so the comparator never sees a tie.
  return [...citations].sort((left, right) => (left.citekey < right.citekey ? -1 : 1))
}

/**
 * Order groups the way the left column shows them.
 * @param groups - the rows in table order.
 * @returns the rows by `order`, ties broken by key so the result is stable.
 */
export function sortGroups(groups: readonly CitationGroup[]): CitationGroup[] {
  return [...groups].sort((left, right) => left.order - right.order || (left.key < right.key ? -1 : 1))
}

/**
 * The header counters of one pool.
 * @param citations - every citation of the project.
 * @param scannedFiles - files the last scan read in this process; `0` before one ran.
 * @returns the stats block, with `lastScanAt` absent until a scan has run.
 */
export function poolStats(citations: readonly Citation[], scannedFiles: number): CitationPool['stats'] {
  const total = citations.length
  const sum = citations.reduce((carry, citation) => carry + citation.confidence, 0)
  const scanned = citations.map(citation => citation.lastScanAt).filter(at => at !== undefined)
  return {
    total,
    avgConfidence: total === 0 ? 0 : Math.round(sum / total),
    quarantined: citations.filter(citation => citation.quarantined).length,
    scannedFiles,
    ...scanned.length === 0 ? {} : { lastScanAt: Math.max(...scanned) },
  }
}

/**
 * Fold a group label into a key.
 * @param label - the label as the user typed it.
 * @returns a lowercase hyphenated key, or {@link FALLBACK_GROUP_KEY} when the
 *   label held nothing a key can be made of.
 */
export function groupKeyFromLabel(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
  return key === '' ? FALLBACK_GROUP_KEY : key
}

/**
 * The palette color at one position.
 * @param index - how many groups the project already has.
 * @returns the color, cycling through {@link GROUP_PALETTE}.
 */
export function paletteColor(index: number): string {
  // The modulo is always in range; noUncheckedIndexedAccess cannot see that.
  return GROUP_PALETTE[index % GROUP_PALETTE.length] as string
}
