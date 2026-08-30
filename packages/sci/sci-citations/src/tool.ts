/**
 * The two model-facing tools: `citations_list` and `citations_add`.
 *
 * The prompt section beside them states the one thing a schema cannot: a
 * citekey is not a name the model may invent. It comes back from
 * `citations_add`, which resolved the work and wrote the bibliography entry
 * first, and only then may the manuscript say `\cite{…}`. That is the whole
 * point of routing citations through a tool instead of letting the model type
 * into `refs.bib` — a `\cite` to a key no bibliography defines renders as `[?]`
 * in the built PDF, and a reader has no way to tell it from a typo.
 *
 * Neither tool asks the model which project it is in. The session already sits
 * in one, so the slug is inferred from its working directory, and a session
 * that is nowhere gets a refusal rather than a guess.
 * @module @deepseek-ai/dsh-sci-citations/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { CitationsError, CITATIONS_NO_PROJECT } from './error.ts'
import { recordCitationsChange } from './events.ts'
import { assertProjectSlug, projectSlugFromCwd } from './project.ts'
import type {
  Citation,
  CitationAddRequest,
  CitationAddResult,
  CitationPool,
  CitationPoolRequest,
} from './types.ts'

/** Name of the tool that reads one project's pool. */
export const CITATIONS_LIST_TOOL = 'citations_list'

/** Name of the tool that puts one work into the pool and the bibliography. */
export const CITATIONS_ADD_TOOL = 'citations_add'

/** Name of the system-prompt section both tools share. */
export const CITATIONS_PROMPT_SECTION = 'tool:citations'

/** Order of that section, right after `tool:library`. */
export const CITATIONS_PROMPT_ORDER = 113

/**
 * The system-prompt guidance registered beside the tools.
 *
 * It states the one rule the schemas cannot carry — a citekey is minted by
 * `citations_add`, never by the model — and the one check that makes the rule
 * verifiable before a draft is handed over.
 */
export const CITATIONS_PROMPT_TEXT = '写论文或综述时，每引用一篇文献先调用 citations_add 放进本项目的引用池，它会解析文献并写入 papers/<slug>/src/refs.bib，然后用它返回的 citekey：LaTeX 里写 \\cite{citekey}，Markdown 里写 `[citekey]`。不要自己编 citekey，也不要手写 refs.bib 条目——引用池里没有的 citekey 在排版后是 [?]。交付前调用 citations_list 核对：带「隔离」的条目不能出现在正文里，引用次数为 0 的条目要么用上要么移除。「隔离」只是低置信度标记，无法也无需人工消除，报出即可。refs.bib 由工具维护——项目没有 papers/<slug>/ 目录时它不存在，不要去查找或手写它。project 参数留空表示当前会话所在的项目。'

/** The capabilities the tools need from `ctx.sciCitations`. */
export interface CitationsPoolService {
  /** The resolved deployment configuration; only `projectRoot` is read. */
  readonly config: { readonly projectRoot: string }
  /**
   * Read one project's pool.
   * @param request - the project to read.
   * @returns the groups, citations, and header counters.
   */
  pool: (request: CitationPoolRequest) => Promise<CitationPool>
  /**
   * Put one work in the pool and in the bibliography.
   * @param request - the project plus whatever identifies the work.
   * @returns the stored citation and whether the citekey was new.
   */
  add: (request: CitationAddRequest) => Promise<CitationAddResult>
}

/** One citation as the tools render and return it. */
export interface CitationToolEntry {
  /** The citekey the manuscript writes. */
  citekey: string
  /** Work title. */
  title: string
  /** Author names. */
  authors: string[]
  /** Publication year. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Lowercase DOI. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Every source that vouched for the work. */
  sources: string[]
  /** Group key the citation is filed under. */
  group: string
  /** Deterministic 0..100 confidence. */
  confidence: number
  /** Whether the entry is held back from the manuscript. */
  quarantined: boolean
  /** In-text occurrences the last scan counted. */
  uses: number
}

/** The canonical `citations_list` output value. */
export interface CitationsListValue {
  /** The project the pool belongs to. */
  project: string
  /** The selected citations, ordered by citekey. */
  citations: CitationToolEntry[]
  /** How many citations the selection holds. */
  total: number
  /** How many of them are quarantined. */
  quarantined: number
  /** Mean confidence of the selection, rounded; `0` when it is empty. */
  avgConfidence: number
}

/** The canonical `citations_add` output value. */
export interface CitationsAddValue {
  /** The project the citation landed in. */
  project: string
  /** Whether the citekey was new to the project. */
  created: boolean
  /** The stored citation. */
  citation: CitationToolEntry
}

/** The model-facing arguments of one `citations_list` call. */
export interface CitationsListArgs {
  /** Project slug; the session's own project when absent. */
  project?: string
  /** Only this group. */
  group?: string
}

/** The model-facing arguments of one `citations_add` call. */
export interface CitationsAddArgs {
  /** Project slug; the session's own project when absent. */
  project?: string
  /** DOI of the work. */
  doi?: string
  /** arXiv id of the work. */
  arxiv_id?: string
  /** Knowledge-base entry id of the work. */
  library_id?: string
  /** Citekey to use instead of the derived one. */
  citekey?: string
  /** Group to file the citation under. */
  group?: string
}

/**
 * Project one stored citation onto the shape the tools expose.
 * @param citation - the stored row.
 * @returns the entry, with mutable arrays the tool registry may own.
 */
export function citationEntry(citation: Citation): CitationToolEntry {
  return {
    citekey: citation.citekey,
    title: citation.title,
    authors: [...citation.authors],
    ...citation.year === undefined ? {} : { year: citation.year },
    ...citation.venue === undefined ? {} : { venue: citation.venue },
    ...citation.doi === undefined ? {} : { doi: citation.doi },
    ...citation.arxivId === undefined ? {} : { arxivId: citation.arxivId },
    ...citation.url === undefined ? {} : { url: citation.url },
    sources: [...citation.sources],
    group: citation.group,
    confidence: citation.confidence,
    quarantined: citation.quarantined,
    uses: citation.uses,
  }
}

/**
 * Project one pool into the canonical `citations_list` value.
 * @param pool - the pool as the service returned it.
 * @param group - the group filter the call carried, when any.
 * @returns the canonical value over the selected citations.
 */
export function listValue(pool: CitationPool, group: string | undefined): CitationsListValue {
  const selected = pool.citations.filter(citation => group === undefined || citation.group === group)
  const sum = selected.reduce((carry, citation) => carry + citation.confidence, 0)
  return {
    project: pool.project,
    citations: selected.map(citation => citationEntry(citation)),
    total: selected.length,
    quarantined: selected.filter(citation => citation.quarantined).length,
    avgConfidence: selected.length === 0 ? 0 : Math.round(sum / selected.length),
  }
}

/**
 * Render one citation as its line of the numbered list.
 * @param entry - the projected citation.
 * @param position - the zero-based position in the returned list.
 * @returns the rendered line.
 */
export function formatCitationLine(entry: CitationToolEntry, position: number): string {
  const parts = [
    ...entry.year === undefined ? [] : [String(entry.year)],
    `置信 ${entry.confidence}%`,
    `分组 ${entry.group}`,
    `引用 ${entry.uses} 处`,
    ...entry.quarantined ? ['隔离'] : [],
  ]
  return `[${position + 1}] [${entry.citekey}] ${entry.title} · ${parts.join(' · ')}`
}

/**
 * Render one completed `citations_list` as the text the model reads.
 * @param value - the canonical value.
 * @returns the header line, the numbered table, and the quarantine reminder.
 */
export function formatListOutput(value: CitationsListValue): string {
  if (value.total === 0) return `项目 ${value.project} 的引用池里没有条目。`
  const lines = [
    `项目 ${value.project}：${value.total} 条引用 · 平均置信 ${value.avgConfidence}% · ${value.quarantined} 条隔离`,
    ...value.citations.map((entry, position) => formatCitationLine(entry, position)),
  ]
  if (value.quarantined > 0) lines.push('带「隔离」的条目不要写进正文。')
  return lines.join('\n')
}

/**
 * Render one completed `citations_add` as the text the model reads.
 * @param value - the canonical value.
 * @returns the one-line confirmation naming the citekey to cite with.
 */
export function formatAddOutput(value: CitationsAddValue): string {
  const entry = value.citation
  const verb = value.created ? '已加入' : '已更新'
  return `${verb}引用池：[${entry.citekey}] ${entry.title} · 置信 ${entry.confidence}% · 分组 ${entry.group}。`
    + `正文引用写 \\cite{${entry.citekey}} 或 \`[${entry.citekey}]\`。`
}

/**
 * Project one list value into the replayable card data.
 * @param value - the canonical value.
 * @returns the `citations` metadata the browser's tool card renders from.
 */
export function listMetaFromValue(value: CitationsListValue): JsonValue {
  // The entries are JSON-shaped by construction; the declared interface simply
  // carries no index signature for `JsonValue` to match structurally.
  return { kind: 'citations', project: value.project, citations: value.citations } as unknown as JsonValue
}

/**
 * Project one add value into the replayable card data.
 * @param value - the canonical value.
 * @returns the `citation` metadata the browser's tool card renders from.
 */
export function addMetaFromValue(value: CitationsAddValue): JsonValue {
  return {
    kind: 'citation',
    project: value.project,
    created: value.created,
    citation: value.citation,
  } as unknown as JsonValue
}

/**
 * The project one tool call is about.
 * @param exec - the execution, read for the session's working directory.
 * @param projectRoot - the configured directory holding one folder per project.
 * @param given - the `project` argument, when the model stated one.
 * @returns the project slug.
 * @throws CitationsError `CITATIONS_NO_PROJECT` when no argument was given and
 *   the session is not inside a project directory.
 */
export function toolProject(exec: ToolRunContext, projectRoot: string, given: string | undefined): string {
  if (given !== undefined && given.trim() !== '') return assertProjectSlug(given)
  const slug = projectSlugFromCwd(exec.agent?.session.header.cwd, projectRoot)
  if (slug === undefined) {
    throw new CitationsError(
      `当前会话不在 ${projectRoot}/<项目>/ 里，无法推断是哪个项目的引用池，请在参数里写明 project`,
      CITATIONS_NO_PROJECT,
    )
  }
  return slug
}

/** The citation fields both canonical values declare, mirroring {@link CitationToolEntry}. */
const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    citekey: { type: 'string', required: true },
    title: { type: 'string', required: true },
    authors: { type: 'array', required: true, items: { type: 'string' } },
    year: { type: 'number' },
    venue: { type: 'string' },
    doi: { type: 'string' },
    arxivId: { type: 'string' },
    url: { type: 'string' },
    sources: { type: 'array', required: true, items: { type: 'string' } },
    group: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    quarantined: { type: 'boolean', required: true },
    uses: { type: 'number', required: true },
  },
} as const

/**
 * Register both citation tools and their shared prompt section.
 * @param ctx - the plugin context carrying the tool registry and the system prompt.
 * @param citations - the citation runtime every call is served by.
 */
export function applyCitationsTool(ctx: Context, citations: CitationsPoolService): void {
  ctx.systemPrompt.section({
    name: CITATIONS_PROMPT_SECTION,
    order: CITATIONS_PROMPT_ORDER,
    text: CITATIONS_PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: CITATIONS_LIST_TOOL,
    description: 'List the citation pool of the current paper project: every citekey with its title, year, '
      + 'deterministic confidence score, group, and how many times the manuscript actually cites it. '
      + 'Use it before handing over a draft to check that no quarantined or unused entry is left in the text.',
    parameters: {
      project: { type: 'string', description: 'Project directory name. Omit to use the project this session is working in.' },
      group: { type: 'string', description: 'Only citations filed under this group key.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', required: true },
          citations: { type: 'array', required: true, items: ENTRY_SCHEMA },
          total: { type: 'number', required: true },
          quarantined: { type: 'number', required: true },
          avgConfidence: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatListOutput(value) }],
      presentationMeta: (_args, value) => listMetaFromValue(value),
    },
    // Tables and files are read; nothing is written and nothing in the parent
    // agent is touched.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const project = toolProject(exec, citations.config.projectRoot, args.project)
      const pool = await citations.pool({ project })
      return listValue(pool, args.group)
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: args.project === undefined ? '查看引用池' : `查看引用池：${args.project}`,
      kind: 'read',
    }),
    presentResult: () => ({ card: 'generic' }),
  }))

  ctx.tools.register(defineTool({
    name: CITATIONS_ADD_TOOL,
    description: 'Resolve one work by DOI, arXiv id, or knowledge-base id and put it in the current paper '
      + "project's citation pool, writing the entry into papers/<slug>/src/refs.bib. Returns the citekey to "
      + 'cite with. Always use this instead of writing a refs.bib entry or inventing a citekey by hand.',
    parameters: {
      project: { type: 'string', description: 'Project directory name. Omit to use the project this session is working in.' },
      doi: { type: 'string', description: 'DOI of the work, with or without the https://doi.org/ prefix.' },
      arxiv_id: { type: 'string', description: 'arXiv identifier without a version suffix, for example 2607.09182.' },
      library_id: { type: 'string', description: 'Knowledge-base entry id, when the work is already in the library.' },
      citekey: { type: 'string', description: 'Citekey to use. Omit to derive <family><year> with a de-duplicating suffix.' },
      group: { type: 'string', description: 'Group key to file the citation under. Defaults to ungrouped.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          citation: { ...ENTRY_SCHEMA, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatAddOutput(value) }],
      presentationMeta: (_args, value) => addMetaFromValue(value),
    },
    async execute(args, exec) {
      const project = toolProject(exec, citations.config.projectRoot, args.project)
      const result = await citations.add({
        project,
        ...args.citekey === undefined ? {} : { citekey: args.citekey },
        ...args.doi === undefined ? {} : { doi: args.doi },
        ...args.arxiv_id === undefined ? {} : { arxivId: args.arxiv_id },
        ...args.library_id === undefined ? {} : { libraryId: args.library_id },
        ...args.group === undefined ? {} : { group: args.group },
      })
      // Only the tool path has a session to record in; a change made from the
      // browser view is recorded by the tables alone.
      if (exec.agent !== undefined) {
        recordCitationsChange(exec.agent.session, project, 'add', result.citation.citekey)
      }
      return { project, created: result.created, citation: citationEntry(result.citation) }
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `加入引用池：${args.doi ?? args.arxiv_id ?? args.library_id ?? args.citekey ?? ''}`,
      kind: 'other',
    }),
    presentResult: () => ({ card: 'generic' }),
  }))
}
