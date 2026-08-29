// The OpenAlex mapper against the recorded reply, including the inverted-index
// abstract rebuild that is unique to this source.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENALEX_ENDPOINT,
  mapOpenAlex,
  openAlexUrl,
  rebuildAbstract,
  search,
} from '@deepseek-ai/dsh-sci-literature/src/adapters/openalex.ts'
import type { LiteratureAdapterOptions } from '@deepseek-ai/dsh-sci-literature'
import { stubFetch } from '../fetch-stub.ts'
import { jsonFixture } from '../fixtures.ts'

const OPTIONS: LiteratureAdapterOptions = {
  mailto: 'sci@example.org',
  userAgent: 'camel-science/0.1 (+https://sci.camelco.de)',
  maxPerSource: 15,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('mapOpenAlex', () => {
  const records = mapOpenAlex(jsonFixture('openalex.json'))

  it('maps every work in the recorded reply', () => {
    expect(records).toHaveLength(4)
    expect(records[0]).toMatchObject({
      id: 'doi:10.1016/j.xcrp.2020.100263',
      title: 'High-Performance n-type SnSe Thermoelectric Polycrystal Prepared by Arc-Melting',
      year: 2020,
      venue: 'Cell Reports Physical Science',
      doi: '10.1016/j.xcrp.2020.100263',
      url: 'https://doi.org/10.1016/j.xcrp.2020.100263',
      pdfUrl: 'https://www.sciencedirect.com/science/article/pii/S266638642030285X/pdf',
      citedBy: 41,
      source: 'openalex',
      sources: ['openalex'],
    })
    expect(records[0]?.authors).toEqual(expect.arrayContaining(['Javier Gainza', 'N. M. Nemes']))
    expect(records[0]?.abstract).toContain('Tin selenide (SnSe) has notable thermoelectric properties')
  })

  it('leaves pdfUrl unset for a work that is not open access', () => {
    const closed = records.find(record => record.doi === '10.1063/1.4942890')
    expect(closed?.pdfUrl).toBeUndefined()
    expect(closed?.citedBy).toBe(126)
  })

  it('caps the author list at twenty names', () => {
    expect(records.every(record => record.authors.length <= 20)).toBe(true)
  })

  it.each([
    ['a reply that is not an object', 'nope'],
    ['a reply with no results array', { meta: {} }],
    ['a results entry that is not an object', { results: [7] }],
    ['a work with no title', { results: [{ doi: '10.1/x' }] }],
    ['a work whose title is only markup', { results: [{ title: '<i></i>' }] }],
  ])('drops %s', (_case, payload) => {
    expect(mapOpenAlex(payload)).toEqual([])
  })

  it('falls back to the landing page, then the work id, when there is no DOI', () => {
    expect(mapOpenAlex({ results: [{ title: 'A', primary_location: { landing_page_url: 'https://x.test/a' } }] })[0]?.url)
      .toBe('https://x.test/a')
    expect(mapOpenAlex({ results: [{ title: 'A', id: 'https://openalex.org/W1' }] })[0]?.url)
      .toBe('https://openalex.org/W1')
    expect(mapOpenAlex({ results: [{ title: 'A' }] })[0]?.url).toBe(OPENALEX_ENDPOINT)
  })

  it('reads the DOI out of the ids block when the top-level field is absent', () => {
    expect(mapOpenAlex({ results: [{ title: 'A', ids: { doi: 'https://doi.org/10.1/Y', arxiv: 'arXiv:2401.01234v2' } }] })[0])
      .toMatchObject({ doi: '10.1/y', arxivId: '2401.01234' })
  })

  it('names the raw author when the authorship carries no resolved author', () => {
    expect(mapOpenAlex({ results: [{ title: 'A', authorships: [{ raw_author_name: 'Doe, J.' }, {}] }] })[0]?.authors)
      .toEqual(['Doe, J.'])
  })

  it('prefers the primary location pdf when open access carries no url', () => {
    expect(mapOpenAlex({
      results: [{ title: 'A', open_access: { is_oa: true }, primary_location: { pdf_url: 'https://x.test/a.pdf' } }],
    })[0]?.pdfUrl).toBe('https://x.test/a.pdf')
  })
})

describe('rebuildAbstract', () => {
  it('puts the words back in position order', () => {
    expect(rebuildAbstract({ Tin: [0], selenide: [1], is: [2, 4], hot: [3] })).toBe('Tin selenide is hot is')
  })

  it.each([
    ['an absent index', undefined],
    ['an index that is not an object', ['a']],
    ['an index whose positions are not arrays', { a: 1 }],
    ['an index whose positions are not integers', { a: ['x'] }],
  ])('answers undefined for %s', (_case, inverted) => {
    expect(rebuildAbstract(inverted)).toBeUndefined()
  })
})

describe('openAlexUrl', () => {
  it('sends the query, page size, select list, and mailto', () => {
    const url = new URL(openAlexUrl({ query: 'n-type SnSe' }, OPTIONS))
    expect(url.origin + url.pathname).toBe(OPENALEX_ENDPOINT)
    expect(url.searchParams.get('search')).toBe('n-type SnSe')
    expect(url.searchParams.get('per-page')).toBe('15')
    expect(url.searchParams.get('mailto')).toBe('sci@example.org')
    expect(url.searchParams.get('filter')).toBeNull()
  })

  it('omits the mailto when the deployment configured none', () => {
    expect(openAlexUrl({ query: 'q' }, { ...OPTIONS, mailto: '' })).not.toContain('mailto')
  })

  it.each([
    [{ yearFrom: 2020, yearTo: 2024 }, 'publication_year:2020-2024'],
    [{ yearFrom: 2020 }, 'publication_year:2020-9999'],
    [{ yearTo: 2024 }, 'publication_year:1000-2024'],
  ])('bounds the publication year for %o', (bounds, expected) => {
    expect(new URL(openAlexUrl({ query: 'q', ...bounds }, OPTIONS)).searchParams.get('filter')).toBe(expected)
  })
})

describe('search', () => {
  it('maps what the endpoint returned', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ results: [{ title: 'A', doi: '10.1/a' }] }))))

    const records = await search({ query: 'q' }, OPTIONS, AbortSignal.timeout(1000))

    expect(records).toHaveLength(1)
    expect(records[0]?.doi).toBe('10.1/a')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('api.openalex.org')
  })
})
