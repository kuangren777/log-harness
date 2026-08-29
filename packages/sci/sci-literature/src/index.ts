/**
 * Cross-index literature search for the science-research agent profile: the
 * `ctx.sciLiterature` service, the `literature_search` tool, and the "recent
 * queries" history the browser's search view reads back.
 *
 * The service owns three contributions, all effects of the mounting fiber:
 *
 * - The fan-out itself. One query reaches OpenAlex, Semantic Scholar, arXiv,
 *   and Crossref in parallel, each on its own timeout; the four answers are
 *   merged by DOI, arXiv id, or normalized title into one ranked record list,
 *   and a source that failed is reported in `sourceErrors` rather than failing
 *   the search.
 * - `literature_search` on `ctx.tools`, plus the prompt section that tells the
 *   model to use it instead of `web_search` for papers and to cite only the
 *   identifiers the search returned.
 * - The `sci_literature_history` table, which is what the browser view's recent
 *   chips are made of. It is NOT a projection of a session log: a search run
 *   from the view has no session to fold.
 *
 * A default-exported Service class, so the Loader publishes `ctx.sciLiterature`
 * and reads `static inject` off the class.
 * @module @deepseek-ai/dsh-sci-literature
 */

export type * from './types.ts'
export {
  ARXIV_ENDPOINT,
  arxivSearchQuery,
  arxivUrl,
  captured,
  decodeEntities,
  elementText,
  elementTexts,
  mapArxiv,
  pdfLink,
} from './adapters/arxiv.ts'
export {
  CROSSREF_ENDPOINT,
  CROSSREF_SELECT,
  CROSSREF_TYPE,
  crossrefAuthorName,
  crossrefPdfUrl,
  crossrefUrl,
  crossrefYear,
  mapCrossref,
} from './adapters/crossref.ts'
export {
  OPENALEX_ENDPOINT,
  OPENALEX_SELECT,
  mapOpenAlex,
  openAlexUrl,
  rebuildAbstract,
} from './adapters/openalex.ts'
export {
  SEMANTIC_SCHOLAR_ENDPOINT,
  SEMANTIC_SCHOLAR_FIELDS,
  mapSemanticScholar,
  semanticScholarUrl,
} from './adapters/semanticscholar.ts'
export {
  Config,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_MAX_PER_SOURCE,
  DEFAULT_S2_API_KEY_ENV,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  LITERATURE_SOURCES,
  MAX_QUERY_LENGTH,
  MAX_SEARCH_LIMIT,
} from './config.ts'
export { literatureSearchedData, recordLiteratureSearch } from './events.ts'
export {
  expiredHistoryIds,
  formatSourceErrors,
  historyId,
  historyRow,
  sortHistory,
} from './history.ts'
export {
  LITERATURE_HOSTS,
  LiteratureError,
  MAX_RESPONSE_BYTES,
  assertAllowedUrl,
  fetchJson,
  fetchText,
  isAbortError,
} from './http.ts'
export type { LiteratureFetchOptions } from './http.ts'
export {
  CITATION_WEIGHT,
  MAX_ABSTRACT_CHARS,
  MAX_AUTHORS,
  SOURCE_PRIORITY,
  cleanTitle,
  clampAbstract,
  clampAuthors,
  dedupeKey,
  dedupeKeys,
  identify,
  mergeRecordPair,
  mergeRecords,
  normalizeArxivId,
  normalizeDoi,
  normalizeTitle,
  optionalFields,
  rankRecords,
} from './merge.ts'
export type { LiteratureCandidate, OptionalRecordDraft, OptionalRecordFields } from './merge.ts'
export {
  LITERATURE_NAMESPACE,
  LiteratureRuntime,
  SERVICE_KEY,
  sourceErrorOf,
  validateRequest,
} from './runtime.ts'
export type { ValidatedSearchRequest } from './runtime.ts'
export { HISTORY_TABLE, literatureHistoryEntrySchema, sciLiteratureDomainSpec } from './spec.ts'
export {
  LITERATURE_PROMPT_ORDER,
  LITERATURE_PROMPT_TEXT,
  LITERATURE_TOOL,
  RENDERED_AUTHORS,
  applyLiteratureTool,
  formatLiteratureOutput,
  formatLiteratureRecord,
  literatureMetaFromValue,
  literatureToolValue,
} from './tool.ts'
export type { LiteratureSearcher, LiteratureToolArgs, LiteratureToolValue } from './tool.ts'
export { asArray, asCount, asRecord, asString, asYear, buildUrl, yearRange } from './wire.ts'

export { LiteratureRuntime as default } from './runtime.ts'
