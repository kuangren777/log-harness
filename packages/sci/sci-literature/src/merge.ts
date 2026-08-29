/**
 * Record identity, cross-source merging, and ranking.
 *
 * Four indexes describe the same work four ways: one gives a DOI, another only
 * an arXiv id, a third neither. Identity is therefore taken from the strongest
 * identifier a record carries — DOI, then arXiv id, then the normalized title —
 * and a record joins an existing group when ANY of those three keys is already
 * claimed, so the OpenAlex row with a DOI and the arXiv row with only an id
 * still land on one record once their titles agree.
 *
 * The merge keeps facts, never opinions: a present field beats an absent one,
 * the citation count is the largest any source reported, and `source` names the
 * index whose metadata is most complete rather than whichever answered first.
 * @module @deepseek-ai/dsh-sci-literature/src/merge
 */

import { createHash } from 'node:crypto'
import type { LiteratureRecord, LiteratureSource } from './types.ts'

/** Authors one record retains; a hundred-author collaboration is cut here. */
export const MAX_AUTHORS = 20

/** Characters one abstract retains. */
export const MAX_ABSTRACT_CHARS = 2000

/**
 * Which index's record wins the `source` label of a merged work, best first.
 * OpenAlex and Semantic Scholar carry venue, citations, and open-access state
 * together; Crossref is authoritative for publisher metadata but often has no
 * abstract; an arXiv preprint describes the same work before review.
 */
export const SOURCE_PRIORITY: readonly LiteratureSource[] = ['openalex', 'semanticscholar', 'crossref', 'arxiv']

/** Weight of the citation term against the rank term of {@link rankRecords}. */
export const CITATION_WEIGHT = 0.15

/** The record fields no source is required to fill. */
export type OptionalRecordFields =
  Partial<Pick<LiteratureRecord, 'year' | 'venue' | 'abstract' | 'doi' | 'arxivId' | 'pdfUrl' | 'citedBy'>>

/**
 * The same fields as a caller holds them, before the unfilled ones are dropped.
 * An adapter reads each field into a local that is `undefined` when its source
 * carried nothing, so the input admits explicit `undefined` where
 * {@link OptionalRecordFields} does not.
 */
export type OptionalRecordDraft = { [Field in keyof OptionalRecordFields]: OptionalRecordFields[Field] | undefined }

/**
 * Drop the optional fields no source filled.
 *
 * A record spreads the result rather than assigning the fields directly: an
 * explicit `undefined` is a present key to `JSON.stringify` and to the tool
 * registry's closed output schema, so an unfilled field has to be absent, not
 * undefined.
 * @param fields - the optional fields, each possibly unfilled.
 * @returns only the fields that hold a value.
 */
export function optionalFields(fields: OptionalRecordDraft): OptionalRecordFields {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) kept[key] = value
  }
  return kept
}

/** One mapped record together with the rank score its source positions earned it. */
export interface LiteratureCandidate {
  /** The record itself, already merged when several sources returned it. */
  readonly record: LiteratureRecord
  /** Sum of `1 / (position + 1)` over every source list this record appeared in. */
  readonly rankScore: number
}

/**
 * Collapse a title to the form two indexes agree on: letters and digits only,
 * lowercased, with punctuation, spacing, and compatibility forms removed.
 * @param title - the title as a source gave it.
 * @returns the comparison form, which is empty for a title with no letters or digits.
 */
export function normalizeTitle(title: string): string {
  return title.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Every key a record may be recognized by, strongest first.
 *
 * The title key is always present, so every record has at least one key: a
 * title that normalizes to nothing (an all-punctuation string) is hashed in its
 * trimmed raw form instead, which is still stable across replies.
 * @param record - the record to key.
 * @returns the DOI and arXiv keys the record can supply, followed by its title key.
 */
export function dedupeKeys(record: LiteratureRecord): readonly [string, ...string[]] {
  const keys: string[] = []
  if (record.doi !== undefined) keys.push(`doi:${record.doi}`)
  if (record.arxivId !== undefined) keys.push(`arxiv:${record.arxivId}`)
  const normalized = normalizeTitle(record.title)
  const digest = createHash('sha1').update(normalized === '' ? record.title.trim() : normalized).digest('hex')
  keys.push(`title:${digest}`)
  return keys as [string, ...string[]]
}

/**
 * The stable id of one record: its strongest key.
 * @param record - the record to key.
 * @returns the DOI key, else the arXiv key, else the title key.
 */
export function dedupeKey(record: LiteratureRecord): string {
  return dedupeKeys(record)[0]
}

/**
 * Assign one mapped record its stable id.
 * @param draft - the record an adapter built, with every other field final.
 * @returns the record carrying its {@link dedupeKey}.
 */
export function identify(draft: Omit<LiteratureRecord, 'id'>): LiteratureRecord {
  return { ...draft, id: dedupeKey({ ...draft, id: '' }) }
}

/**
 * Merge one record into the one already held for the same work.
 * @param held - the record merged so far.
 * @param next - the record another source returned for the same work.
 * @returns the merged record, keyed and labelled by the stronger of the two.
 */
export function mergeRecordPair(held: LiteratureRecord, next: LiteratureRecord): LiteratureRecord {
  const heldWins = SOURCE_PRIORITY.indexOf(held.source) <= SOURCE_PRIORITY.indexOf(next.source)
  const first = heldWins ? held : next
  const second = heldWins ? next : held
  const year = first.year ?? second.year
  const venue = first.venue ?? second.venue
  const abstract = first.abstract ?? second.abstract
  const doi = first.doi ?? second.doi
  const arxivId = first.arxivId ?? second.arxivId
  const pdfUrl = first.pdfUrl ?? second.pdfUrl
  const citedBy = held.citedBy === undefined || next.citedBy === undefined
    ? held.citedBy ?? next.citedBy
    : Math.max(held.citedBy, next.citedBy)
  const sources = [...held.sources]
  for (const source of next.sources) if (!sources.includes(source)) sources.push(source)
  const merged: LiteratureRecord = {
    id: first.id,
    title: first.title,
    authors: first.authors.length >= second.authors.length ? first.authors : second.authors,
    ...optionalFields({ year, venue, abstract, doi, arxivId, pdfUrl, citedBy }),
    url: first.url,
    source: first.source,
    sources,
  }
  // The merged record may have gained a DOI it did not have alone, so its id is
  // re-derived rather than inherited: a caller that re-keys the list later must
  // reach the same group.
  return { ...merged, id: dedupeKey(merged) }
}

/**
 * Merge every source's result list into one candidate list.
 * @param lists - one mapped record list per source, each in the order that source returned.
 * @returns one candidate per distinct work, in first-seen order, carrying the accumulated rank score.
 */
export function mergeRecords(lists: readonly (readonly LiteratureRecord[])[]): readonly LiteratureCandidate[] {
  const groups: { record: LiteratureRecord; rankScore: number }[] = []
  const byKey = new Map<string, number>()
  for (const list of lists) {
    list.forEach((record, position) => {
      const keys = dedupeKeys(record)
      const found = keys.map(key => byKey.get(key)).find(entry => entry !== undefined)
      const index = found ?? groups.length
      const held = found === undefined ? undefined : groups[found]
      const group = held === undefined
        ? { record, rankScore: 0 }
        : { record: mergeRecordPair(held.record, record), rankScore: held.rankScore }
      group.rankScore += 1 / (position + 1)
      groups[index] = group
      // Registered after the merge so the group also answers to the keys it
      // only just gained, such as a DOI the first source did not carry.
      for (const key of dedupeKeys(group.record)) byKey.set(key, index)
    })
  }
  return groups
}

/**
 * Order merged candidates by how well every source agreed on them.
 *
 * `1 / (position + 1)` per source list rewards a work several indexes ranked
 * highly over one that a single index ranked first, and the citation term is
 * logarithmic so a 5000-citation review cannot bury an on-topic recent paper.
 * @param candidates - the merged candidates.
 * @returns the records, best first; equal scores order by descending year, then by title.
 */
export function rankRecords(candidates: readonly LiteratureCandidate[]): readonly LiteratureRecord[] {
  const scored = candidates.map(candidate => ({
    record: candidate.record,
    score: candidate.rankScore + CITATION_WEIGHT * Math.log10((candidate.record.citedBy ?? 0) + 1),
  }))
  scored.sort((left, right) => right.score - left.score
    || (right.record.year ?? 0) - (left.record.year ?? 0)
    || (left.record.title < right.record.title ? -1 : left.record.title > right.record.title ? 1 : 0))
  return scored.map(entry => entry.record)
}

/**
 * Trim an author list to {@link MAX_AUTHORS} entries, dropping empty names.
 * @param authors - the names a source listed.
 * @returns the retained names in source order.
 */
export function clampAuthors(authors: readonly string[]): readonly string[] {
  return authors.map(name => name.trim()).filter(name => name !== '').slice(0, MAX_AUTHORS)
}

/**
 * Collapse an abstract to plain text of at most {@link MAX_ABSTRACT_CHARS}.
 * @param abstract - the abstract text, possibly with markup and hard wrapping.
 * @returns the trimmed text, or `undefined` when nothing is left.
 */
export function clampAbstract(abstract: string): string | undefined {
  const text = abstract.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (text === '') return undefined
  return text.length > MAX_ABSTRACT_CHARS ? text.slice(0, MAX_ABSTRACT_CHARS) : text
}

/**
 * Reduce a DOI to the comparison form: lowercase, with any URL or `doi:` prefix removed.
 * @param doi - the DOI as a source gave it.
 * @returns the bare lowercase DOI, or `undefined` when the value is not one.
 */
export function normalizeDoi(doi: string): string | undefined {
  const bare = doi.trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
  return bare.startsWith('10.') ? bare : undefined
}

/**
 * Reduce an arXiv identifier to the comparison form: no URL prefix, no version suffix.
 * @param value - the identifier or abstract URL as a source gave it.
 * @returns the bare identifier, or `undefined` when the value is not one.
 */
export function normalizeArxivId(value: string): string | undefined {
  const bare = value.trim().toLowerCase()
    .replace(/^https?:\/\/arxiv\.org\/abs\//, '')
    .replace(/^arxiv:/, '')
    .replace(/v\d+$/, '')
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/.test(bare) ? bare : undefined
}

/**
 * Collapse a title to one line of plain text.
 * @param title - the title as a source gave it.
 * @returns the collapsed title, or `undefined` when nothing is left.
 */
export function cleanTitle(title: string): string | undefined {
  const text = title.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text === '' ? undefined : text
}
