/**
 * The user's knowledge base for the science-research agent profile: the
 * `ctx.sciLibrary` service, the `library_search` and `library_add` tools, the
 * `/library-api` upload and download routes, and the open-access PDF fetch.
 *
 * The service owns four contributions, all effects of the mounting fiber:
 *
 * - The `sci_library_entry` table. It is NOT a projection of a session log:
 *   most of what it holds — a PDF the user dragged into the browser, a tag they
 *   typed, a status they set — was never model-visible, so the row is the only
 *   record any of it happened.
 * - The `sci.library` Remote the browser's library view is made of: `list`,
 *   `get`, `add`, `update`, `remove`, `related`, and `fetchPdf`.
 * - `library_search` and `library_add` on `ctx.tools`, plus the one prompt
 *   section telling the model to look in the user's own collection before the
 *   public indexes, and to open a stored PDF from disk rather than re-download.
 * - The `/library-api` prefix route, which is the browser's only way to put
 *   bytes into the sandbox and the only way to read a stored file back past the
 *   workspace API's 8 MiB read cap.
 *
 * A default-exported Service class, so the Loader publishes `ctx.sciLibrary`
 * and reads `static inject` off the class.
 * @module @deepseek-ai/dsh-sci-library
 */

export type * from './types.ts'
export {
  Config,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_LIBRARY_ROOT,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_RELATED_LIMIT,
  MAX_NOTE_CHARS,
  MAX_PAGE_LIMIT,
  MAX_RELATED_LIMIT,
  MAX_TAGS,
  MAX_TITLE_CHARS,
} from './config.ts'
export {
  LIBRARY_KINDS,
  LIBRARY_SOURCES,
  LIBRARY_STATUSES,
  OPTIONAL_COLUMNS,
  applyPatch,
  clampTitle,
  entryFromDraft,
  entryFromRecord,
  entryRow,
  expiredEntryIds,
  facetTags,
  filterEntries,
  libraryCounts,
  mergeEntry,
  normalizeTags,
  orderEntries,
  pageBounds,
  withFile,
} from './entries.ts'
export type { RecordLike } from './entries.ts'
export { LibraryError, libraryErrorCode } from './error.ts'
export type { LibraryErrorCode } from './error.ts'
export { libraryChangedData, recordLibraryChange } from './events.ts'
export {
  MAX_REDIRECTS,
  PDF_MAGIC,
  checkDownloadUrl,
  fetchPdfBytes,
  isPrivateHost,
  looksLikePdf,
  readCapped,
} from './fetch-bytes.ts'
export type { FetchBytesOptions } from './fetch-bytes.ts'
export {
  ALLOWED_EXTENSIONS,
  MAX_FILE_NAME_CHARS,
  entryDirName,
  entryFileAbsolutePath,
  entryFilePath,
  extensionOf,
  mediaTypeOf,
  readEntryFile,
  sanitizeFileName,
  sha256Hex,
  writeEntryFile,
} from './files.ts'
export type { LibraryFs } from './files.ts'
export {
  MULTIPART_OVERHEAD_BYTES,
  boundaryOf,
  filenameOf,
  readCappedBody,
  readSingleFileUpload,
  splitParts,
} from './multipart.ts'
export type { MultipartPart } from './multipart.ts'
export { LIBRARY_NAMESPACE, LibraryRuntime, SERVICE_KEY, draftId, pdfFileName } from './runtime.ts'
export {
  ABSTRACT_WEIGHT,
  AUTHOR_WEIGHT,
  SCORED_ABSTRACT_CHARS,
  TAG_WEIGHT,
  TITLE_WEIGHT,
  compareText,
  entryTerms,
  overlap,
  queryTerms,
  rankEntries,
  relatedEntries,
  scoreEntry,
  sortByRecency,
  tokenize,
} from './score.ts'
export { ENTRY_TABLE, libraryEntrySchema, libraryFileSchema, sciLibraryDomainSpec } from './spec.ts'
export {
  LIBRARY_ADD_TOOL,
  LIBRARY_PROMPT_ORDER,
  LIBRARY_PROMPT_SECTION,
  LIBRARY_SEARCH_TOOL,
  RENDERED_AUTHORS,
  RENDERED_TAGS,
  addFromArgs,
  applyLibraryTools,
  formatLibraryAddOutput,
  formatLibraryEntry,
  formatLibrarySearchOutput,
  libraryAddMetaFromValue,
  libraryPromptText,
  librarySearchMetaFromValue,
  libraryToolEntry,
  normalizeDoi,
} from './tool.ts'
export type {
  LibraryAddToolArgs,
  LibraryAddToolValue,
  LibrarySearchToolArgs,
  LibrarySearchToolValue,
  LibraryToolEntry,
  LibraryTooling,
} from './tool.ts'
export {
  FILE_PATH,
  FORBIDDEN_BODY,
  LIBRARY_ROUTE_PREFIX,
  NEW_ENTRY,
  UPLOAD_PATH,
  createLibraryRouter,
  parseKind,
  requireParam,
  sendJson,
  statusForCode,
} from './upload-route.ts'
export type { LibraryRouteHost, RequestTrustCheck } from './upload-route.ts'

export { LibraryRuntime as default } from './runtime.ts'
