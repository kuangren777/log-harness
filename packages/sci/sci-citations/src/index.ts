/**
 * One citation pool per paper project: the `ctx.sciCitations` service, the
 * `citations_list` and `citations_add` tools, the `refs.bib` reader and writer,
 * and the scan that counts what the manuscript actually cites.
 *
 * The service owns four contributions, all effects of the mounting fiber:
 *
 * - The pool itself, two tables keyed by `<project>:<citekey>` and
 *   `<project>:<group>`. Most of a row is re-derivable from `refs.bib` and a
 *   file scan, which is what `rescan` does; what is NOT re-derivable is the
 *   part a person decided — the group, the note, a hand-set quarantine — so
 *   the merge rule updates the first half and never touches the second.
 * - `citations_add` and `citations_list` on `ctx.tools`, plus the prompt
 *   section that tells the model a citekey comes back from the tool and is
 *   never invented.
 * - The deterministic confidence score. No model call and no network: the same
 *   signals always produce the same number, so it can be stored on the row and
 *   shown to a user as a reason rather than an opinion.
 * - The in-text use count, read out of the project's own `.md` and `.tex`
 *   through the same `ctx.fs` seam the model's `read` tool uses.
 *
 * A default-exported Service class, so the Loader publishes `ctx.sciCitations`
 * and reads `static inject` off the class.
 * @module @deepseek-ai/dsh-sci-citations
 */

export type * from './types.ts'
export {
  AUTHOR_SEPARATOR,
  BIB_FIELD_ORDER,
  NON_RECORD_TYPES,
  formatBibtexEntry,
  lineAt,
  parseBibtex,
  removeBibtexEntry,
  splitAuthors,
  upsertBibtexEntry,
} from './bibtex.ts'
export {
  ANONYMOUS_FAMILY,
  UNDATED_YEAR,
  citekeyBase,
  citekeySuffix,
  familyName,
  normalizeCitekey,
  uniqueCitekey,
} from './citekey.ts'
export {
  BIB_ONLY_SCORE,
  BIB_SOURCE,
  CITED_BY_CAP,
  CITED_BY_MAX,
  LOW_CONFIDENCE_CEILING,
  NOT_ARXIV_ONLY_POINTS,
  SOURCES_ONE,
  SOURCES_THREE,
  SOURCES_TWO,
  STATUS_LOW_CONFIDENCE,
  STATUS_VERIFIED,
  VENUE_POINTS,
  YEAR_POINTS,
  citedByPoints,
  confidence,
  isArxivOnly,
  isBibOnly,
  sourcePoints,
} from './confidence.ts'
export {
  Config,
  DEFAULT_MAX_CITATIONS,
  DEFAULT_PROJECT_ROOT,
  DEFAULT_SCAN_MAX_BYTES,
  DELIVERY_DIR,
  PAPERS_DIR,
  PAPER_SRC_DIR,
  QUARANTINE,
  QUARANTINE_BELOW,
  REFS_FILE,
  SCAN_EXTENSIONS,
  SCAN_MAX_DEPTH,
  SCAN_SKIP_DIRS,
  UNGROUPED,
} from './config.ts'
export {
  CITATIONS_INVALID_REQUEST,
  CITATIONS_NO_PROJECT,
  CITATIONS_POOL_FULL,
  CITATIONS_UNKNOWN_CITEKEY,
  CITATIONS_UNKNOWN_GROUP,
  CITATIONS_UNKNOWN_PROJECT,
  CITATIONS_UNRESOLVED,
  CitationsError,
} from './error.ts'
export { citationsChangedData, recordCitationsChange } from './events.ts'
export {
  hasScannedExtension,
  joinPath,
  listDirEntries,
  readTextIfPresent,
  scanTextFiles,
  statPath,
  writeTextFile,
} from './fs-scan.ts'
export type { CitationFileSystem, ScanLimits } from './fs-scan.ts'
export {
  DEFAULT_BIB_TYPE,
  FALLBACK_BIB_TYPE,
  FALLBACK_GROUP_KEY,
  GROUP_PALETTE,
  bibEntryFromCitation,
  bibFacts,
  bibYear,
  citationFromBib,
  citationId,
  citationRow,
  cleanBibValue,
  groupKeyFromLabel,
  groupRowKey,
  mergeBibEntry,
  normalizeDoi,
  paletteColor,
  poolStats,
  quarantineFlag,
  quarantineFloor,
  renderBibtexFile,
  sortCitations,
  sortGroups,
} from './pool.ts'
export type { BibFacts } from './pool.ts'
export { assertProjectSlug, pathSegments, projectSlugFromCwd } from './project.ts'
export { LIBRARY_SERVICE, LITERATURE_SERVICE, LOOKUP_LIMIT, optionalService, pickWork, recordOf, resolveWork } from './resolve.ts'
export type {
  CitationLibraryLookup,
  CitationLiteratureLookup,
  LibraryEntryLike,
  ResolvedRecord,
  ResolvedWork,
  WorkLike,
} from './resolve.ts'
export { CITATION_PATTERN, countUses, mentionedCitekeys } from './scan.ts'
export {
  CITATION_GROUP_TABLE,
  CITATION_TABLE,
  citationGroupSchema,
  citationSchema,
  sciCitationsDomainSpec,
} from './spec.ts'
export { CITATIONS_NAMESPACE, CitationsRuntime, RESERVED_GROUPS, SERVICE_KEY } from './runtime.ts'
export {
  CITATIONS_ADD_TOOL,
  CITATIONS_LIST_TOOL,
  CITATIONS_PROMPT_ORDER,
  CITATIONS_PROMPT_SECTION,
  CITATIONS_PROMPT_TEXT,
  addMetaFromValue,
  applyCitationsTool,
  citationEntry,
  formatAddOutput,
  formatCitationLine,
  formatListOutput,
  listMetaFromValue,
  listValue,
  toolProject,
} from './tool.ts'
export type {
  CitationToolEntry,
  CitationsAddArgs,
  CitationsAddValue,
  CitationsListArgs,
  CitationsListValue,
  CitationsPoolService,
} from './tool.ts'

export { CitationsRuntime as default } from './runtime.ts'
