/**
 * Durable vocabulary of one paper project's citation pool: the user-defined
 * groups, the citations themselves, and the pool envelope a view renders.
 *
 * A citation row is scoped to ONE paper project, which is what separates it
 * from a `sci-library` entry: the library holds durable facts about a work
 * (title, authors, DOI), while a citation holds this project's writing-process
 * facts about that work — which group the user filed it under, how many times
 * the manuscript actually cites it, and whether it is quarantined. The two
 * therefore never merge, and `libraryId` is optional: a citekey hand-written
 * into `refs.bib` need not exist in any library.
 * @module @deepseek-ai/dsh-sci-citations/types
 */

/** One user-defined bucket citations are filed into, scoped to one project. */
export interface CitationGroup {
  /** Project slug the group belongs to. */
  project: string
  /** Stable group key; the token `move` and `removeGroup` spend. */
  key: string
  /** Display label as the user typed it. */
  label: string
  /** CSS color the view tints the group's count dot with. */
  color: string
  /** Sort position in the left column; ties break by key. */
  order: number
}

/** One work this project cites, or intends to cite. */
export interface Citation {
  /** Stable row id: `${project}:${citekey}`. */
  id: string
  /** Project slug this citation is scoped to. */
  project: string
  /** BibTeX citekey, stable once cited; the identity the manuscript uses. */
  citekey: string
  /** `sci_library` entry id when the work is also in the user's library. */
  libraryId?: string
  /** Work title, whitespace-collapsed. */
  title: string
  /** Author names as the resolving source gave them. */
  authors: readonly string[]
  /** Publication year, absent when no source dated the work. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Lowercase DOI with no `https://doi.org/` prefix. */
  doi?: string
  /** arXiv identifier without a version suffix. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Every source that vouched for this record, or `['bib']` when only `refs.bib` did. */
  sources: readonly string[]
  /** Group key; `'ungrouped'` by default, `'quarantine'` reserved. */
  group: string
  /** Deterministic 0..100 score from {@link module:@deepseek-ai/dsh-sci-citations/src/confidence}. */
  confidence: number
  /** Whether the entry is held back: `confidence < 70`, or set by hand. */
  quarantined: boolean
  /** In-text occurrences the last scan counted across the project's `.md`/`.tex`. */
  uses: number
  /** Epoch milliseconds of the scan that produced {@link Citation.uses}. */
  lastScanAt?: number
  /** Free-text user note. */
  note?: string
  /** Epoch milliseconds the row was created. */
  addedAt: number
  /** Epoch milliseconds of the last change to the row. */
  updatedAt: number
}

/** One project's whole citation pool, as the view reads it back. */
export interface CitationPool {
  /** Project slug the pool belongs to. */
  project: string
  /** Every group of this project, in `order` then `key` sequence. */
  groups: readonly CitationGroup[]
  /** Every citation of this project, ordered by citekey. */
  citations: readonly Citation[]
  /** Header counters, all computed from `citations`. */
  stats: {
    /** Citation count. */
    total: number
    /** Mean confidence rounded to an integer; `0` for an empty pool. */
    avgConfidence: number
    /** How many citations are quarantined. */
    quarantined: number
    /** Files the last scan read; `0` before the first scan. */
    scannedFiles: number
    /** Epoch milliseconds of the newest scan any citation carries. */
    lastScanAt?: number
  }
}

/** One `refs.bib` entry as {@link module:@deepseek-ai/dsh-sci-citations/src/bibtex} reads it. */
export interface BibEntry {
  /** Entry type without the `@`, lowercased: `article`, `inproceedings`, … */
  type: string
  /** Citekey exactly as the file spells it. */
  key: string
  /** Lowercased field name to its value with the outermost delimiter removed. */
  fields: Readonly<Record<string, string>>
  /** The `author` field split on ` and `; empty when the entry names no author. */
  authors: readonly string[]
}

/** One entry the parser could not read, reported instead of failing the file. */
export interface BibParseError {
  /** 1-based line the unreadable entry started on. */
  line: number
  /** What the parser expected; carries no file path. */
  message: string
}

/** Everything one `refs.bib` yielded: the entries it understood and the ones it did not. */
export interface BibParseResult {
  /** Entries in file order; a duplicate citekey appears once per occurrence. */
  entries: BibEntry[]
  /** One entry per unreadable block, in file order. */
  errors: BibParseError[]
}

/** The signals {@link module:@deepseek-ai/dsh-sci-citations/src/confidence} scores. */
export interface ConfidenceInput {
  /** Every source that vouched for the record; `['bib']` for a bib-only entry. */
  sources: readonly string[]
  /** Publication year, when a source dated the work. */
  year?: number
  /** Citation count, when a source reported one. */
  citedBy?: number
  /** Venue name, when a source named one. */
  venue?: string
  /** Lowercase DOI, when the work has one. */
  doi?: string
  /** Library status when the work is in the user's library; the final clamp. */
  libraryStatus?: string
}

/** One text file the scan read, as {@link module:@deepseek-ai/dsh-sci-citations/src/scan} counts over. */
export interface ScannedFile {
  /** Absolute path the file was read from; only reported, never re-resolved. */
  path: string
  /** Full decoded content. */
  text: string
}

/** One project the pool can be opened for. */
export interface CitationProject {
  /** Directory name under `projectRoot`. */
  slug: string
  /** Paper bundle slugs under `<project>/papers/`, in listing order. */
  papers: string[]
}

/** Response of the `projects` Remote endpoint. */
export interface CitationProjectsResult {
  /** Every project directory under `projectRoot`. */
  projects: CitationProject[]
}

/** Request of the `pool` Remote endpoint. */
export interface CitationPoolRequest {
  /** Project slug to read. */
  project: string
}

/** Request of the `upsertGroup` Remote endpoint. */
export interface CitationGroupUpsertRequest {
  /** Project the group belongs to. */
  project: string
  /** Group key to overwrite; a new key is derived from `label` when absent. */
  key?: string
  /** Display label. */
  label: string
  /** CSS color; a deterministic palette entry is chosen when absent. */
  color?: string
}

/** Request of the `removeGroup` Remote endpoint. */
export interface CitationGroupRemoveRequest {
  /** Project the group belongs to. */
  project: string
  /** Group key to drop; its citations return to `ungrouped`. */
  key: string
}

/** Request of the `move` Remote endpoint. */
export interface CitationMoveRequest {
  /** Project the citation belongs to. */
  project: string
  /** Citekey to refile. */
  citekey: string
  /** Destination group key; must already exist, or be `ungrouped`/`quarantine`. */
  group: string
}

/** A bibliographic record a caller hands in directly, bypassing every lookup. */
export interface CitationRecordInput {
  /** Work title; the one required field. */
  title: string
  /** Author names, `"Family, Given"` preferred. */
  authors?: readonly string[]
  /** Publication year. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** DOI, normalized to lowercase on the way in. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Citation count, when the caller knows one. */
  citedBy?: number
  /** Sources vouching for the record; defaults to `['manual']`. */
  sources?: readonly string[]
}

/** Request of the `add` Remote endpoint. */
export interface CitationAddRequest {
  /** Project to add into. */
  project: string
  /** Citekey to use; derived from the resolved authors and year when absent. */
  citekey?: string
  /** DOI to resolve through `ctx.sciLiterature`. */
  doi?: string
  /** arXiv id to resolve through `ctx.sciLiterature`. */
  arxivId?: string
  /** `sci_library` entry id to resolve through `ctx.sciLibrary`. */
  libraryId?: string
  /** A record the caller already has; skips every lookup. */
  record?: CitationRecordInput
  /** Group to file the new citation under; `ungrouped` by default. */
  group?: string
}

/** Response of the `add` Remote endpoint. */
export interface CitationAddResult {
  /** The stored citation, whether it was created or updated. */
  citation: Citation
  /** Whether the citekey was new to this project. */
  created: boolean
}

/** The fields `update` may change; every other column is service-owned. */
export interface CitationPatch {
  /** Free-text note; an empty string clears it. */
  note?: string
  /** Hold the entry back, or release it. */
  quarantined?: boolean
  /** Group key to refile into. */
  group?: string
}

/** Request of the `update` Remote endpoint. */
export interface CitationUpdateRequest {
  /** Project the citation belongs to. */
  project: string
  /** Citekey to patch. */
  citekey: string
  /** The fields to change. */
  patch: CitationPatch
}

/** Request of the `remove` Remote endpoint. */
export interface CitationRemoveRequest {
  /** Project the citation belongs to. */
  project: string
  /** Citekey to drop. */
  citekey: string
  /** Also delete the entry from every `refs.bib` of the project. */
  alsoBib?: boolean
}

/** Response of the mutating Remote endpoints that return no row. */
export interface CitationOkResult {
  /** Always `true`: the requested state holds after the call. */
  ok: true
}

/** Request of the `rescan` Remote endpoint. */
export interface CitationRescanRequest {
  /** Project to re-read from disk. */
  project: string
}

/**
 * Response of the `rescan` Remote endpoint.
 *
 * The pool is what the view renders; `parseErrors` is the other half of an
 * honest answer, because a `refs.bib` block the parser could not read is
 * silently missing from the pool otherwise.
 */
export interface CitationRescanResult {
  /** The pool as it stands after the merge. */
  pool: CitationPool
  /** One entry per unreadable `refs.bib` block, with the file it was in. */
  parseErrors: readonly CitationParseError[]
}

/** One unreadable `refs.bib` block, located in the project. */
export interface CitationParseError {
  /** Absolute path of the `refs.bib` the block was in. */
  path: string
  /** 1-based line the unreadable block started on. */
  line: number
  /** What the parser expected. */
  message: string
}

/** Request of the `exportBibtex` Remote endpoint. */
export interface CitationExportRequest {
  /** Project to export. */
  project: string
  /** Only this group; every citation when absent. */
  group?: string
}

/** Response of the `exportBibtex` Remote endpoint. */
export interface CitationExportResult {
  /** The rendered BibTeX file; empty when the selection is empty. */
  bibtex: string
}

/** What one `sci/citations-changed` event says happened. */
export type CitationOp = 'add' | 'update' | 'remove' | 'move' | 'group' | 'rescan'

/** Payload of `SessionEventMap['sci/citations-changed']`. */
export interface SciCitationsChangedData {
  /** The project whose pool changed. */
  readonly project: string
  /** What the tool call did. */
  readonly op: CitationOp
  /** The citekey involved, when the operation named one. */
  readonly citekey?: string
}
