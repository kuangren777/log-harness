// The Semantic Scholar mapper against the recorded reply, and the optional key
// that only changes a header.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SEMANTIC_SCHOLAR_ENDPOINT,
  mapSemanticScholar,
  search,
  semanticScholarUrl,
} from '@deepseek-ai/dsh-sci-literature/src/adapters/semanticscholar.ts'
import type { LiteratureAdapterOptions } from '@deepseek-ai/dsh-sci-literature'
import { headersOf, stubFetch } from '../fetch-stub.ts'
import { jsonFixture } from '../fixtures.ts'

const OPTIONS: LiteratureAdapterOptions = {
  mailto: '',
  userAgent: 'camel-science/0.1 (+https://sci.camelco.de)',
  maxPerSource: 15,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('mapSemanticScholar', () => {
  const records = mapSemanticScholar(jsonFixture('semanticscholar.json'))

  it('maps every paper in the recorded reply', () => {
    expect(records).toHaveLength(5)
    expect(records[0]).toMatchObject({
      id: 'doi:10.1002/adma.202506999',
      year: 2025,
      venue: 'Advances in Materials',
      doi: '10.1002/adma.202506999',
      url: 'https://doi.org/10.1002/adma.202506999',
      citedBy: 24,
      source: 'semanticscholar',
      sources: ['semanticscholar'],
    })
    expect(records[0]?.title).toContain('Resonant Levels Induced Seebeck Coefficient Matching')
    expect(records[0]?.authors).toEqual(expect.arrayContaining(['Dongrui Liu', 'Lidong Zhao']))
    expect(records[0]?.abstract).toEqual(expect.any(String))
  })

  it('leaves pdfUrl unset when the source reports an empty open-access url', () => {
    // The recorded reply carries `openAccessPdf: { url: '' }` for the closed
    // works: an empty string is no value, not a link to nowhere.
    expect(records[0]?.pdfUrl).toBeUndefined()
    expect(records[1]?.pdfUrl).toBe('https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/advs.202411594')
  })

  it.each([
    ['a reply with no data array', {}],
    ['a data entry that is not an object', { data: ['x'] }],
    ['a paper with no title', { data: [{ paperId: 'x' }] }],
  ])('drops %s', (_case, payload) => {
    expect(mapSemanticScholar(payload)).toEqual([])
  })

  it('falls back to the paper url, then to an arXiv landing page, when there is no DOI', () => {
    expect(mapSemanticScholar({ data: [{ title: 'A', url: 'https://s2.test/a' }] })[0]?.url).toBe('https://s2.test/a')
    expect(mapSemanticScholar({ data: [{ title: 'A', externalIds: { ArXiv: '2401.01234' } }] })[0])
      .toMatchObject({ arxivId: '2401.01234', url: 'https://arxiv.org/abs/2401.01234' })
    expect(mapSemanticScholar({ data: [{ title: 'A' }] })[0]?.url).toBe(SEMANTIC_SCHOLAR_ENDPOINT)
  })

  it('drops an author entry that names nobody', () => {
    expect(mapSemanticScholar({ data: [{ title: 'A', authors: [{ name: 'Doe, J.' }, { authorId: '1' }] }] })[0]?.authors)
      .toEqual(['Doe, J.'])
  })
})

describe('semanticScholarUrl', () => {
  it('sends the query, limit, and field list', () => {
    const url = new URL(semanticScholarUrl({ query: 'n-type SnSe' }, OPTIONS))
    expect(url.origin + url.pathname).toBe(SEMANTIC_SCHOLAR_ENDPOINT)
    expect(url.searchParams.get('limit')).toBe('15')
    expect(url.searchParams.get('year')).toBeNull()
  })

  it.each([
    [{ yearFrom: 2020, yearTo: 2024 }, '2020-2024'],
    [{ yearFrom: 2020 }, '2020-'],
    [{ yearTo: 2024 }, '-2024'],
  ])('bounds the year for %o', (bounds, expected) => {
    expect(new URL(semanticScholarUrl({ query: 'q', ...bounds }, OPTIONS)).searchParams.get('year')).toBe(expected)
  })
})

describe('search', () => {
  /**
   * Capture the headers one search sent.
   * @param options - the adapter options under test.
   * @returns the request headers.
   */
  async function requestHeaders(options: LiteratureAdapterOptions): Promise<Headers> {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }))))
    await search({ query: 'q' }, options, AbortSignal.timeout(1000))
    return headersOf(fetchMock, 'semanticscholar')
  }

  it('sends no key header when the deployment resolved none', async () => {
    expect((await requestHeaders(OPTIONS)).get('x-api-key')).toBeNull()
  })

  it('sends the key header when one was resolved', async () => {
    expect((await requestHeaders({ ...OPTIONS, apiKey: 's2-key' })).get('x-api-key')).toBe('s2-key')
  })
})
