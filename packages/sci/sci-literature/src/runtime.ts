/**
 * `ctx.sciLiterature` — the fan-out across four bibliographic indexes, the
 * merge that turns four answers into one record list, and the "recent queries"
 * history the browser view reads back.
 *
 * One slow or rate-limited index never costs the search: every source runs on
 * its own timeout, `Promise.allSettled` isolates the failures, and each one is
 * reported in `sourceErrors` while the rest of the records are returned. Only a
 * fan-out in which no source answered is a failure.
 * @module @deepseek-ai/dsh-sci-literature/src/runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import * as arxiv from './adapters/arxiv.ts'
import * as crossref from './adapters/crossref.ts'
import * as openalex from './adapters/openalex.ts'
import * as semanticscholar from './adapters/semanticscholar.ts'
import { Config, MAX_QUERY_LENGTH, MAX_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT } from './config.ts'
import { expiredHistoryIds, formatSourceErrors, historyId, historyRow, sortHistory } from './history.ts'
import { isAbortError, LiteratureError } from './http.ts'
import { mergeRecords, rankRecords } from './merge.ts'
import { HISTORY_TABLE, sciLiteratureDomainSpec } from './spec.ts'
import { applyLiteratureTool } from './tool.ts'
import type {
  LiteratureAdapterOptions,
  LiteratureForgetRequest,
  LiteratureForgetResult,
  LiteratureHistoryEntry,
  LiteratureRecentResult,
  LiteratureRecord,
  LiteratureSearchRequest,
  LiteratureSearchResult,
  LiteratureSource,
  LiteratureSourceError,
} from './types.ts'

/** Cordis service key and Remote namespace of this package. */
export const SERVICE_KEY = 'sciLiterature'

/** Wire namespace the three literature endpoints are exported under. */
export const LITERATURE_NAMESPACE = 'sci.literature'

/** One source's adapter: the function the fan-out calls. */
type SourceSearch = (
  request: LiteratureSearchRequest,
  options: LiteratureAdapterOptions,
  signal: AbortSignal,
) => Promise<readonly LiteratureRecord[]>

/**
 * One source's failure, carrying which source produced it through
 * `Promise.allSettled`. A rejected settlement holds only its reason, and
 * pairing rejections back to sources by array position would put a defensive
 * lookup on the one path that must not lose the source's name.
 */
class SourceRejection extends Error {
  /** The source whose adapter rejected. */
  readonly source: LiteratureSource

  /**
   * @param source - the source whose adapter rejected.
   * @param cause - the thrown value.
   */
  constructor(source: LiteratureSource, cause: unknown) {
    super(`sci-literature: ${source} did not answer`, { cause })
    this.name = 'SourceRejection'
    this.source = source
  }
}

/** The adapter behind each source name. */
const ADAPTERS: Readonly<Record<LiteratureSource, SourceSearch>> = {
  openalex: openalex.search,
  semanticscholar: semanticscholar.search,
  arxiv: arxiv.search,
  crossref: crossref.search,
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciLiterature: LiteratureRuntime
  }
}

/** One search request that passed {@link validateRequest}: trimmed query, resolved limit. */
export interface ValidatedSearchRequest extends LiteratureSearchRequest {
  /** The query with surrounding whitespace removed; never empty. */
  readonly query: string
  /** The resolved record count, in 1..{@link MAX_SEARCH_LIMIT}. */
  readonly limit: number
}

/**
 * Check one search request before any index is contacted.
 * @param request - the request as a tool call or the browser view sent it.
 * @returns the request with its limit resolved.
 * @throws LiteratureError `LITERATURE_INVALID_REQUEST` for a blank or overlong query, an inverted year range, or a limit outside 1..20.
 */
export function validateRequest(request: LiteratureSearchRequest): ValidatedSearchRequest {
  const query = request.query.trim()
  if (query === '') throw new LiteratureError('literature search needs a query', 'LITERATURE_INVALID_REQUEST')
  if (query.length > MAX_QUERY_LENGTH) {
    throw new LiteratureError(
      `literature query is ${query.length} characters; at most ${MAX_QUERY_LENGTH} are accepted`,
      'LITERATURE_INVALID_REQUEST',
    )
  }
  const limit = request.limit ?? DEFAULT_SEARCH_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new LiteratureError(
      `literature limit must be an integer in 1..${MAX_SEARCH_LIMIT}, got ${limit}`,
      'LITERATURE_INVALID_REQUEST',
    )
  }
  if (request.yearFrom !== undefined && request.yearTo !== undefined && request.yearFrom > request.yearTo) {
    throw new LiteratureError(
      `literature year range ${request.yearFrom}-${request.yearTo} ends before it starts`,
      'LITERATURE_INVALID_REQUEST',
    )
  }
  return { ...request, query, limit }
}

/**
 * Describe one rejected source without leaking the transport detail.
 * @param source - the source that failed.
 * @param error - the thrown value.
 * @returns the reported failure.
 */
export function sourceErrorOf(source: LiteratureSource, error: unknown): LiteratureSourceError {
  if (error instanceof LiteratureError) return { source, code: error.code, message: error.message }
  if (isAbortError(error)) return { source, code: 'LITERATURE_ABORTED', message: `${source}: search was cancelled` }
  return { source, code: 'LITERATURE_SOURCE_HTTP', message: `${source}: request failed` }
}

/**
 * Literature search across four public indexes, and the query history of the
 * browser view that drives it. The service performs reads only: it never
 * creates, resumes, or drives an Agent or Session.
 */
export class LiteratureRuntime extends TypertRemoteService {
  static inject = ['storageDomain', 'systemPrompt', 'tools']

  /** Loader validation for the literature layer's deployment policy. */
  static Config: z<Config> = Config

  private readonly config: Config
  /** Assigned by `Service.init` before Cordis publishes the service. */
  private table!: KvTable<string, LiteratureHistoryEntry>

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - the resolved deployment configuration.
   * @throws TypeError when the composition configured no sources to search.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // LITERATURE_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciLiterature', { namespace: 'sci.literature' })
    if (config.sources.length === 0) {
      throw new TypeError('sci-literature: sources must name at least one index to search')
    }
    this.config = config
  }

  /**
   * Open the history table, then register the tool that serves from it.
   *
   * The tool is registered here rather than by a second Loader row so that one
   * composition entry mounts the whole layer, and it is registered AFTER the
   * table opens so a call cannot reach a service whose history has no medium.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sciLiteratureDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sci-literature.domainClose')
    this.table = domain.table(HISTORY_TABLE)
    applyLiteratureTool(this.ctx, this)
  }

  /**
   * Search every configured index and merge the answers into one ranked list.
   *
   * Failures of individual sources are reported, not thrown: the caller gets
   * the records the other indexes returned plus a `sourceErrors` entry naming
   * each one that did not answer.
   * @param request - the search as a tool call or the browser view states it.
   * @param signal - optional caller cancellation, merged with each source's own timeout.
   * @returns the merged, ranked, and truncated records with the failure report.
   * @throws LiteratureError `LITERATURE_INVALID_REQUEST` for a request
   *   {@link validateRequest} refuses, or `LITERATURE_ALL_SOURCES_FAILED` when
   *   no index answered.
   */
  async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult> {
    const checked = validateRequest(request)
    const options = await this.adapterOptions()
    const started = Date.now()
    const sources = this.config.sources
    const settled = await Promise.allSettled(sources.map((source) => {
      const timeout = AbortSignal.timeout(this.config.timeoutMs)
      const merged = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      return ADAPTERS[source](checked, options, merged)
        .catch((error: unknown) => { throw new SourceRejection(source, error) })
    }))

    const lists: (readonly LiteratureRecord[])[] = []
    const sourceErrors: LiteratureSourceError[] = []
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') lists.push(outcome.value)
      else {
        const rejection = outcome.reason as SourceRejection
        sourceErrors.push(sourceErrorOf(rejection.source, rejection.cause))
      }
    }
    if (lists.length === 0) {
      throw new LiteratureError(
        `literature search reached no index: ${sourceErrors.map(error => error.message).join('; ')}`,
        'LITERATURE_ALL_SOURCES_FAILED',
      )
    }

    const ranked = rankRecords(mergeRecords(lists))
    const result: LiteratureSearchResult = {
      records: ranked.slice(0, checked.limit),
      total: ranked.length,
      sourceErrors,
      elapsedMs: Date.now() - started,
    }
    await this.remember(checked.query, result)
    return result
  }

  /**
   * Search from the browser view, which has no cancellation of its own.
   * @param request - the search the view states.
   * @returns the merged, ranked, and truncated records with the failure report.
   */
  @Remote('search')
  remoteSearch(request: LiteratureSearchRequest): Promise<LiteratureSearchResult> {
    return this.search(request)
  }

  /**
   * The queries this profile searched, newest first.
   * @returns the retained history rows.
   */
  @Remote('recent')
  recent(): Promise<LiteratureRecentResult> {
    return Promise.resolve({ entries: sortHistory([...this.table.entries()].map(([, entry]) => entry)) })
  }

  /**
   * Drop one query from the history.
   * @param request - the row to drop; an id the table does not hold is not an error.
   * @returns `{ ok: true }` once the row is absent.
   */
  @Remote('forget')
  async forget(request: LiteratureForgetRequest): Promise<LiteratureForgetResult> {
    await this.table.delete(request.id)
    return { ok: true }
  }

  /**
   * Resolve the per-call adapter options, including the optional Semantic
   * Scholar key. The key is optional by design: the graph API answers keyless
   * at a lower rate limit, so an absent key lowers throughput rather than
   * removing the source.
   * @returns the options every adapter receives for this search.
   */
  private async adapterOptions(): Promise<LiteratureAdapterOptions> {
    const apiKey = await this.resolveApiKey()
    return {
      mailto: this.config.mailto,
      userAgent: this.config.userAgent,
      maxPerSource: this.config.maxPerSource,
      ...apiKey === undefined ? {} : { apiKey },
    }
  }

  /**
   * Read the Semantic Scholar key from the credential plane, then from the
   * launch environment.
   * @returns the key, or `undefined` when this deployment has none.
   */
  private async resolveApiKey(): Promise<string | undefined> {
    if (!isCredentialRefName(this.config.s2ApiKeyEnv)) return undefined
    const ref = credentialRef(this.config.s2ApiKeyEnv)
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(ref)
      return resolved === undefined || resolved.value === '' ? undefined : resolved.value
    }
    // Without the seam the environment is the whole credential plane.
    const ambient = launchEnvironmentOf(this.ctx).get(ref)
    return ambient === undefined || ambient.value === '' ? undefined : ambient.value
  }

  /**
   * Record one completed search in the history and trim the table to the limit.
   * @param query - the query text as the caller sent it.
   * @param result - the completed search result.
   */
  private async remember(query: string, result: LiteratureSearchResult): Promise<void> {
    const errors = formatSourceErrors(result.sourceErrors)
    const id = historyId(query)
    await this.table.put(id, historyRow({
      id,
      query,
      at: Date.now(),
      hits: result.total,
      ...errors === undefined ? {} : { sourceErrors: errors },
    }))
    for (const expired of expiredHistoryIds([...this.table.entries()].map(([, entry]) => entry), this.config.historyLimit)) {
      await this.table.delete(expired)
    }
  }
}
