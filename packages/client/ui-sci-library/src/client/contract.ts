/**
 * The knowledge library's data vocabulary.
 *
 * Every member here is JSON-compatible: the components see plain entries and
 * callbacks, never an RPC envelope or a `Response`, so the whole wire seam is
 * the `apply` body that builds {@link SciLibraryInjected}.
 *
 * The entry types below MIRROR `packages/sci/sci-library/src/types.ts`
 * (spec 16-Workbench/07-spec-library.md §3.1) verbatim, for the same reason
 * `ui-sci-search` mirrors the literature record: this compilation states the
 * vocabulary itself until the host package's generated types land in it.
 * {@link LibraryRecord} is the one exception — it is DERIVED from the slot ②
 * declares, so the record shape this package hands to `add` cannot drift from
 * the record ② hands to the action strip.
 */

import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the `search.result.actions` SlotMap declaration whose owner
// share is the bibliographic record this package puts into the library.
import type {} from '@deepseek-ai/dsh-client-ui-sci-search/client'

/** What one library entry is: a work, a dataset, or a standalone note. */
export type LibraryKind = 'paper' | 'dataset' | 'note'

/** How far the user has taken one entry. */
export type LibraryStatus = 'unread' | 'reading' | 'read' | 'verified' | 'low-confidence'

/** Where one entry came from: the four indexes, a manual record, or an upload. */
export type LibrarySource =
  | 'openalex' | 'semanticscholar' | 'arxiv' | 'crossref' | 'manual' | 'upload'

/** One file stored under an entry's directory in the sandbox. */
export interface LibraryFile {
  /** Path below the host's library root; the browser never sees the root itself. */
  path: string
  /** File name, which is also the `name` the file route takes. */
  name: string
  /** Byte length as the host wrote it. */
  size: number
  /** Media type the host derived from the extension. */
  mediaType: string
  /** Content digest the host computed while writing. */
  sha256: string
  /** Epoch milliseconds the file entered the library. */
  addedAt: number
}

/** One library entry, as the host stores and returns it. */
export interface LibraryEntry {
  /** Stable id: ②'s record id, `file:<sha256>` for an upload, `note:<ulid>` for a note. */
  id: string
  /** Work, dataset, or note. */
  kind: LibraryKind
  /** Entry title. */
  title: string
  /** Authors as the winning source gave them. */
  authors: readonly string[]
  /** Publication year, when one is known. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Plain-text abstract. */
  abstract?: string
  /** Lowercase DOI with no url prefix. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Open-access PDF, when a source reported one. */
  pdfUrl?: string
  /** Citation count reported by the winning source. */
  citedBy?: number
  /** Every source that contributed to this entry. */
  sources: readonly LibrarySource[]
  /** User tags. */
  tags: readonly string[]
  /** Reading status. */
  status: LibraryStatus
  /** The user's own note. */
  note?: string
  /** Files stored under this entry. */
  files: readonly LibraryFile[]
  /** Epoch milliseconds the entry entered the library. */
  addedAt: number
  /** Epoch milliseconds of the last edit. */
  updatedAt: number
}

/** One library read as the host takes it. */
export interface LibraryQuery {
  /** Free-text query scored lexically over title, abstract, tags, and authors. */
  query?: string
  /** Restrict to one kind. */
  kind?: LibraryKind
  /** Restrict to one status. */
  status?: LibraryStatus
  /** Restrict to entries carrying one tag. */
  tag?: string
  /** Result cap, 1..100. */
  limit?: number
  /** Rows to skip. */
  offset?: number
}

/** One tag and how many entries carry it. */
export interface LibraryTagCount {
  /** The tag itself. */
  tag: string
  /** How many entries carry it. */
  count: number
}

/** The library's totals, which the filter chips are read off. */
export interface LibraryCounts {
  /** Every entry. */
  all: number
  /** Entries of kind `paper`. */
  paper: number
  /** Entries of kind `dataset`. */
  dataset: number
  /** Entries of kind `note`. */
  note: number
  /** Entries whose status is `low-confidence`. */
  lowConfidence: number
}

/** One settled library read. */
export interface LibraryPage {
  /** The page's entries, already filtered, scored, and cut. */
  entries: readonly LibraryEntry[]
  /** Matching entries before the limit cut. */
  total: number
  /** Tag cloud over the whole library, most used first. */
  tags: readonly LibraryTagCount[]
  /** Library totals per filter chip. */
  counts: LibraryCounts
}

/** The fields the detail page may write back. */
export interface LibraryPatch {
  /** Replacement tag set. */
  tags?: readonly string[]
  /** Replacement reading status. */
  status?: LibraryStatus
  /** Replacement note. */
  note?: string
  /** Replacement title. */
  title?: string
}

/**
 * The bibliographic record ② hands to `add`.
 *
 * Derived from `search.result.actions`, never restated: the action this
 * package registers into that slot receives exactly this record, and the
 * `add` call forwards it untouched, so one declaration types both ends.
 */
export type LibraryRecord = OwnerOf<'search.result.actions'>['record']

/**
 * One settled library call as the components consume it: a total vocabulary,
 * so an unreachable host, a rejected request, and a refused write all arrive
 * as data rather than as a throw inside an event handler.
 */
export type LibraryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string }

/** Why one upload produced no file; every arm has its own copy. */
export type UploadErrorCode = 'too-large' | 'unsupported-type' | 'forbidden' | 'failed'

/** One settled upload. */
export type UploadOutcome =
  | { ok: true; entry: LibraryEntry }
  | { ok: false; code: UploadErrorCode }

/** One upload as the injected face takes it. */
export interface UploadRequest {
  /** Target entry id, or `new` to mint one around the file. */
  entryId: string
  /** Which kind a newly minted entry gets. */
  kind: 'paper' | 'dataset'
  /** The file the user picked. */
  file: File
}

/** One file's text, or why there is none to show. */
export type FileTextOutcome =
  | { ok: true; text: string }
  | { ok: false; code: string }

/**
 * The injected face the library view drives; every member is built in `apply`.
 *
 * Declared as properties rather than methods because the components
 * destructure them out of their props: a method position would bind them to
 * this face.
 */
export interface SciLibraryInjected {
  /**
   * Read one page of the library: takes the query and its filters, and
   * answers with the page or the failure code, never a throw.
   */
  readonly list: (query: LibraryQuery) => Promise<LibraryOutcome<LibraryPage>>
  /** Read one entry by id. */
  readonly get: (id: string) => Promise<LibraryOutcome<LibraryEntry>>
  /** Write the editable fields of one entry, answering with the stored entry. */
  readonly update: (id: string, patch: LibraryPatch) => Promise<LibraryOutcome<LibraryEntry>>
  /** Remove one entry and its files. */
  readonly remove: (id: string) => Promise<LibraryOutcome<null>>
  /** Read the entries the host scores as related to one entry; an unreadable list is empty. */
  readonly related: (id: string) => Promise<readonly LibraryEntry[]>
  /** Have the host download this entry's open-access PDF into the library. */
  readonly fetchPdf: (id: string) => Promise<LibraryOutcome<LibraryEntry>>
  /** Send one picked file to the library's upload route. */
  readonly upload: (request: UploadRequest) => Promise<UploadOutcome>
  /** Read one stored file as text, for the previews that show source rather than bytes. */
  readonly readText: (entryId: string, name: string) => Promise<FileTextOutcome>
}

/**
 * The injected face of the 「加入知识库」 action this package contributes to
 * ②'s result cards. One call: the button's other state is the shared store's
 * id set, which the same `apply` seeds and keeps.
 */
export interface SciLibraryAddInjected {
  /** Put one bibliographic record into the library, answering with the stored entry. */
  readonly add: (record: LibraryRecord) => Promise<LibraryOutcome<LibraryEntry>>
}
