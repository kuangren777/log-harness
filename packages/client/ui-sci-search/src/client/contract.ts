/**
 * The search view's data vocabulary.
 *
 * Every member here is JSON-compatible: the components see plain records and
 * callbacks, never an RPC envelope, so the whole wire seam is the `apply`
 * body that builds {@link SciSearchInjected}.
 *
 * The record types below MIRROR `packages/sci/sci-literature/src/types.ts`
 * (spec 16-Workbench/04-spec-search.md §2.1) verbatim. They live here only
 * until that host package lands in the tree; the assembly step then replaces
 * this block with `import type { … } from '@deepseek-ai/dsh-sci-literature/types'`
 * and switches {@link literatureRemoteOf} to the generated
 * `ctx.remote['sci.literature']` namespace, whose declaration this package
 * cannot pull before the generator has run.
 */

/** One of the four bibliographic sources the host fans out to. */
export type LiteratureSource = 'openalex' | 'semanticscholar' | 'arxiv' | 'crossref'

/** One merged bibliographic record. */
export interface LiteratureRecord {
  /** Stable id: `doi:<lowercase doi>` | `arxiv:<id>` | `title:<sha1(normalized title)>`. */
  id: string
  /** Work title as the winning source gives it. */
  title: string
  /** "Family, Given" as the source gives; at most 20. */
  authors: readonly string[]
  /** Publication year, when the sources report one. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Plain-text abstract, at most 2000 characters. */
  abstract?: string
  /** Lowercase DOI with no url prefix. */
  doi?: string
  /** arXiv identifier, e.g. 2607.09182. */
  arxivId?: string
  /** Canonical landing page. */
  url: string
  /** Open-access PDF only. */
  pdfUrl?: string
  /** Citation count reported by the winning source. */
  citedBy?: number
  /** The source whose record won the merge. */
  source: LiteratureSource
  /** Every source that returned this work. */
  sources: readonly LiteratureSource[]
}

/** One search request as the host takes it. */
export interface LiteratureSearchRequest {
  /** Free-text query. */
  query: string
  /** Earliest publication year to admit. */
  yearFrom?: number
  /** Latest publication year to admit. */
  yearTo?: number
  /** Result cap, 1..20, default 10. */
  limit?: number
}

/** One source's failure, reported instead of failing the whole search. */
export interface LiteratureSourceError {
  /** The source that failed. */
  source: LiteratureSource
  /** Host error code. */
  code: string
  /** Host-supplied detail. */
  message: string
}

/** One settled search. */
export interface LiteratureSearchResult {
  /** Merged, ranked, and truncated records. */
  records: readonly LiteratureRecord[]
  /** Merged count before the limit cut. */
  total: number
  /** Sources that failed; the remaining ones still answered. */
  sourceErrors: readonly LiteratureSourceError[]
  /** Wall-clock duration of the fan-out, in milliseconds. */
  elapsedMs: number
}

/** One remembered query from the host's search history. */
export interface RecentQuery {
  /** History row id — the handle `forget` takes, never the query text. */
  id: string
  /** The query as it was typed. */
  query: string
  /** Epoch milliseconds of the search. */
  at: number
  /** How many records that search returned. */
  hits: number
}

/**
 * A settled search as the view consumes it: a total vocabulary, so a source
 * outage, a rejected request, and an unreachable host all arrive as data
 * rather than as a throw inside an event handler.
 */
export type SearchOutcome =
  | { ok: true; result: LiteratureSearchResult }
  | { ok: false; code: string }

/**
 * The injected face the view drives; every member is built in `apply`.
 *
 * Declared as properties rather than methods because the view destructures
 * them out of its props: a method position would bind them to this face.
 */
export interface SciSearchInjected {
  /**
   * Run one literature search: takes the query and its optional bounds, and
   * answers with the result or the failure code, never a throw.
   */
  readonly search: (request: LiteratureSearchRequest) => Promise<SearchOutcome>
  /**
   * Read the host's recent-query history, newest first; an unreadable
   * history answers empty.
   */
  readonly recent: () => Promise<readonly RecentQuery[]>
  /**
   * Forget one remembered query by its history id, answering with the
   * history that remains.
   */
  readonly forget: (id: string) => Promise<readonly RecentQuery[]>
  /**
   * Take one query into the research flow: open a session, prefill its
   * composer with the given prompt, and show the conversation view.
   */
  readonly deepDive: (prompt: string) => void
}
