/**
 * Durable vocabulary of the knowledge base: one library entry, the files it
 * owns inside the sandbox, and the query/response shapes the browser view and
 * the model tools exchange with `ctx.sciLibrary`.
 *
 * These names describe what the user collected, never a card, a route, or a
 * transport concept: the same entry is rendered by the library view, returned
 * by `library_search`, and read back by a skill opening the PDF on disk.
 * @module @deepseek-ai/dsh-sci-library/types
 */

import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature/types'

/** What one library entry is: a work, a data file, or the user's own note. */
export type LibraryKind = 'paper' | 'dataset' | 'note'

/** How far the user has got with one entry. */
export type LibraryStatus = 'unread' | 'reading' | 'read' | 'verified' | 'low-confidence'

/** Where one entry's metadata came from. */
export type LibrarySource = 'openalex' | 'semanticscholar' | 'arxiv' | 'crossref' | 'manual' | 'upload'

/** One file stored under the entry's directory in the sandbox. */
export interface LibraryFile {
  /** Sandbox path relative to `Config.libraryRoot`, always `<entry-dir>/<name>`. */
  path: string
  /** File name as stored on disk, already sanitized; never a path. */
  name: string
  /** Size in bytes as written. */
  size: number
  /** Media type the download route answers with. */
  mediaType: string
  /** Lowercase hex SHA-256 of the stored bytes. */
  sha256: string
  /** Epoch milliseconds when the file entered the library. */
  addedAt: number
}

/** One row of the knowledge base. */
export interface LibraryEntry {
  /**
   * Stable id: the {@link LiteratureRecord.id} when the entry came from a
   * literature search, `file:<sha256>` for a browser upload, `note:<uuid>` for
   * a note the user wrote.
   */
  id: string
  /** What this entry is. */
  kind: LibraryKind
  /** Work title, or the file name for an upload with no better name. */
  title: string
  /** `"Family, Given"` as the source gave them. */
  authors: readonly string[]
  /** Publication year, absent when nothing dated the work. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Plain-text abstract. */
  abstract?: string
  /** Lowercase DOI with no `https://doi.org/` prefix. */
  doi?: string
  /** arXiv identifier without a version suffix. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Direct PDF link, set only when the work is open access. */
  pdfUrl?: string
  /** Citation count as the winning source reported it. */
  citedBy?: number
  /** Every source that contributed metadata, in arrival order. */
  sources: readonly LibrarySource[]
  /** User-assigned tags, lowercase, de-duplicated, in insertion order. */
  tags: readonly string[]
  /** How far the user has got with the entry. */
  status: LibraryStatus
  /** The user's own note, at most 4000 characters. */
  note?: string
  /** Files stored under the entry's directory, oldest first. */
  files: readonly LibraryFile[]
  /** Epoch milliseconds when the entry was first added. */
  addedAt: number
  /** Epoch milliseconds of the last change to the entry. */
  updatedAt: number
}

/** One library listing as a caller states it. */
export interface LibraryQuery {
  /** Free text scored lexically over title, tags, abstract, and authors. */
  query?: string
  /** Keep only entries of this kind. */
  kind?: LibraryKind
  /** Keep only entries in this state. */
  status?: LibraryStatus
  /** Keep only entries carrying this tag. */
  tag?: string
  /** Entries to return, 1..100, default 50. */
  limit?: number
  /** Entries to skip before the page starts. */
  offset?: number
}

/** One page of the knowledge base, with the facets the view renders beside it. */
export interface LibraryPage {
  /** The page's entries, ranked by score when a query was given, newest first otherwise. */
  entries: readonly LibraryEntry[]
  /** Entries the filters matched before pagination. */
  total: number
  /** Every tag on the filtered entries with its count, most frequent first. */
  tags: readonly { tag: string; count: number }[]
  /** Whole-library counts the filter chips show; not affected by the filters. */
  counts: { all: number; paper: number; dataset: number; note: number; lowConfidence: number }
}

/** Request of the `get` Remote endpoint. */
export interface LibraryGetRequest {
  /** Id of the entry to read. */
  id: string
}

/** Response of the `get` Remote endpoint: the entry, or why there is none. */
export type LibraryGetResult = { entry: LibraryEntry } | { error: 'not-found' }

/** Request of the `add` Remote endpoint. */
export interface LibraryAddRequest {
  /** A literature record to store verbatim; wins over {@link LibraryAddRequest.entry}. */
  record?: LiteratureRecord
  /** A hand-built entry when no literature record exists. */
  entry?: Partial<LibraryEntry> & { title: string }
  /** Tags to attach; merged with an existing entry's tags rather than replacing them. */
  tags?: readonly string[]
  /** Download the open-access PDF into the entry's directory when one is known. */
  withPdf?: boolean
}

/** Response of the `add` Remote endpoint. */
export interface LibraryAddResult {
  /** The stored entry, after any merge. */
  entry: LibraryEntry
  /** False when the id was already in the library and this call merged into it. */
  created: boolean
  /** Failure code of the optional PDF download; absent when none was asked for or it succeeded. */
  fetchError?: string
}

/** The fields `update` may change; every one is optional and absent means unchanged. */
export interface LibraryPatch {
  /** Replace the whole tag list. */
  tags?: readonly string[]
  /** Move the entry to another state. */
  status?: LibraryStatus
  /** Replace the user's note; an empty string clears it. */
  note?: string
  /** Rename the entry. */
  title?: string
}

/** Request of the `update` Remote endpoint. */
export interface LibraryUpdateRequest {
  /** Id of the entry to change. */
  id: string
  /** The fields to change. */
  patch: LibraryPatch
}

/** Response of the `update` Remote endpoint. */
export type LibraryUpdateResult = { entry: LibraryEntry } | { error: 'not-found' }

/** Request of the `remove` Remote endpoint. */
export interface LibraryRemoveRequest {
  /** Id of the entry to drop; an unknown id is not an error. */
  id: string
  /** Also delete the entry's files from the sandbox. */
  deleteFiles?: boolean
}

/** Response of the `remove` Remote endpoint. */
export interface LibraryRemoveResult {
  /** True when a row existed and was dropped. */
  removed: boolean
  /**
   * Files emptied by `deleteFiles`. The filesystem seam offers no removal, so
   * a cleared file is truncated to zero bytes rather than unlinked.
   */
  filesCleared: number
}

/** Request of the `related` Remote endpoint. */
export interface LibraryRelatedRequest {
  /** Id of the entry to find neighbours of. */
  id: string
  /** Neighbours to return, 1..20, default 3. */
  limit?: number
}

/** Response of the `related` Remote endpoint. */
export interface LibraryRelatedResult {
  /** The highest-scoring other entries, best first; empty when the id is unknown. */
  entries: readonly LibraryEntry[]
}

/** Request of the `fetchPdf` Remote endpoint. */
export interface LibraryFetchPdfRequest {
  /** Id of the entry whose `pdfUrl` should be downloaded. */
  id: string
}

/** Response of the `fetchPdf` Remote endpoint. */
export type LibraryFetchPdfResult =
  | { entry: LibraryEntry }
  | { error: string }

/** Payload of `SessionEventMap['sci/library-changed']`. */
export interface SciLibraryChangedData {
  /** What happened to the entry. */
  readonly op: 'add' | 'update' | 'remove'
  /** Id of the entry the operation named. */
  readonly id: string
  /** Kind of the entry as it stood after the operation. */
  readonly kind: LibraryKind
}

/** One file as the upload route parsed it out of the multipart body. */
export interface UploadedFile {
  /** File name the browser sent, already sanitized to a bare safe name. */
  name: string
  /** Media type resolved from the extension allowlist, never the browser's claim. */
  mediaType: string
  /** The file's bytes. */
  bytes: Uint8Array
}
