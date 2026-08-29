// The model-facing half: the rendered list, the replayable card data, the
// canonical value, and the session record one call leaves behind.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  LITERATURE_PROMPT_ORDER,
  LITERATURE_PROMPT_TEXT,
  LITERATURE_TOOL,
  RENDERED_AUTHORS,
  applyLiteratureTool,
  formatLiteratureOutput,
  formatLiteratureRecord,
  identify,
  literatureMetaFromValue,
  literatureToolValue,
} from '@deepseek-ai/dsh-sci-literature'
import type {
  LiteratureRecord,
  LiteratureSearchRequest,
  LiteratureSearchResult,
  LiteratureToolValue,
} from '@deepseek-ai/dsh-sci-literature'

/**
 * Build one record for a rendering case.
 * @param overrides - the fields this case cares about.
 * @returns the record.
 */
function record(overrides: Partial<Omit<LiteratureRecord, 'id'>> = {}): LiteratureRecord {
  return identify({
    title: 'High-Performance n-type SnSe',
    authors: ['Gainza, J.', 'Serrano-Sánchez, F.', 'Rodrigues, J.', 'Nemes, N.'],
    year: 2020,
    venue: 'Cell Reports Physical Science',
    doi: '10.1016/j.xcrp.2020.100263',
    url: 'https://doi.org/10.1016/j.xcrp.2020.100263',
    citedBy: 41,
    source: 'openalex',
    sources: ['openalex'],
    ...overrides,
  })
}

/**
 * Build one canonical output value.
 * @param overrides - the fields this case cares about.
 * @returns the value.
 */
function value(overrides: Partial<LiteratureSearchResult> = {}): LiteratureToolValue {
  return literatureToolValue({ records: [record()], total: 1, sourceErrors: [], elapsedMs: 12, ...overrides })
}

describe('formatLiteratureRecord', () => {
  it('numbers the line and names at most three authors before et al.', () => {
    expect(formatLiteratureRecord(record(), 0)).toBe(
      '[1] High-Performance n-type SnSe — Gainza, J., Serrano-Sánchez, F., Rodrigues, J. et al. '
      + '· Cell Reports Physical Science · 2020 · 被引 41 · doi:10.1016/j.xcrp.2020.100263',
    )
  })

  it('names every author when there are no more than three', () => {
    expect(formatLiteratureRecord(record({ authors: ['A', 'B'] }), 1))
      .toContain('[2] High-Performance n-type SnSe — A, B ·')
    expect(RENDERED_AUTHORS).toBe(3)
  })

  it('names the arXiv id and the PDF when the record carries them', () => {
    const line = formatLiteratureRecord(record({ arxivId: '1502.04599', pdfUrl: 'https://arxiv.org/pdf/1502.04599' }), 0)
    expect(line).toContain('arXiv:1502.04599')
    expect(line).toContain('pdf https://arxiv.org/pdf/1502.04599')
  })

  it('renders a record with nothing but a title', () => {
    expect(formatLiteratureRecord(identify({
      title: 'A preprint', authors: [], url: 'https://x.test/a', source: 'arxiv', sources: ['arxiv'],
    }), 0)).toBe('[1] A preprint')
  })
})

describe('formatLiteratureOutput', () => {
  it('heads the list with the merged total and the returned count', () => {
    expect(formatLiteratureOutput(value({ total: 18 }))).toMatch(/^检索到 18 条，返回前 1 条：\n/)
  })

  it('says nothing was found rather than showing an empty list', () => {
    expect(formatLiteratureOutput(value({ records: [], total: 0 })))
      .toBe('没有检索到文献。\n引用时写 DOI 或 arXiv id。')
  })

  it('names each source that failed', () => {
    expect(formatLiteratureOutput(value({
      sourceErrors: [{ source: 'semanticscholar', code: 'LITERATURE_SOURCE_HTTP', message: 'x' }],
    }))).toContain('来源错误：semanticscholar（LITERATURE_SOURCE_HTTP）')
  })

  it('always closes with the citation rule', () => {
    expect(formatLiteratureOutput(value()).endsWith('引用时写 DOI 或 arXiv id。')).toBe(true)
  })
})

describe('literatureToolValue', () => {
  it('hands the registry its own arrays', () => {
    const result: LiteratureSearchResult = { records: [record()], total: 1, sourceErrors: [], elapsedMs: 12 }
    const projected = literatureToolValue(result)
    expect(projected.records[0]?.authors).not.toBe(result.records[0]?.authors)
    expect(projected).toEqual(JSON.parse(JSON.stringify(result)))
  })
})

describe('literatureMetaFromValue', () => {
  it('tags the card data and carries the records verbatim', () => {
    expect(literatureMetaFromValue(value())).toEqual({ kind: 'literature', records: value().records })
  })
})

describe('the prompt section', () => {
  it('sits directly after the web-search section', () => {
    expect(LITERATURE_PROMPT_ORDER).toBe(111)
  })

  it('states the division of labour and the citation rule', () => {
    expect(LITERATURE_PROMPT_TEXT).toContain('literature_search')
    expect(LITERATURE_PROMPT_TEXT).toContain('web_search')
    expect(LITERATURE_PROMPT_TEXT).toContain('不要编造文献')
    expect(LITERATURE_TOOL).toBe('literature_search')
  })
})

describe('the registered tool', () => {
  /**
   * Register the tool against a minimal composition with a stub runtime.
   * @param result - what the stub search answers.
   * @returns the context and the search calls the tool made.
   */
  async function register(result: LiteratureSearchResult = { records: [record()], total: 1, sourceErrors: [], elapsedMs: 3 }) {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const requests: LiteratureSearchRequest[] = []
    applyLiteratureTool(ctx, {
      search: (request) => {
        requests.push(request)
        return Promise.resolve(result)
      },
    })
    return { ctx, requests }
  }

  it('passes every optional argument through to the service', async () => {
    const { ctx, requests } = await register()

    await ctx.tools.execute({
      callId: CallId('call-1'),
      name: LITERATURE_TOOL,
      arguments: { query: 'n-type SnSe', year_from: 2020, year_to: 2024, limit: 5 },
      signal: new AbortController().signal,
    })

    expect(requests).toEqual([{ query: 'n-type SnSe', yearFrom: 2020, yearTo: 2024, limit: 5 }])
    await ctx.fiber.dispose()
  })

  it('sends only the query when the model named no bounds', async () => {
    const { ctx, requests } = await register()

    await ctx.tools.execute({
      callId: CallId('call-2'),
      name: LITERATURE_TOOL,
      arguments: { query: 'n-type SnSe' },
      signal: new AbortController().signal,
    })

    expect(requests).toEqual([{ query: 'n-type SnSe' }])
    await ctx.fiber.dispose()
  })

  it('titles the pending card with the query and marks it a search', async () => {
    const { ctx } = await register()

    expect(ctx.tools.get(LITERATURE_TOOL)?.presentCall?.({ query: 'n-type SnSe' })).toEqual({
      card: 'generic',
      title: '检索文献：n-type SnSe',
      kind: 'search',
      rawInput: 'n-type SnSe',
    })
    await ctx.fiber.dispose()
  })

  it('completes on the generic card, leaving the rendered list as the body', async () => {
    const { ctx } = await register()

    expect(ctx.tools.get(LITERATURE_TOOL)?.presentResult?.({ query: 'q' }, { content: [], isError: false }))
      .toEqual({ card: 'generic' })
    await ctx.fiber.dispose()
  })

  it('is safe to run beside another call, because it touches no agent state', async () => {
    const { ctx } = await register()

    expect(ctx.tools.get(LITERATURE_TOOL)?.isConcurrencySafe?.({ query: 'q' })).toBe(true)
    await ctx.fiber.dispose()
  })
})
