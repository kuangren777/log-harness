// The model-visible half: the two schemas, the text a call renders, the prompt
// section, and the one decision `library_add` makes that a schema cannot show —
// that an identifier is resolved through the literature layer before anything
// is stored from the model's memory.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature/types'
import {
  LIBRARY_ADD_TOOL,
  LIBRARY_PROMPT_ORDER,
  LIBRARY_PROMPT_SECTION,
  LIBRARY_SEARCH_TOOL,
  RENDERED_AUTHORS,
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
} from '../src/tool.ts'
import type { LibraryTooling } from '../src/tool.ts'
import { entry, file, T0 } from './fixtures.ts'

const RECORD: LiteratureRecord = {
  id: 'doi:10.1/x',
  title: 'A work',
  authors: ['Zhao, Li-Dong'],
  doi: '10.1/x',
  url: 'https://doi.org/10.1/x',
  source: 'openalex',
  sources: ['openalex'],
}

/**
 * A tooling stub recording what the tool asked it for.
 * @param overrides - the capabilities this case cares about.
 * @returns the stub.
 */
function tooling(overrides: Partial<LibraryTooling> = {}): LibraryTooling {
  return {
    list: vi.fn(() => Promise.resolve({
      entries: [], total: 0, tags: [], counts: { all: 0, paper: 0, dataset: 0, note: 0, lowConfidence: 0 },
    })),
    add: vi.fn(() => Promise.resolve({ entry: entry(), created: true })),
    lookup: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  }
}

describe('libraryToolEntry', () => {
  it('carries only the optional columns the row holds and prefixes every file path', () => {
    const value = libraryToolEntry(entry({ year: 2015, files: [file()] }), '/home/user/sci/library/')

    expect(value.year).toBe(2015)
    expect('venue' in value).toBe(false)
    expect(value.files).toEqual(['/home/user/sci/library/doi-10.1103-physrevb.91.205201/paper.pdf'])
  })

  it('carries every optional column when the row holds them all', () => {
    const value = libraryToolEntry(entry({
      year: 2015, venue: 'PRB', abstract: 'a', doi: 'd', arxivId: 'x',
      url: 'u', pdfUrl: 'p', citedBy: 7, note: 'n',
    }), '/lib')

    expect(value).toMatchObject({ year: 2015, venue: 'PRB', abstract: 'a', doi: 'd', arxivId: 'x', url: 'u', pdfUrl: 'p', citedBy: 7, note: 'n' })
  })

  it('hands the registry its own arrays', () => {
    const source = entry({ tags: ['a'] })
    const value = libraryToolEntry(source, '/lib')
    value.tags.push('b')

    expect(source.tags).toEqual(['a'])
  })
})

describe('formatLibraryEntry', () => {
  it('names authors, year, status, tags, identifiers, and the file count', () => {
    const line = formatLibraryEntry(libraryToolEntry(entry({
      year: 2015, doi: '10.1/x', arxivId: '1501.1', tags: ['zt'], files: [file()],
    }), '/lib'), 0)

    expect(line).toBe('[1] Thermoelectric transport in n-type SnSe — Zhao, Li-Dong, Chang, Cheng · 2015 · unread · 标签 zt · doi:10.1/x · arXiv:1501.1 · 1 个文件')
  })

  it(`abbreviates past ${String(RENDERED_AUTHORS)} authors`, () => {
    const line = formatLibraryEntry(libraryToolEntry(entry({ authors: ['a', 'b', 'c', 'd'] }), '/lib'), 1)

    expect(line).toContain('[2] ')
    expect(line).toContain('a, b, c et al.')
  })

  it('omits an empty author list rather than rendering a stray separator', () => {
    expect(formatLibraryEntry(libraryToolEntry(entry({ authors: [] }), '/lib'), 0))
      .toBe('[1] Thermoelectric transport in n-type SnSe — unread')
  })
})

describe('formatLibrarySearchOutput', () => {
  it('states the match count, the whole-library counts, and where a file is', () => {
    const text = formatLibrarySearchOutput({
      entries: [libraryToolEntry(entry({ files: [file()] }), '/lib')],
      total: 1,
      counts: { all: 3, paper: 2, dataset: 1, note: 0, lowConfidence: 0 },
    })

    expect(text).toContain('匹配 1 条，返回前 1 条（知识库共 3 条：2 篇文献、1 个数据集、0 条笔记）：')
    expect(text).toContain('/lib/doi-10.1103-physrevb.91.205201/paper.pdf')
  })

  it('says the library has nothing matching rather than rendering an empty list', () => {
    const text = formatLibrarySearchOutput({
      entries: [],
      total: 0,
      counts: { all: 7, paper: 7, dataset: 0, note: 0, lowConfidence: 0 },
    })

    expect(text).toBe('知识库里没有匹配的条目（共 7 条）。')
  })

  it('omits the file hint when nothing returned has a file', () => {
    const text = formatLibrarySearchOutput({
      entries: [libraryToolEntry(entry(), '/lib')],
      total: 1,
      counts: { all: 1, paper: 1, dataset: 0, note: 0, lowConfidence: 0 },
    })

    expect(text).not.toContain('read 或 pdf')
  })
})

describe('formatLibraryAddOutput', () => {
  it('says it was added, and names the files when there are any', () => {
    const text = formatLibraryAddOutput({ entry: libraryToolEntry(entry({ files: [file()] }), '/lib'), created: true })

    expect(text).toContain('已加入知识库：Thermoelectric transport in n-type SnSe（id doi:10.1103/physrevb.91.205201）')
    expect(text).toContain('文件：/lib/doi-10.1103-physrevb.91.205201/paper.pdf')
  })

  it('says it was merged when the id was already there', () => {
    expect(formatLibraryAddOutput({ entry: libraryToolEntry(entry(), '/lib'), created: false }))
      .toContain('已在知识库中，已合并标签与文件')
  })

  it('reports a download failure without failing the add', () => {
    const text = formatLibraryAddOutput({ entry: libraryToolEntry(entry(), '/lib'), created: true, fetchError: 'LIBRARY_NOT_PDF' })

    expect(text).toContain('PDF 未能下载（LIBRARY_NOT_PDF），条目本身已保存。')
  })
})

describe('presentation metadata', () => {
  it('keys the browser card on the library kind', () => {
    const value = libraryToolEntry(entry(), '/lib')

    expect(librarySearchMetaFromValue({ entries: [value], total: 1, counts: { all: 1, paper: 1, dataset: 0, note: 0, lowConfidence: 0 } }))
      .toEqual({ kind: 'library', entries: [value] })
    expect(libraryAddMetaFromValue({ entry: value, created: true }))
      .toEqual({ kind: 'library', entries: [value], created: true })
  })
})

describe('libraryPromptText', () => {
  it('names both tools and the real library root, with no trailing slash', () => {
    const text = libraryPromptText('/home/user/sci/library/')

    expect(text).toContain(LIBRARY_SEARCH_TOOL)
    expect(text).toContain(LIBRARY_ADD_TOOL)
    expect(text).toContain('/home/user/sci/library/<条目目录>/')
  })

  it('sits after the literature section', () => {
    expect(LIBRARY_PROMPT_ORDER).toBe(112)
    expect(LIBRARY_PROMPT_SECTION).toBe('tool:library')
  })
})

describe('normalizeDoi', () => {
  it('strips the resolver prefix and lowercases', () => {
    expect(normalizeDoi('https://doi.org/10.1/X')).toBe('10.1/x')
    expect(normalizeDoi('http://dx.doi.org/10.1/X')).toBe('10.1/x')
  })

  it('is undefined for an absent or blank value', () => {
    expect(normalizeDoi(undefined)).toBeUndefined()
    expect(normalizeDoi('  ')).toBeUndefined()
  })
})

describe('addFromArgs', () => {
  it('resolves a DOI through the literature layer and stores the record it returned', async () => {
    const library = tooling({ lookup: vi.fn(() => Promise.resolve(RECORD)) })

    await addFromArgs(library, { doi: 'https://doi.org/10.1/X', tags: ['zt'], with_pdf: true })

    expect(library.lookup).toHaveBeenCalledWith('10.1/x', undefined)
    expect(library.add).toHaveBeenCalledWith({ record: RECORD, tags: ['zt'], withPdf: true })
  })

  it('resolves an arXiv id when no DOI was given', async () => {
    const library = tooling({ lookup: vi.fn(() => Promise.resolve(RECORD)) })

    await addFromArgs(library, { arxiv_id: ' 2607.09182 ' })

    expect(library.lookup).toHaveBeenCalledWith('2607.09182', undefined)
  })

  it('falls back to a manual entry when nothing resolved, keeping the identifiers the caller gave', async () => {
    const library = tooling()

    await addFromArgs(library, { doi: '10.1/x', arxiv_id: '2607.09182', title: '  A work  ', url: 'https://example.org' })

    expect(library.add).toHaveBeenCalledWith({
      entry: {
        title: 'A work',
        kind: 'paper',
        sources: ['manual'],
        doi: '10.1/x',
        arxivId: '2607.09182',
        url: 'https://example.org',
      },
      tags: [],
      withPdf: false,
    })
  })

  it('stores a bare title with no identifier at all', async () => {
    const library = tooling()

    await addFromArgs(library, { title: 'Just a note' })

    expect(library.lookup).not.toHaveBeenCalled()
    expect(library.add).toHaveBeenCalledWith({
      entry: { title: 'Just a note', kind: 'paper', sources: ['manual'] },
      tags: [],
      withPdf: false,
    })
  })

  it('refuses a call that resolved nothing and named no title', async () => {
    await expect(addFromArgs(tooling(), { doi: '10.1/unknown' })).rejects.toThrow(/needs a title/)
    await expect(addFromArgs(tooling(), { title: '   ' })).rejects.toThrow(/needs a title/)
  })

  it('passes the caller signal to the lookup', async () => {
    const library = tooling({ lookup: vi.fn(() => Promise.resolve(RECORD)) })
    const signal = new AbortController().signal

    await addFromArgs(library, { doi: '10.1/x' }, signal)

    expect(library.lookup).toHaveBeenCalledWith('10.1/x', signal)
  })

  it('treats an empty identifier as none', async () => {
    const library = tooling()

    await addFromArgs(library, { doi: '', arxiv_id: '', title: 'x' })

    expect(library.lookup).not.toHaveBeenCalled()
  })
})

describe('fixture dates', () => {
  it('are the authored clock, not the wall clock', () => {
    expect(entry().addedAt).toBe(T0)
  })
})

describe('the registered tool definitions', () => {
  /**
   * Register both tools on a real registry and hand back what the model and the
   * browser actually see.
   * @param library - the tooling stub the tools are served by.
   * @returns the two definitions and the assembled prompt.
   */
  async function register(library: LibraryTooling = tooling()) {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    applyLibraryTools(ctx, library, '/lib')
    return {
      ctx,
      search: ctx.tools.get(LIBRARY_SEARCH_TOOL) as ToolDefinition,
      add: ctx.tools.get(LIBRARY_ADD_TOOL) as ToolDefinition,
      prompt: renderPrompt(await ctx.systemPrompt.assemble()),
    }
  }

  it('declares the read tool concurrency-safe and the write tool not', async () => {
    const { ctx, search, add } = await register()

    expect(search.isConcurrencySafe?.({})).toBe(true)
    expect(add.isConcurrencySafe?.({})).toBe(false)

    await ctx.fiber.dispose()
  })

  it('presents a search call by its query, and a bare listing by name', async () => {
    const { ctx, search } = await register()

    expect(search.presentCall?.({ query: 'snse' }))
      .toEqual({ card: 'generic', title: '检索知识库：snse', kind: 'search', rawInput: 'snse' })
    expect(search.presentCall?.({}))
      .toEqual({ card: 'generic', title: '列出知识库', kind: 'search', rawInput: '' })
    expect(search.presentResult?.({}, { content: [], isError: false })).toEqual({ card: 'generic' })

    await ctx.fiber.dispose()
  })

  it('presents an add call by whichever identifier the model gave', async () => {
    const { ctx, add } = await register()

    expect(add.presentCall?.({ title: 'A work' })).toMatchObject({ title: '加入知识库：A work' })
    expect(add.presentCall?.({ doi: '10.1/x' })).toMatchObject({ title: '加入知识库：10.1/x' })
    expect(add.presentCall?.({ arxiv_id: '2607.1' })).toMatchObject({ title: '加入知识库：2607.1', rawInput: '2607.1' })
    expect(add.presentCall?.({})).toMatchObject({ title: '加入知识库：', rawInput: '' })
    expect(add.presentResult?.({}, { content: [], isError: false })).toEqual({ card: 'generic' })

    await ctx.fiber.dispose()
  })

  it('forwards every filter the model named, and none it did not', async () => {
    const library = tooling()
    const { ctx } = await register(library)

    await ctx.tools.execute({
      callId: CallId('call-1'),
      name: LIBRARY_SEARCH_TOOL,
      arguments: { query: 'snse', kind: 'paper', status: 'read', tag: 'zt', limit: 5 },
      signal: new AbortController().signal,
    })
    await ctx.tools.execute({
      callId: CallId('call-2'),
      name: LIBRARY_SEARCH_TOOL,
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(library.list).toHaveBeenNthCalledWith(1, { query: 'snse', kind: 'paper', status: 'read', tag: 'zt', limit: 5 })
    expect(library.list).toHaveBeenNthCalledWith(2, {})

    await ctx.fiber.dispose()
  })

  it('renders the download failure through the registered result path', async () => {
    const library = tooling({
      add: vi.fn(() => Promise.resolve({ entry: entry(), created: true, fetchError: 'LIBRARY_NOT_PDF' })),
    })
    const { ctx } = await register(library)

    const result = await ctx.tools.execute({
      callId: CallId('call-3'),
      name: LIBRARY_ADD_TOOL,
      arguments: { title: 'A work', with_pdf: true },
      signal: new AbortController().signal,
    })

    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('PDF 未能下载（LIBRARY_NOT_PDF）')

    await ctx.fiber.dispose()
  })

  it('contributes the prompt section naming both tools', async () => {
    const { ctx, prompt } = await register()

    expect(prompt).toContain('用户的知识库用 library_search 查')

    await ctx.fiber.dispose()
  })
})
