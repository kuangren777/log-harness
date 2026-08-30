/**
 * The two model-facing tools: `library_search` reads the user's knowledge base,
 * `library_add` puts something in it.
 *
 * The division of labour these tools state is the one a model cannot infer from
 * their schemas. `literature_search` reaches four public indexes and knows
 * nothing about this user; `library_search` reads what this user already chose
 * to keep, including their own tags, statuses, and notes — so a question about
 * "the papers I collected on X" is answered here and nowhere else.
 * @module @deepseek-ai/dsh-sci-library/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@deepseek-ai/dsh-tools'
import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature/types'
import { MAX_PAGE_LIMIT } from './config.ts'
import { LIBRARY_KINDS, LIBRARY_SOURCES, LIBRARY_STATUSES } from './entries.ts'
import { recordLibraryChange } from './events.ts'
import type {
  LibraryAddRequest,
  LibraryAddResult,
  LibraryEntry,
  LibraryKind,
  LibraryPage,
  LibraryQuery,
  LibrarySource,
  LibraryStatus,
} from './types.ts'

/** Name of the model-facing knowledge-base search tool. */
export const LIBRARY_SEARCH_TOOL = 'library_search'

/** Name of the model-facing knowledge-base ingestion tool. */
export const LIBRARY_ADD_TOOL = 'library_add'

/** Name of the system-prompt section both tools share. */
export const LIBRARY_PROMPT_SECTION = 'tool:library'

/** Order of the shared prompt section, right after `tool:literature_search`. */
export const LIBRARY_PROMPT_ORDER = 112

/** Authors one rendered line names before it says `et al.`. */
export const RENDERED_AUTHORS = 3

/** Tags one rendered line names before it stops. */
export const RENDERED_TAGS = 3

/** The capabilities the two tools need from `ctx.sciLibrary`. */
export interface LibraryTooling {
  /**
   * List or search the knowledge base.
   * @param query - the listing's filters and free text.
   * @returns the matching page.
   */
  list: (query: LibraryQuery) => Promise<LibraryPage>
  /**
   * Put one entry in the knowledge base, merging into an existing id.
   * @param request - the record or draft to store.
   * @returns the stored entry and whether it was new.
   */
  add: (request: LibraryAddRequest) => Promise<LibraryAddResult>
  /**
   * Resolve one identifier to a bibliographic record through the literature layer.
   * @param identifier - a DOI or an arXiv id.
   * @param signal - cancellation of the lookup.
   * @returns the matching record, or undefined when the layer is absent or found nothing.
   */
  lookup: (identifier: string, signal?: AbortSignal) => Promise<LiteratureRecord | undefined>
}

/** The model-facing arguments of one `library_search` call. */
export interface LibrarySearchToolArgs {
  /** Free text scored over title, tags, abstract, and authors. */
  query?: string
  /** Keep only entries of this kind. */
  kind?: LibraryKind
  /** Keep only entries in this state. */
  status?: LibraryStatus
  /** Keep only entries carrying this tag. */
  tag?: string
  /** Entries to return, 1..100. */
  limit?: number
}

/** The model-facing arguments of one `library_add` call. */
export interface LibraryAddToolArgs {
  /** DOI of the work to store; resolved through the literature layer when present. */
  doi?: string
  /** arXiv id of the work to store; resolved through the literature layer when present. */
  arxiv_id?: string
  /** Title to store when no identifier resolves. */
  title?: string
  /** Landing page of the work. */
  url?: string
  /** Tags to attach. */
  tags?: string[]
  /** Download the open-access PDF into the entry's directory. */
  with_pdf?: boolean
}

/** One entry as the tool's canonical output value carries it: {@link LibraryEntry} with mutable arrays. */
export interface LibraryToolEntry {
  /** Stable entry id. */
  id: string
  /** What this entry is. */
  kind: LibraryKind
  /** Work title. */
  title: string
  /** Author names. */
  authors: string[]
  /** Publication year. */
  year?: number
  /** Journal, conference, or repository. */
  venue?: string
  /** Plain-text abstract. */
  abstract?: string
  /** Lowercase DOI. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Open-access PDF link. */
  pdfUrl?: string
  /** Citation count. */
  citedBy?: number
  /** Every source that contributed metadata. */
  sources: LibrarySource[]
  /** The user's tags. */
  tags: string[]
  /** How far the user has got with the entry. */
  status: LibraryStatus
  /** The user's own note. */
  note?: string
  /** Sandbox paths of the entry's files, relative to the library root. */
  files: string[]
  /** Epoch milliseconds when the entry was added. */
  addedAt: number
  /** Epoch milliseconds of the last change. */
  updatedAt: number
}

/** The canonical `library_search` output value. */
export interface LibrarySearchToolValue {
  /** The returned entries, best first. */
  entries: LibraryToolEntry[]
  /** Entries the filters matched before the limit truncated the list. */
  total: number
  /** Whole-library counts by kind. */
  counts: { all: number; paper: number; dataset: number; note: number; lowConfidence: number }
}

/** The canonical `library_add` output value. */
export interface LibraryAddToolValue {
  /** The stored entry. */
  entry: LibraryToolEntry
  /** False when the id was already in the library and this call merged into it. */
  created: boolean
  /** Failure class of the optional PDF download; absent when none was asked for or it succeeded. */
  fetchError?: string
}

/**
 * Project one stored entry into the canonical tool value.
 *
 * The runtime returns readonly arrays because nothing downstream may edit a
 * stored row; the tool registry owns the value it validates and freezes, so the
 * projection hands it its own arrays. Files become their paths: the model opens
 * them with `read`, and the size and digest beside each one are the browser
 * view's business.
 * @param entry - the stored entry.
 * @param libraryRoot - the configured library root, prefixed onto every file path.
 * @returns the canonical value.
 */
export function libraryToolEntry(entry: LibraryEntry, libraryRoot: string): LibraryToolEntry {
  const root = libraryRoot.replace(/\/+$/, '')
  const optional: Partial<LibraryToolEntry> = {}
  if (entry.year !== undefined) optional.year = entry.year
  if (entry.venue !== undefined) optional.venue = entry.venue
  if (entry.abstract !== undefined) optional.abstract = entry.abstract
  if (entry.doi !== undefined) optional.doi = entry.doi
  if (entry.arxivId !== undefined) optional.arxivId = entry.arxivId
  if (entry.url !== undefined) optional.url = entry.url
  if (entry.pdfUrl !== undefined) optional.pdfUrl = entry.pdfUrl
  if (entry.citedBy !== undefined) optional.citedBy = entry.citedBy
  if (entry.note !== undefined) optional.note = entry.note
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    authors: [...entry.authors],
    sources: [...entry.sources],
    tags: [...entry.tags],
    status: entry.status,
    files: entry.files.map(file => `${root}/${file.path}`),
    addedAt: entry.addedAt,
    updatedAt: entry.updatedAt,
    ...optional,
  }
}

/**
 * Render one entry as its line of the numbered list.
 * @param entry - the canonical entry.
 * @param position - the zero-based position in the returned list.
 * @returns the rendered line.
 */
export function formatLibraryEntry(entry: LibraryToolEntry, position: number): string {
  const authors = entry.authors.length > RENDERED_AUTHORS
    ? `${entry.authors.slice(0, RENDERED_AUTHORS).join(', ')} et al.`
    : entry.authors.join(', ')
  const parts = [
    ...authors === '' ? [] : [authors],
    ...entry.year === undefined ? [] : [String(entry.year)],
    entry.status,
    ...entry.tags.length === 0 ? [] : [`标签 ${entry.tags.slice(0, RENDERED_TAGS).join('/')}`],
    ...entry.doi === undefined ? [] : [`doi:${entry.doi}`],
    ...entry.arxivId === undefined ? [] : [`arXiv:${entry.arxivId}`],
    ...entry.files.length === 0 ? [] : [`${entry.files.length} 个文件`],
  ]
  return `[${position + 1}] ${entry.title} — ${parts.join(' · ')}`
}

/**
 * Render one completed listing as the text the model reads.
 * @param value - the canonical search value.
 * @returns the numbered list, the whole-library counts, and the file-opening reminder.
 */
export function formatLibrarySearchOutput(value: LibrarySearchToolValue): string {
  if (value.entries.length === 0) {
    return `知识库里没有匹配的条目（共 ${value.counts.all} 条）。`
  }
  const lines = [
    `匹配 ${value.total} 条，返回前 ${value.entries.length} 条（知识库共 ${value.counts.all} 条：${value.counts.paper} 篇文献、${value.counts.dataset} 个数据集、${value.counts.note} 条笔记）：`,
    ...value.entries.map((entry, position) => formatLibraryEntry(entry, position)),
  ]
  const files = value.entries.flatMap(entry => entry.files)
  if (files.length > 0) lines.push(`条目文件在沙箱里，直接用 read 或 pdf 技能打开，例如 ${files[0] as string}。`)
  return lines.join('\n')
}

/**
 * Render one completed add as the text the model reads.
 * @param value - the canonical add value.
 * @returns the confirmation line, plus the download failure when there was one.
 */
export function formatLibraryAddOutput(value: LibraryAddToolValue): string {
  const lines = [
    value.created
      ? `已加入知识库：${value.entry.title}（id ${value.entry.id}）`
      : `已在知识库中，已合并标签与文件：${value.entry.title}（id ${value.entry.id}）`,
  ]
  if (value.entry.files.length > 0) lines.push(`文件：${value.entry.files.join('、')}`)
  if (value.fetchError !== undefined) lines.push(`PDF 未能下载（${value.fetchError}），条目本身已保存。`)
  return lines.join('\n')
}

/**
 * Project one listing into the replayable card data.
 * @param value - the canonical search value.
 * @returns the `library` metadata the browser's tool card renders from.
 */
export function librarySearchMetaFromValue(value: LibrarySearchToolValue): JsonValue {
  return { kind: 'library', entries: value.entries } as unknown as JsonValue
}

/**
 * Project one add into the replayable card data.
 * @param value - the canonical add value.
 * @returns the `library` metadata the browser's tool card renders from.
 */
export function libraryAddMetaFromValue(value: LibraryAddToolValue): JsonValue {
  return { kind: 'library', entries: [value.entry], created: value.created } as unknown as JsonValue
}

/**
 * The system-prompt guidance registered beside both tools.
 *
 * It states the one division of labour a model cannot infer from the two
 * schemas — the user's own collection is searched before the public indexes —
 * and where the files actually are, because a PDF the library holds is opened
 * with `read`, not re-downloaded.
 * @param libraryRoot - the configured library root, named so the model can open a file.
 * @returns the section text.
 */
export function libraryPromptText(libraryRoot: string): string {
  const root = libraryRoot.replace(/\/+$/, '')
  return `用户的知识库用 ${LIBRARY_SEARCH_TOOL} 查：里面是用户自己收藏的文献、数据集和笔记，还带着他们自己写的标签、状态和笔记。问题涉及「我收藏的」「我之前存的」资料时先查知识库，再决定要不要用 literature_search 检索公开索引。把值得长期留存的文献用 ${LIBRARY_ADD_TOOL} 存进去：给了 doi 或 arxiv_id 会自动补全元数据，只有标题时按手工条目保存。引用知识库条目时写它自己的 DOI 或 arXiv id，不要凭印象补全。条目的文件就在沙箱里 ${root}/<条目目录>/ 下，${LIBRARY_SEARCH_TOOL} 的结果里给的是完整路径，读 PDF 或数据文件直接用 read 或 pdf 技能打开那个路径，不要重新下载。`
}

/** The entry fields the canonical output value declares, mirroring `LibraryEntry`. */
const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: LIBRARY_KINDS },
    title: { type: 'string', required: true },
    authors: { type: 'array', required: true, items: { type: 'string' } },
    year: { type: 'number' },
    venue: { type: 'string' },
    abstract: { type: 'string' },
    doi: { type: 'string' },
    arxivId: { type: 'string' },
    url: { type: 'string' },
    pdfUrl: { type: 'string' },
    citedBy: { type: 'number' },
    sources: { type: 'array', required: true, items: { type: 'string', enum: LIBRARY_SOURCES } },
    tags: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: LIBRARY_STATUSES },
    note: { type: 'string' },
    files: { type: 'array', required: true, items: { type: 'string' } },
    addedAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
  },
} as const

const COUNTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    all: { type: 'number', required: true },
    paper: { type: 'number', required: true },
    dataset: { type: 'number', required: true },
    note: { type: 'number', required: true },
    lowConfidence: { type: 'number', required: true },
  },
} as const

/**
 * Register `library_search`, `library_add`, and their shared prompt section.
 * @param ctx - the plugin context carrying the tool registry and the system prompt.
 * @param library - the knowledge base every call is served by.
 * @param libraryRoot - the configured library root, named in the prompt and in file paths.
 */
export function applyLibraryTools(ctx: Context, library: LibraryTooling, libraryRoot: string): void {
  ctx.systemPrompt.section({
    name: LIBRARY_PROMPT_SECTION,
    order: LIBRARY_PROMPT_ORDER,
    text: libraryPromptText(libraryRoot),
  })

  ctx.tools.register(defineTool({
    name: LIBRARY_SEARCH_TOOL,
    description: "Search the user's own knowledge base of saved papers, datasets, and notes, with the tags, statuses, and notes they attached. "
      + 'Matching is lexical over title, tags, abstract, and authors. '
      + 'Use this before literature_search whenever the question is about material the user already collected.',
    parameters: {
      query: { type: 'string', description: 'Free text scored over title, tags, abstract, and authors. Omit to list the whole library.' },
      kind: { type: 'string', enum: LIBRARY_KINDS, description: 'Keep only entries of this kind.' },
      status: { type: 'string', enum: LIBRARY_STATUSES, description: 'Keep only entries in this reading state.' },
      tag: { type: 'string', description: 'Keep only entries carrying this tag.' },
      limit: { type: 'number', description: `Entries to return; an integer in 1..${MAX_PAGE_LIMIT}, default 50.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'array', required: true, items: ENTRY_SCHEMA },
          total: { type: 'number', required: true },
          counts: { ...COUNTS_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatLibrarySearchOutput(value) }],
      presentationMeta: (_args, value) => librarySearchMetaFromValue(value),
    },
    // One stored table is read; nothing in the parent agent is touched.
    isConcurrencySafe: () => true,
    async execute(args) {
      const page = await library.list({
        ...args.query === undefined ? {} : { query: args.query },
        ...args.kind === undefined ? {} : { kind: args.kind },
        ...args.status === undefined ? {} : { status: args.status },
        ...args.tag === undefined ? {} : { tag: args.tag },
        ...args.limit === undefined ? {} : { limit: args.limit },
      })
      return {
        entries: page.entries.map(entry => libraryToolEntry(entry, libraryRoot)),
        total: page.total,
        counts: { ...page.counts },
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: args.query === undefined ? '列出知识库' : `检索知识库：${args.query}`,
      kind: 'search',
      rawInput: args.query ?? '',
    }),
    presentResult: () => ({ card: 'generic' }),
  }))

  ctx.tools.register(defineTool({
    name: LIBRARY_ADD_TOOL,
    description: "Save one work into the user's knowledge base. "
      + 'Given a doi or arxiv_id the bibliographic metadata is resolved through the literature layer; otherwise a manual entry is created from the title. '
      + 'Adding an id the library already holds merges the tags rather than duplicating the entry.',
    parameters: {
      doi: { type: 'string', description: 'DOI of the work, with or without the https://doi.org/ prefix.' },
      arxiv_id: { type: 'string', description: 'arXiv identifier without a version suffix, for example 2607.09182.' },
      title: { type: 'string', description: 'Title to store when no identifier is given or none resolves. Required in that case.' },
      url: { type: 'string', description: 'Landing page of the work.' },
      tags: { type: 'array', items: { type: 'string' }, description: "Tags to attach; merged with an existing entry's tags." },
      with_pdf: { type: 'boolean', description: "Download the work's open-access PDF into its library directory when one is known." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entry: { ...ENTRY_SCHEMA, required: true },
          created: { type: 'boolean', required: true },
          fetchError: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatLibraryAddOutput(value) }],
      presentationMeta: (_args, value) => libraryAddMetaFromValue(value),
    },
    // The shared knowledge-base table is written; two concurrent adds of the
    // same work would each read a table the other is about to change.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const result = await addFromArgs(library, args, exec.signal)
      // Only the tool path has a session to record in; a change the browser
      // view made is recorded by the row itself.
      if (exec.agent !== undefined) recordLibraryChange(exec.agent.session, 'add', result.entry)
      return {
        entry: libraryToolEntry(result.entry, libraryRoot),
        created: result.created,
        ...result.fetchError === undefined ? {} : { fetchError: result.fetchError },
      }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `加入知识库：${args.title ?? args.doi ?? args.arxiv_id ?? ''}`,
      kind: 'other',
      rawInput: args.title ?? args.doi ?? args.arxiv_id ?? '',
    }),
    presentResult: () => ({ card: 'generic' }),
  }))
}

/**
 * Turn one `library_add` call into the runtime request it stands for.
 *
 * An identifier is resolved first, because the record a bibliographic index
 * returns carries the authors, venue, year, and open-access link a model would
 * otherwise have to supply from memory — which is exactly the failure the
 * literature layer exists to prevent.
 * @param library - the knowledge base and its literature lookup.
 * @param args - the model arguments.
 * @param signal - cancellation of the lookup.
 * @returns the completed add.
 * @throws TypeError when nothing resolved and the call named no title.
 */
export async function addFromArgs(
  library: LibraryTooling,
  args: LibraryAddToolArgs,
  signal?: AbortSignal,
): Promise<LibraryAddResult> {
  const identifier = normalizeDoi(args.doi) ?? args.arxiv_id?.trim()
  const record = identifier === undefined || identifier === '' ? undefined : await library.lookup(identifier, signal)
  const tags = args.tags ?? []
  const withPdf = args.with_pdf === true
  if (record !== undefined) {
    return library.add({ record, tags, withPdf })
  }
  const title = args.title?.trim()
  if (title === undefined || title === '') {
    throw new TypeError('library_add needs a title when no doi or arxiv_id resolves to a known work')
  }
  const doi = normalizeDoi(args.doi)
  const arxivId = args.arxiv_id?.trim()
  return library.add({
    entry: {
      title,
      kind: 'paper',
      sources: ['manual'],
      ...doi === undefined || doi === '' ? {} : { doi },
      ...arxivId === undefined || arxivId === '' ? {} : { arxivId },
      ...args.url === undefined || args.url === '' ? {} : { url: args.url },
    },
    tags,
    withPdf,
  })
}

/**
 * Reduce a DOI the model wrote to the form an entry id is built from.
 * @param doi - the DOI as the call carried it, possibly URL-prefixed.
 * @returns the lowercase bare DOI, or undefined when none was given.
 */
export function normalizeDoi(doi: string | undefined): string | undefined {
  if (doi === undefined) return undefined
  const bare = doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
  return bare === '' ? undefined : bare
}
