/**
 * Deployment-varying policy of the knowledge base.
 *
 * Every field carries a schema default, because a settings surface renders the
 * resolved section and a default that lived only at the use site would read
 * there as no value at all. Nothing here is a credential: the library reaches
 * only the open-access PDF URLs its own entries already carry.
 * @module @deepseek-ai/dsh-sci-library/src/config
 */

import z from '@deepseek-ai/schemastery'

/** Sandbox directory every entry's files live under, one subdirectory per entry. */
export const DEFAULT_LIBRARY_ROOT = '/home/user/sci/library'

/** Largest single file the upload route and the PDF download accept, in bytes. */
export const DEFAULT_MAX_FILE_BYTES = 52_428_800

/** Entries the library retains before the oldest file-less ones are dropped. */
export const DEFAULT_MAX_ENTRIES = 5000

/** Budget for one open-access PDF download, in milliseconds. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/** Entries one listing returns when the caller names no limit. */
export const DEFAULT_PAGE_LIMIT = 50

/** Largest page one listing may return; also the model-facing schema bound. */
export const MAX_PAGE_LIMIT = 100

/** Neighbours `related` returns when the caller names no limit. */
export const DEFAULT_RELATED_LIMIT = 3

/** Largest neighbour count `related` may return. */
export const MAX_RELATED_LIMIT = 20

/** Longest note one entry may carry, in characters. */
export const MAX_NOTE_CHARS = 4000

/** Longest title one entry may carry, in characters. */
export const MAX_TITLE_CHARS = 500

/** Tags one entry may carry. */
export const MAX_TAGS = 32

/** Deployment-varying policy of the knowledge base. */
export interface Config {
  /**
   * Sandbox directory the library's files live under. One subdirectory per
   * entry, so a skill reading a PDF opens `<libraryRoot>/<entry-dir>/<name>`.
   */
  libraryRoot: string
  /** Largest single file the upload route and the PDF download accept, in bytes. */
  maxFileBytes: number
  /**
   * Entries the library retains. Past the limit the oldest entries by
   * `updatedAt` are dropped, but never one that owns files: dropping that row
   * would orphan bytes on disk no surface can reach afterwards.
   */
  maxEntries: number
  /** Budget for one open-access PDF download, in milliseconds. */
  fetchTimeoutMs: number
}

/** Loader validation for the knowledge base's deployment policy. */
export const Config: z<Config> = z.object({
  libraryRoot: z.string().default(DEFAULT_LIBRARY_ROOT),
  maxFileBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_BYTES),
  maxEntries: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES),
  fetchTimeoutMs: z.number().step(1).min(1).default(DEFAULT_FETCH_TIMEOUT_MS),
})
