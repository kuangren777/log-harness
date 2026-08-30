// The model-visible half: the two schemas, the text a call renders, the prompt
// section, and the one decision a schema cannot show — that a tool refuses to
// guess which project it is in rather than filing a citation into the wrong
// manuscript's bibliography.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { CITATIONS_NO_PROJECT, CitationsError } from '../src/error.ts'
import {
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
} from '../src/tool.ts'
import type { CitationsPoolService } from '../src/tool.ts'
import type { CitationPool } from '../src/types.ts'
import { PROJECT, citation } from './fixtures.ts'

const ROOT = '/home/user/sci/projects'

/**
 * One pool the stubbed service answers with.
 * @param citations - the rows the pool holds.
 * @returns the pool.
 */
function pool(citations = [citation()]): CitationPool {
  return {
    project: PROJECT,
    groups: [],
    citations,
    stats: { total: citations.length, avgConfidence: 90, quarantined: 0, scannedFiles: 0 },
  }
}

/**
 * A citation service recording what the tools asked it for.
 * @param overrides - the capabilities this case cares about.
 * @returns the stub.
 */
function service(overrides: Partial<CitationsPoolService> = {}): CitationsPoolService {
  return {
    config: { projectRoot: ROOT },
    pool: vi.fn(() => Promise.resolve(pool())),
    add: vi.fn(() => Promise.resolve({ citation: citation(), created: true })),
    ...overrides,
  }
}

/**
 * A run context whose session sits in one directory.
 * @param cwd - the session's working directory, or `undefined` for no agent.
 * @returns the run context the tools read.
 */
function exec(cwd: string | undefined): ToolRunContext {
  if (cwd === undefined) return {} as ToolRunContext
  return { agent: { session: { header: { cwd } } } as Agent } as ToolRunContext
}

describe('citationEntry', () => {
  it('carries only the optional columns the row holds', () => {
    const entry = citationEntry(citation({ venue: undefined, arxivId: '1501.00001' }))

    expect(entry.arxivId).toBe('1501.00001')
    expect(Object.hasOwn(entry, 'venue')).toBe(false)
    expect(Object.hasOwn(entry, 'url')).toBe(false)
  })

  it('carries none of them for a row that is only a title', () => {
    const entry = citationEntry(citation({ year: undefined, venue: undefined, doi: undefined }))

    expect(entry).toEqual({
      citekey: 'zhao2015',
      title: 'Ultralow thermal conductivity in SnSe crystals',
      authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
      sources: ['openalex', 'crossref'],
      group: 'ungrouped',
      confidence: 90,
      quarantined: false,
      uses: 0,
    })
  })

  it('carries every optional column when the row holds them all', () => {
    const entry = citationEntry(citation({ arxivId: '1501.00001', url: 'https://example.org/p' }))

    expect(entry).toMatchObject({
      year: 2015,
      venue: 'Nature',
      doi: '10.1038/nature13184',
      arxivId: '1501.00001',
      url: 'https://example.org/p',
    })
  })
})

describe('listValue', () => {
  it('summarizes the whole pool when no group was named', () => {
    const value = listValue(pool([citation({ citekey: 'a', confidence: 90 }), citation({ citekey: 'b', confidence: 30, quarantined: true })]), undefined)

    expect(value).toMatchObject({ project: PROJECT, total: 2, quarantined: 1, avgConfidence: 60 })
  })

  it('summarizes only the named group', () => {
    const rows = [citation({ citekey: 'a', group: 'method' }), citation({ citekey: 'b', group: 'ungrouped' })]

    expect(listValue(pool(rows), 'method').citations.map(entry => entry.citekey)).toEqual(['a'])
  })

  it('reports an empty selection without dividing by zero', () => {
    expect(listValue(pool([]), undefined)).toMatchObject({ total: 0, avgConfidence: 0, quarantined: 0 })
  })
})

describe('formatCitationLine and formatListOutput', () => {
  it('numbers the line and names every column the model acts on', () => {
    const line = formatCitationLine(citationEntry(citation({ uses: 3 })), 0)

    expect(line).toBe('[1] [zhao2015] Ultralow thermal conductivity in SnSe crystals · 2015 · 置信 90% · 分组 ungrouped · 引用 3 处')
  })

  it('marks a quarantined entry and omits an unknown year', () => {
    const line = formatCitationLine(citationEntry(citation({ year: undefined, quarantined: true })), 1)

    expect(line).toContain('[2] [zhao2015]')
    expect(line).toContain('隔离')
    expect(line).not.toContain('· 2015 ·')
  })

  it('says the pool is empty rather than printing a bare header', () => {
    expect(formatListOutput(listValue(pool([]), undefined))).toBe(`项目 ${PROJECT} 的引用池里没有条目。`)
  })

  it('leads with the real counts and warns only when something is quarantined', () => {
    const clean = formatListOutput(listValue(pool([citation()]), undefined))
    const dirty = formatListOutput(listValue(pool([citation({ confidence: 30, quarantined: true })]), undefined))

    expect(clean).toContain(`项目 ${PROJECT}：1 条引用 · 平均置信 90% · 0 条隔离`)
    expect(clean).not.toContain('不要写进正文')
    expect(dirty).toContain('带「隔离」的条目不要写进正文。')
  })
})

describe('formatAddOutput', () => {
  it('names the citekey and both spellings the model may cite it with', () => {
    const text = formatAddOutput({ project: PROJECT, created: true, citation: citationEntry(citation()) })

    expect(text).toContain('已加入引用池：[zhao2015]')
    expect(text).toContain('正文引用写 \\cite{zhao2015} 或 `[zhao2015]`。')
  })

  it('says updated when the citekey was already there', () => {
    expect(formatAddOutput({ project: PROJECT, created: false, citation: citationEntry(citation()) }))
      .toContain('已更新引用池')
  })
})

describe('presentation metadata', () => {
  it('keys the browser cards on the citation kinds', () => {
    const entry = citationEntry(citation())

    expect(listMetaFromValue(listValue(pool(), undefined)))
      .toEqual({ kind: 'citations', project: PROJECT, citations: [entry] })
    expect(addMetaFromValue({ project: PROJECT, created: true, citation: entry }))
      .toEqual({ kind: 'citation', project: PROJECT, created: true, citation: entry })
  })
})

describe('toolProject', () => {
  it('takes the slug the model stated', () => {
    expect(toolProject(exec(undefined), ROOT, ' snse ')).toBe(PROJECT)
  })

  it.each([
    ['the project directory itself', `${ROOT}/snse`],
    ['a directory inside the project', `${ROOT}/snse/papers/p1/src`],
  ])('infers the slug from %s', (_case, cwd) => {
    expect(toolProject(exec(cwd), ROOT, undefined)).toBe(PROJECT)
  })

  it.each([
    ['no argument and no agent', undefined, undefined],
    ['an empty argument and a session outside any project', '/tmp', '  '],
  ])('refuses to guess given %s', (_case, cwd, given) => {
    expect(() => toolProject(exec(cwd), ROOT, given)).toThrow(CitationsError)
    expect(() => toolProject(exec(cwd), ROOT, given))
      .toThrow(expect.objectContaining({ code: CITATIONS_NO_PROJECT }))
  })

  it('names the directory shape the model has to be in, so the refusal is actionable', () => {
    expect(() => toolProject(exec(undefined), ROOT, undefined)).toThrow(`${ROOT}/<项目>/`)
  })
})

describe('the registered tools', () => {
  /**
   * Register both tools on a real registry and prompt assembly.
   * @param citations - the service the tools are served by.
   * @returns the context, both definitions, and the assembled prompt.
   */
  async function register(citations: CitationsPoolService = service()) {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    applyCitationsTool(ctx, citations)
    return {
      ctx,
      list: ctx.tools.get(CITATIONS_LIST_TOOL) as ToolDefinition,
      add: ctx.tools.get(CITATIONS_ADD_TOOL) as ToolDefinition,
      prompt: renderPrompt(await ctx.systemPrompt.assemble()),
    }
  }

  it('publishes both schemas with every documented parameter and no required one', async () => {
    const { ctx, list, add } = await register()

    expect(Object.keys(list.parameters?.properties ?? {}).sort()).toEqual(['group', 'project'])
    expect(Object.keys(add.parameters?.properties ?? {}).sort())
      .toEqual(['arxiv_id', 'citekey', 'doi', 'group', 'library_id', 'project'])
    expect(add.parameters?.required ?? []).toEqual([])

    await ctx.fiber.dispose()
  })

  it('declares the read tool concurrency-safe and the writing one not', async () => {
    const { ctx, list, add } = await register()

    expect(list.isConcurrencySafe?.({})).toBe(true)
    expect(add.isConcurrencySafe?.({})).toBeUndefined()

    await ctx.fiber.dispose()
  })

  it('presents a list call by its project, and a bare listing by name', async () => {
    const { ctx, list } = await register()

    expect(list.presentCall?.({ project: PROJECT }))
      .toEqual({ card: 'generic', title: `查看引用池：${PROJECT}`, kind: 'read' })
    expect(list.presentCall?.({})).toEqual({ card: 'generic', title: '查看引用池', kind: 'read' })
    expect(list.presentResult?.({}, { content: [], isError: false })).toEqual({ card: 'generic' })

    await ctx.fiber.dispose()
  })

  it('presents an add call by whichever identifier the model gave', async () => {
    const { ctx, add } = await register()

    expect(add.presentCall?.({ doi: '10.1/x' })).toMatchObject({ title: '加入引用池：10.1/x', kind: 'other' })
    expect(add.presentCall?.({ arxiv_id: '2607.1' })).toMatchObject({ title: '加入引用池：2607.1' })
    expect(add.presentCall?.({ library_id: 'note:1' })).toMatchObject({ title: '加入引用池：note:1' })
    expect(add.presentCall?.({ citekey: 'zhao2015' })).toMatchObject({ title: '加入引用池：zhao2015' })
    expect(add.presentCall?.({})).toMatchObject({ title: '加入引用池：' })
    expect(add.presentResult?.({}, { content: [], isError: false })).toEqual({ card: 'generic' })

    await ctx.fiber.dispose()
  })

  it('forwards the group filter the model named, and none it did not', async () => {
    const citations = service()
    const { ctx } = await register(citations)

    const filtered = await ctx.tools.execute({
      callId: CallId('call-1'),
      name: CITATIONS_LIST_TOOL,
      arguments: { project: PROJECT, group: 'method' },
      signal: new AbortController().signal,
    })

    expect(citations.pool).toHaveBeenCalledWith({ project: PROJECT })
    expect(filtered.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toBe(`项目 ${PROJECT} 的引用池里没有条目。`)

    await ctx.fiber.dispose()
  })

  it('forwards every identifier the model gave add, and none it did not', async () => {
    const citations = service()
    const { ctx } = await register(citations)

    await ctx.tools.execute({
      callId: CallId('call-2'),
      name: CITATIONS_ADD_TOOL,
      arguments: { project: PROJECT, doi: '10.1/x', arxiv_id: '2607.1', library_id: 'note:1', citekey: 'k', group: 'method' },
      signal: new AbortController().signal,
    })
    await ctx.tools.execute({
      callId: CallId('call-3'),
      name: CITATIONS_ADD_TOOL,
      arguments: { project: PROJECT },
      signal: new AbortController().signal,
    })

    expect(citations.add).toHaveBeenNthCalledWith(1, {
      project: PROJECT,
      citekey: 'k',
      doi: '10.1/x',
      arxivId: '2607.1',
      libraryId: 'note:1',
      group: 'method',
    })
    expect(citations.add).toHaveBeenNthCalledWith(2, { project: PROJECT })

    await ctx.fiber.dispose()
  })

  it('records the change in the calling agent’s session, and renders the citekey back', async () => {
    const { ctx } = await register()
    const session = ctx.sessions.create(undefined, { meta: { cwd: `${ROOT}/${PROJECT}` } })
    session.append('turn/start', { turn: 1 })

    const result = await ctx.tools.execute({
      callId: CallId('call-4'),
      name: CITATIONS_ADD_TOOL,
      arguments: {},
      agent: { id: session.id, session } as Agent,
      signal: new AbortController().signal,
    })

    expect(result.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      .toContain('已加入引用池：[zhao2015]')
    expect(session.events.filter(event => event.type === 'sci/citations-changed').map(event => event.data))
      .toEqual([{ project: PROJECT, op: 'add', citekey: 'zhao2015' }])

    await ctx.fiber.dispose()
  })

  it('records nothing when there is no agent session to record in', async () => {
    const citations = service()
    const { ctx } = await register(citations)

    const result = await ctx.tools.execute({
      callId: CallId('call-5'),
      name: CITATIONS_ADD_TOOL,
      arguments: { project: PROJECT },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBeFalsy()
    expect(citations.add).toHaveBeenCalledOnce()

    await ctx.fiber.dispose()
  })

  it('contributes the prompt section at the documented order, verbatim', async () => {
    const { ctx, prompt } = await register()

    expect(CITATIONS_PROMPT_SECTION).toBe('tool:citations')
    expect(CITATIONS_PROMPT_ORDER).toBe(113)
    expect(prompt).toContain(CITATIONS_PROMPT_TEXT)
    expect(prompt).toContain('不要自己编 citekey')

    await ctx.fiber.dispose()
  })

  it('unregisters both tools and the section when the fiber is disposed', async () => {
    const { ctx } = await register()
    const tools = ctx.tools

    await ctx.fiber.dispose()

    expect(tools.get(CITATIONS_LIST_TOOL)).toBeUndefined()
    expect(tools.get(CITATIONS_ADD_TOOL)).toBeUndefined()
  })
})
