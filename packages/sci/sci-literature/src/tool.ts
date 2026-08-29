/**
 * The `literature_search` tool.
 *
 * The model's own web search returns pages; this returns works. The difference
 * that matters to a citation is that every record here carries the identifier a
 * reader can resolve — a DOI or an arXiv id — so the prompt section tells the
 * model to cite from the returned records and never from memory.
 *
 * The canonical value is the search result itself, so Code Mode reads
 * `records[i].doi` directly instead of parsing the numbered list that
 * {@link formatLiteratureOutput} renders for the Native path.
 * @module @deepseek-ai/dsh-sci-literature/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@deepseek-ai/dsh-tools'
import { LITERATURE_SOURCES, MAX_QUERY_LENGTH, MAX_SEARCH_LIMIT } from './config.ts'
import { recordLiteratureSearch } from './events.ts'
import type { LiteratureRecord, LiteratureSearchRequest, LiteratureSearchResult, LiteratureSource } from './types.ts'

/**
 * The one capability the tool needs from `ctx.sciLiterature`. Named here rather
 * than imported so the tool module stays independent of the service class.
 */
export interface LiteratureSearcher {
  /**
   * Search every configured index and merge the answers.
   * @param request - the search to run.
   * @param signal - cancellation of the whole fan-out.
   * @returns the merged, ranked, and truncated records with the failure report.
   */
  search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult>
}

/** Name of the model-facing literature search tool. */
export const LITERATURE_TOOL = 'literature_search'

/** Authors one rendered line names before it says `et al.`. */
export const RENDERED_AUTHORS = 3

/** Order of this tool's system-prompt section, right after `tool:web_search`. */
export const LITERATURE_PROMPT_ORDER = 111

/** The model-facing arguments of one `literature_search` call. */
export interface LiteratureToolArgs {
  /** The topic to search for. */
  query: string
  /** Inclusive lower bound on publication year. */
  year_from?: number
  /** Inclusive upper bound on publication year. */
  year_to?: number
  /** Records to return, 1..20. */
  limit?: number
}

/**
 * The system-prompt guidance registered beside the tool.
 *
 * It states the one division of labour a model cannot infer from the schema —
 * papers go through this tool, pages go through `web_search` — and the one
 * failure it would otherwise commit, which is inventing a plausible DOI for a
 * work the search did not return.
 */
export const LITERATURE_PROMPT_TEXT = '查学术文献用 literature_search，不要用 web_search：它同时检索 OpenAlex、Semantic Scholar、arXiv、Crossref，返回带 DOI 或 arXiv id 的结构化文献记录。引用时只写返回记录里的 DOI 或 arXiv id，不要凭印象补全或改写。返回为空时直接说没有检索到，不要编造文献。部分来源失败时结果仍然可用，在回答里说明少了哪个来源。'

/**
 * Render one record as its line of the numbered list.
 * @param record - the merged record.
 * @param position - the zero-based position in the returned list.
 * @returns the rendered line.
 */
export function formatLiteratureRecord(record: LiteratureRecord, position: number): string {
  const authors = record.authors.length > RENDERED_AUTHORS
    ? `${record.authors.slice(0, RENDERED_AUTHORS).join(', ')} et al.`
    : record.authors.join(', ')
  const parts = [
    ...authors === '' ? [] : [authors],
    ...record.venue === undefined ? [] : [record.venue],
    ...record.year === undefined ? [] : [String(record.year)],
    ...record.citedBy === undefined ? [] : [`被引 ${record.citedBy}`],
    ...record.doi === undefined ? [] : [`doi:${record.doi}`],
    ...record.arxivId === undefined ? [] : [`arXiv:${record.arxivId}`],
    ...record.pdfUrl === undefined ? [] : [`pdf ${record.pdfUrl}`],
  ]
  return `[${position + 1}] ${record.title}${parts.length === 0 ? '' : ` — ${parts.join(' · ')}`}`
}

/**
 * Render one completed search as the text the model reads.
 * @param value - the canonical search result.
 * @returns the numbered list, the source-failure note, and the citation reminder.
 */
export function formatLiteratureOutput(value: LiteratureToolValue): string {
  const lines = value.records.length === 0
    ? ['没有检索到文献。']
    : [
      `检索到 ${value.total} 条，返回前 ${value.records.length} 条：`,
      ...value.records.map((record, position) => formatLiteratureRecord(record, position)),
    ]
  if (value.sourceErrors.length > 0) {
    lines.push(`来源错误：${value.sourceErrors.map(error => `${error.source}（${error.code}）`).join('、')}`)
  }
  lines.push('引用时写 DOI 或 arXiv id。')
  return lines.join('\n')
}

/** The canonical `literature_search` output value: {@link LiteratureSearchResult} with mutable arrays. */
export interface LiteratureToolValue {
  /** The merged records, ranked and truncated to the request's limit. */
  records: (Omit<LiteratureRecord, 'authors' | 'sources'> & { authors: string[]; sources: LiteratureSource[] })[]
  /** Merged record count before the limit truncated the list. */
  total: number
  /** One entry per source that failed; empty when every source answered. */
  sourceErrors: { source: LiteratureSource; code: string; message: string }[]
  /** Wall-clock duration of the fan-out, in milliseconds. */
  elapsedMs: number
}

/**
 * Project one search result into the canonical tool output value.
 *
 * The service returns readonly arrays because nothing downstream may edit a
 * merged record; the tool registry owns the value it validates and freezes, so
 * the projection hands it its own arrays.
 * @param result - the completed search result.
 * @returns the canonical value.
 */
export function literatureToolValue(result: LiteratureSearchResult): LiteratureToolValue {
  return {
    records: result.records.map(record => ({ ...record, authors: [...record.authors], sources: [...record.sources] })),
    total: result.total,
    sourceErrors: result.sourceErrors.map(error => ({ ...error })),
    elapsedMs: result.elapsedMs,
  }
}

/**
 * Project one search result into the replayable card data.
 * @param value - the canonical search result.
 * @returns the `literature` metadata the browser's tool card renders from.
 */
export function literatureMetaFromValue(value: LiteratureToolValue): JsonValue {
  return { kind: 'literature', records: value.records }
}

/** The record fields the canonical output value declares, mirroring `LiteratureRecord`. */
const RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    authors: { type: 'array', required: true, items: { type: 'string' } },
    year: { type: 'number' },
    venue: { type: 'string' },
    abstract: { type: 'string' },
    doi: { type: 'string' },
    arxivId: { type: 'string' },
    url: { type: 'string', required: true },
    pdfUrl: { type: 'string' },
    citedBy: { type: 'number' },
    source: { type: 'string', required: true, enum: LITERATURE_SOURCES },
    sources: { type: 'array', required: true, items: { type: 'string', enum: LITERATURE_SOURCES } },
  },
} as const

/**
 * Register `literature_search` and its prompt section on the mounting context.
 * @param ctx - the plugin context carrying the tool registry and the system prompt.
 * @param literature - the literature runtime every call is served by.
 */
export function applyLiteratureTool(ctx: Context, literature: LiteratureSearcher): void {
  ctx.systemPrompt.section({
    name: `tool:${LITERATURE_TOOL}`,
    order: LITERATURE_PROMPT_ORDER,
    text: LITERATURE_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: LITERATURE_TOOL,
    description: 'Search the academic literature across OpenAlex, Semantic Scholar, arXiv, and Crossref in one call. '
      + 'Returns merged, de-duplicated works with authors, venue, year, citation count, abstract, and a resolvable DOI or arXiv id. '
      + 'Use this instead of web_search whenever the answer is a paper.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: `Topic to search for, at most ${MAX_QUERY_LENGTH} characters. Every source receives this text unchanged.`,
      },
      year_from: { type: 'number', description: 'Inclusive earliest publication year.' },
      year_to: { type: 'number', description: 'Inclusive latest publication year.' },
      limit: { type: 'number', description: `Records to return; an integer in 1..${MAX_SEARCH_LIMIT}, default 10.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          records: { type: 'array', required: true, items: RECORD_SCHEMA },
          total: { type: 'number', required: true },
          sourceErrors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true, enum: LITERATURE_SOURCES },
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
          elapsedMs: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatLiteratureOutput(value) }],
      presentationMeta: (_args, value) => literatureMetaFromValue(value),
    },
    // Four public indexes are read; nothing in the parent agent is touched.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await literature.search({
        query: args.query,
        ...args.year_from === undefined ? {} : { yearFrom: args.year_from },
        ...args.year_to === undefined ? {} : { yearTo: args.year_to },
        ...args.limit === undefined ? {} : { limit: args.limit },
      }, exec.signal)
      // Only the tool path has a session to record in; a search the browser
      // view ran is recorded by the history table instead.
      if (exec.agent !== undefined) recordLiteratureSearch(exec.agent.session, args.query, result)
      return literatureToolValue(result)
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `检索文献：${args.query}`,
      kind: 'search',
      rawInput: args.query,
    }),
    presentResult: () => ({ card: 'generic' }),
  }))
}
