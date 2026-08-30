/**
 * The pure half of the knowledge base: how an entry is built from what the
 * caller had, how a second add merges into a row that already exists, which
 * rows the size cap drops, and how one listing is filtered, faceted, and paged.
 *
 * None of it touches storage or the filesystem, so every rule below — the merge
 * that must not lose a tag, the trim that must not orphan a file — is decided
 * by a function a test can call directly.
 * @module @deepseek-ai/dsh-sci-library/src/entries
 */

import { MAX_NOTE_CHARS, MAX_TAGS, MAX_TITLE_CHARS } from './config.ts'
import { compareText, rankEntries, sortByRecency } from './score.ts'
import type {
  LibraryEntry,
  LibraryFile,
  LibraryKind,
  LibraryPatch,
  LibraryQuery,
  LibrarySource,
  LibraryStatus,
} from './types.ts'

/** Columns a row may leave unfilled; an unfilled one is absent, never `undefined`. */
export const OPTIONAL_COLUMNS = ['year', 'venue', 'abstract', 'doi', 'arxivId', 'url', 'pdfUrl', 'citedBy', 'note'] as const

/**
 * Build one storable row with every unfilled optional column left absent.
 *
 * An empty string is "no value": the read-side schema requires a present
 * optional column to be non-empty, so a row storing `''` would refuse the whole
 * domain at the next boot rather than at the write that produced it.
 * @param draft - the row's required columns plus whichever optional ones apply.
 * @returns the row, carrying only the columns that hold a value.
 */
export function entryRow(draft: LibraryEntry): LibraryEntry {
  const record: Record<string, unknown> = {
    id: draft.id,
    kind: draft.kind,
    title: draft.title,
    authors: [...draft.authors],
    sources: [...draft.sources],
    tags: [...draft.tags],
    status: draft.status,
    files: draft.files.map(file => ({ ...file })),
    addedAt: draft.addedAt,
    updatedAt: draft.updatedAt,
  }
  for (const column of OPTIONAL_COLUMNS) {
    const value = draft[column]
    if (value !== undefined && value !== '') record[column] = value
  }
  return record as unknown as LibraryEntry
}

/**
 * Normalize a tag list the way every surface stores it.
 * @param tags - tags as a caller wrote them.
 * @returns lowercase, trimmed, de-duplicated tags in insertion order, at most {@link MAX_TAGS}.
 */
export function normalizeTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase()
    if (tag !== '' && !seen.has(tag)) seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

/**
 * Clamp one title to what a row may hold.
 * @param title - the title as a caller wrote it.
 * @returns the trimmed title, truncated to {@link MAX_TITLE_CHARS}.
 * @throws TypeError when the title is blank; an entry with no title has nothing to list.
 */
export function clampTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') throw new TypeError('sci-library: an entry needs a title')
  return trimmed.slice(0, MAX_TITLE_CHARS)
}

/** The bibliographic half of a literature record, as an entry stores it. */
export interface RecordLike {
  /** Stable record id, reused as the entry id. */
  id: string
  /** Work title. */
  title: string
  /** Author names. */
  authors: readonly string[]
  /** Publication year. */
  year?: number
  /** Journal, conference, or repository. */
  venue?: string
  /** Plain-text abstract. */
  abstract?: string
  /** Lowercase DOI. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Open-access PDF link. */
  pdfUrl?: string
  /** Citation count. */
  citedBy?: number
  /** Every index that returned the work. */
  sources?: readonly string[]
}

/**
 * Copy the optional bibliographic columns a source carried.
 * @param source - the record or draft to read.
 * @returns only the columns that hold a value.
 */
function optionalColumns(source: Partial<LibraryEntry>): Partial<LibraryEntry> {
  const copied: Record<string, unknown> = {}
  for (const column of OPTIONAL_COLUMNS) {
    const value = source[column]
    if (value !== undefined && value !== '') copied[column] = value
  }
  return copied
}

/**
 * Build the entry one literature record becomes.
 * @param record - the record a search returned.
 * @param tags - tags the caller attached.
 * @param now - epoch milliseconds of the add.
 * @returns the new entry, `unread` and file-less.
 */
export function entryFromRecord(record: RecordLike, tags: readonly string[], now: number): LibraryEntry {
  return entryRow({
    id: record.id,
    kind: 'paper',
    title: clampTitle(record.title),
    authors: [...record.authors],
    sources: (record.sources ?? []) as readonly LibrarySource[],
    tags: normalizeTags(tags),
    status: 'unread',
    files: [],
    addedAt: now,
    updatedAt: now,
    ...optionalColumns(record as Partial<LibraryEntry>),
  })
}

/**
 * Build the entry one hand-written draft becomes.
 * @param draft - the caller's fields; only `title` is required.
 * @param id - the id the runtime minted for it.
 * @param tags - tags the caller attached, merged with the draft's own.
 * @param now - epoch milliseconds of the add.
 * @returns the new entry.
 */
export function entryFromDraft(
  draft: Partial<LibraryEntry> & { title: string },
  id: string,
  tags: readonly string[],
  now: number,
): LibraryEntry {
  return entryRow({
    id,
    kind: draft.kind ?? 'paper',
    title: clampTitle(draft.title),
    authors: [...draft.authors ?? []],
    sources: draft.sources ?? ['manual'],
    tags: normalizeTags([...draft.tags ?? [], ...tags]),
    status: draft.status ?? 'unread',
    files: [],
    addedAt: now,
    updatedAt: now,
    ...optionalColumns(draft),
  })
}

/**
 * Merge a second add of the same id into the row already stored.
 *
 * The stored row wins every field it already holds: a re-add must not silently
 * rewrite a title the user edited or a status they set. What it does gain is
 * the union of the tags and the columns it never had, so adding the same paper
 * again from a search that knows its DOI fills the DOI in.
 * @param existing - the stored row.
 * @param incoming - the entry the second add would have created.
 * @param now - epoch milliseconds of the merge.
 * @returns the merged row.
 */
export function mergeEntry(existing: LibraryEntry, incoming: LibraryEntry, now: number): LibraryEntry {
  const filled: Record<string, unknown> = {}
  for (const column of OPTIONAL_COLUMNS) {
    const value = existing[column] ?? incoming[column]
    if (value !== undefined && value !== '') filled[column] = value
  }
  const sources = new Set<LibrarySource>([...existing.sources, ...incoming.sources])
  const names = new Set(existing.files.map(file => file.name))
  return entryRow({
    ...existing,
    ...filled as Partial<LibraryEntry>,
    sources: [...sources],
    tags: normalizeTags([...existing.tags, ...incoming.tags]),
    authors: existing.authors.length >= incoming.authors.length ? existing.authors : incoming.authors,
    files: [...existing.files, ...incoming.files.filter(file => !names.has(file.name))],
    updatedAt: now,
  })
}

/**
 * Apply one user edit to a stored row.
 * @param entry - the stored row.
 * @param patch - the fields to change; an absent field is unchanged.
 * @param now - epoch milliseconds of the edit.
 * @returns the edited row.
 */
export function applyPatch(entry: LibraryEntry, patch: LibraryPatch, now: number): LibraryEntry {
  return entryRow({
    ...entry,
    ...patch.title === undefined ? {} : { title: clampTitle(patch.title) },
    ...patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) },
    ...patch.status === undefined ? {} : { status: patch.status },
    ...patch.note === undefined ? {} : { note: patch.note.slice(0, MAX_NOTE_CHARS) },
    updatedAt: now,
  })
}

/**
 * Attach one stored file to a row, replacing a same-named earlier one.
 * @param entry - the stored row.
 * @param file - the file just written to the sandbox.
 * @param now - epoch milliseconds of the upload.
 * @returns the row carrying the file.
 */
export function withFile(entry: LibraryEntry, file: LibraryFile, now: number): LibraryEntry {
  return entryRow({
    ...entry,
    files: [...entry.files.filter(existing => existing.name !== file.name), file],
    updatedAt: now,
  })
}

/**
 * Keep the entries one listing's filters admit, before any query scoring.
 * @param entries - every entry in the library.
 * @param query - the listing's filters; `query.query` is not applied here.
 * @returns the entries the kind, status, and tag filters kept.
 */
export function filterEntries(entries: readonly LibraryEntry[], query: LibraryQuery): readonly LibraryEntry[] {
  const tag = query.tag?.trim().toLowerCase()
  return entries.filter(entry => (query.kind === undefined || entry.kind === query.kind)
    && (query.status === undefined || entry.status === query.status)
    && (tag === undefined || tag === '' || entry.tags.includes(tag)))
}

/**
 * The tag cloud one filtered set produces.
 * @param entries - the filtered entries.
 * @returns every tag with its count, most frequent first, ties by tag name.
 */
export function facetTags(entries: readonly LibraryEntry[]): readonly { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag))
}

/**
 * The whole-library counts the filter chips show.
 *
 * They are deliberately computed over every entry rather than over the filtered
 * set: a chip that renders its own filter's result would read `0` for every
 * kind the current filter excludes, which is the one number it must not show.
 * @param entries - every entry in the library.
 * @returns the counts each chip renders.
 */
export function libraryCounts(entries: readonly LibraryEntry[]): {
  all: number
  paper: number
  dataset: number
  note: number
  lowConfidence: number
} {
  const byKind: Record<LibraryKind, number> = { paper: 0, dataset: 0, note: 0 }
  let lowConfidence = 0
  for (const entry of entries) {
    byKind[entry.kind] += 1
    if (entry.status === 'low-confidence') lowConfidence += 1
  }
  return { all: entries.length, ...byKind, lowConfidence }
}

/**
 * Order one filtered set the way the page shows it.
 * @param entries - the filtered entries.
 * @param query - the free-text query, or undefined/blank for recency order.
 * @returns the ordered entries; a query drops everything it did not match.
 */
export function orderEntries(entries: readonly LibraryEntry[], query: string | undefined): readonly LibraryEntry[] {
  const text = query?.trim() ?? ''
  return text === '' ? sortByRecency(entries) : rankEntries(entries, text)
}

/**
 * Which rows the size cap drops.
 *
 * A row that owns files is never dropped, however old it is: its bytes are in
 * the sandbox, and deleting the row that names them leaves files no surface can
 * list, open, or remove. A library whose entries all own files therefore grows
 * past `maxEntries` rather than orphaning anything.
 * @param entries - every entry in the library.
 * @param maxEntries - how many entries the deployment retains.
 * @returns the ids to delete, oldest first.
 */
export function expiredEntryIds(entries: readonly LibraryEntry[], maxEntries: number): readonly string[] {
  if (entries.length <= maxEntries) return []
  const dropped = sortByRecency(entries).slice(maxEntries).filter(entry => entry.files.length === 0)
  return dropped.map(entry => entry.id).reverse()
}

/**
 * Resolve one listing's page bounds.
 * @param limit - the caller's limit, if any.
 * @param offset - the caller's offset, if any.
 * @param defaultLimit - the limit a caller who named none gets.
 * @param maxLimit - the largest limit accepted.
 * @returns the resolved bounds, clamped into range.
 */
export function pageBounds(
  limit: number | undefined,
  offset: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; offset: number } {
  const resolved = limit === undefined ? defaultLimit : Math.trunc(limit)
  return {
    limit: Math.min(Math.max(Number.isFinite(resolved) ? resolved : defaultLimit, 1), maxLimit),
    offset: Math.max(Math.trunc(offset ?? 0) || 0, 0),
  }
}

/** Every status a row may carry, for the model-facing schema enum. */
export const LIBRARY_STATUSES: readonly LibraryStatus[] = ['unread', 'reading', 'read', 'verified', 'low-confidence']

/** Every kind a row may carry, for the model-facing schema enum. */
export const LIBRARY_KINDS: readonly LibraryKind[] = ['paper', 'dataset', 'note']

/** Every metadata source a row may name, for the model-facing schema enum. */
export const LIBRARY_SOURCES: readonly LibrarySource[] = ['openalex', 'semanticscholar', 'arxiv', 'crossref', 'manual', 'upload']
