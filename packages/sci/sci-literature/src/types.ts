/**
 * Durable vocabulary of the literature layer: one merged bibliographic record,
 * the request that produces a list of them, and the result envelope that
 * reports which sources answered and which failed.
 *
 * These types are the contract `ui-sci-search` renders and the knowledge-base
 * and citation layers reuse, so they name bibliographic facts only — never a
 * source's own wire fields, and never a card, panel, or transport concept.
 * @module @deepseek-ai/dsh-sci-literature/types
 */

/** One bibliographic index this package queries. */
export type LiteratureSource = 'openalex' | 'semanticscholar' | 'arxiv' | 'crossref'

/** One work, merged across every source that returned it. */
export interface LiteratureRecord {
  /** Stable id: `doi:<lowercase doi>` | `arxiv:<id>` | `title:<sha1(normalized title)>`. */
  id: string
  /** Work title as the winning source gives it, whitespace-collapsed. */
  title: string
  /** `"Family, Given"` as the source gives; at most 20 entries. */
  authors: readonly string[]
  /** Publication year, absent when no source dated the work. */
  year?: number
  /** Journal, conference, or repository name, absent when no source named one. */
  venue?: string
  /** Plain-text abstract of at most 2000 characters, absent when no source carried one. */
  abstract?: string
  /** Lowercase DOI with no `https://doi.org/` prefix. */
  doi?: string
  /** arXiv identifier without a version suffix, for example `2607.09182`. */
  arxivId?: string
  /** Canonical landing page: `doi.org`, `arxiv.org`, or the source's own URL. */
  url: string
  /** Direct PDF link, set only when the work is open access. */
  pdfUrl?: string
  /** Citation count, the maximum any source reported. */
  citedBy?: number
  /** The source whose record won the merge. */
  source: LiteratureSource
  /** Every source that returned this work, in merge order. */
  sources: readonly LiteratureSource[]
}

/** One literature search as a caller states it. */
export interface LiteratureSearchRequest {
  /** Free-text query; every source receives the same string. */
  query: string
  /** Inclusive lower bound on publication year. */
  yearFrom?: number
  /** Inclusive upper bound on publication year. */
  yearTo?: number
  /** Records to return after merging, 1..20, default 10. */
  limit?: number
}

/** One source that did not answer, reported instead of failing the search. */
export interface LiteratureSourceError {
  /** The source that failed. */
  source: LiteratureSource
  /** Stable machine-routable failure class, from {@link LiteratureError}. */
  code: string
  /** Human-readable detail; carries no credential and no internal host. */
  message: string
}

/** The outcome of one literature search across every configured source. */
export interface LiteratureSearchResult {
  /** The merged records, ranked and truncated to the request's limit. */
  records: readonly LiteratureRecord[]
  /** Merged record count before the limit truncated the list. */
  total: number
  /** One entry per source that failed; an empty list means every source answered. */
  sourceErrors: readonly LiteratureSourceError[]
  /** Wall-clock duration of the fan-out, in milliseconds. */
  elapsedMs: number
}

/** One recorded search, as `recent()` returns it. */
export interface LiteratureHistoryEntry {
  /** Stable row id; the token `forget` consumes. */
  id: string
  /** The query text as the caller sent it. */
  query: string
  /** Epoch milliseconds when the search completed. */
  at: number
  /** Merged record count the search produced before truncation. */
  hits: number
  /** Comma-joined `<source>:<code>` pairs, absent when every source answered. */
  sourceErrors?: string
}

/** Response of the `recent` Remote endpoint. */
export interface LiteratureRecentResult {
  /** Newest-first history entries, at most the configured `historyLimit`. */
  entries: readonly LiteratureHistoryEntry[]
}

/** Request of the `forget` Remote endpoint. */
export interface LiteratureForgetRequest {
  /** Id of the history row to drop; an unknown id is not an error. */
  id: string
}

/** Response of the `forget` Remote endpoint. */
export interface LiteratureForgetResult {
  /** Always `true`: the row is absent after the call whether or not it existed. */
  ok: true
}

/** Payload of `SessionEventMap['sci/literature-searched']`. */
export interface SciLiteratureSearchedData {
  /** The query the tool call carried. */
  readonly query: string
  /** Merged record count before the limit truncated the list. */
  readonly hits: number
  /** One `<source>:<code>` pair per source that failed; empty when all answered. */
  readonly sourceErrors: readonly string[]
}

/** What one adapter needs from the resolved configuration for a single call. */
export interface LiteratureAdapterOptions {
  /** Contact address for the OpenAlex and Crossref polite pools; empty opts out. */
  mailto: string
  /** Product identity every outbound request announces. */
  userAgent: string
  /** Records to request from this index. */
  maxPerSource: number
  /** Semantic Scholar key, when one was resolved; the source works without it. */
  apiKey?: string
}
