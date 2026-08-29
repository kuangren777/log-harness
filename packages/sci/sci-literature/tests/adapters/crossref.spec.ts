// The Crossref mapper against the recorded reply, including the JATS abstract
// and the `[null]` date the API returns for an undated registration.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CROSSREF_ENDPOINT,
  crossrefAuthorName,
  crossrefPdfUrl,
  crossrefUrl,
  crossrefYear,
  mapCrossref,
  search,
} from '@deepseek-ai/dsh-sci-literature/src/adapters/crossref.ts'
import type { LiteratureAdapterOptions } from '@deepseek-ai/dsh-sci-literature'
import { stubFetch } from '../fetch-stub.ts'
import { jsonFixture } from '../fixtures.ts'

const OPTIONS: LiteratureAdapterOptions = {
  mailto: 'sci@example.org',
  userAgent: 'camel-science/0.1 (+https://sci.camelco.de)',
  maxPerSource: 15,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('mapCrossref', () => {
  const records = mapCrossref(jsonFixture('crossref.json'))

  it('maps every work in the recorded reply', () => {
    expect(records).toHaveLength(5)
    expect(records[2]).toMatchObject({
      id: 'doi:10.1063/1.4907805',
      title: 'Quasiparticle band structures and thermoelectric transport properties of p-type SnSe',
      authors: ['Shi, Guangsha', 'Kioupakis, Emmanouil'],
      year: 2015,
      venue: 'Journal of Applied Physics',
      doi: '10.1063/1.4907805',
      url: 'https://doi.org/10.1063/1.4907805',
      citedBy: 159,
      source: 'crossref',
      sources: ['crossref'],
    })
    expect(records[2]?.abstract).toContain('density functional')
    expect(records[2]?.pdfUrl).toContain('.pdf')
  })

  it('strips the JATS markup out of the abstract', () => {
    expect(records[0]?.abstract).not.toContain('<')
  })

  it.each([
    ['a reply with no message', {}],
    ['an item that is not an object', { message: { items: [0] } }],
    ['an item with no title', { message: { items: [{ DOI: '10.1/a' }] } }],
    ['an item with no DOI', { message: { items: [{ title: ['A'] }] } }],
  ])('drops %s', (_case, payload) => {
    expect(mapCrossref(payload)).toEqual([])
  })

  it('falls back to the doi.org url when the item carries no URL', () => {
    expect(mapCrossref({ message: { items: [{ title: ['A'], DOI: '10.1/a' }] } })[0]?.url).toBe('https://doi.org/10.1/a')
  })
})

describe('crossrefAuthorName', () => {
  it.each([
    ['a family and given name', { family: 'Shi', given: 'Guangsha' }, 'Shi, Guangsha'],
    ['a family name alone', { family: 'Shi' }, 'Shi'],
    ['an organization name', { name: 'CERN' }, 'CERN'],
    ['a given name alone', { given: 'Guangsha' }, 'Guangsha'],
    ['nothing at all', {}, ''],
    ['an entry that is not an object', 'Shi', ''],
  ])('names %s', (_case, entry, expected) => {
    expect(crossrefAuthorName(entry)).toBe(expected)
  })
})

describe('crossrefYear', () => {
  it.each([
    ['a full date', { 'date-parts': [[2015, 2, 1]] }, 2015],
    ['the undated registration form', { 'date-parts': [[null]] }, undefined],
    ['an absent node', undefined, undefined],
  ])('reads %s', (_case, issued, expected) => {
    expect(crossrefYear(issued)).toBe(expected)
  })
})

describe('crossrefPdfUrl', () => {
  it('takes the first pdf link', () => {
    expect(crossrefPdfUrl([
      { URL: 'https://x.test/a.xml', 'content-type': 'application/xml' },
      { URL: 'https://x.test/a.pdf', 'content-type': 'application/pdf' },
    ])).toBe('https://x.test/a.pdf')
  })

  it.each([
    ['no link list', undefined],
    ['a pdf link with no url', [{ 'content-type': 'application/pdf' }]],
    ['only non-pdf links', [{ URL: 'https://x.test/a.xml', 'content-type': 'application/xml' }]],
  ])('answers undefined for %s', (_case, links) => {
    expect(crossrefPdfUrl(links)).toBeUndefined()
  })
})

describe('crossrefUrl', () => {
  it('restricts the query to journal articles', () => {
    expect(new URL(crossrefUrl({ query: 'q' }, OPTIONS)).searchParams.get('filter')).toBe('type:journal-article')
  })

  it.each([
    [{ yearFrom: 2020, yearTo: 2024 }, 'type:journal-article,from-pub-date:2020-01-01,until-pub-date:2024-12-31'],
    [{ yearFrom: 2020 }, 'type:journal-article,from-pub-date:2020-01-01'],
    [{ yearTo: 2024 }, 'type:journal-article,until-pub-date:2024-12-31'],
  ])('bounds the publication date for %o', (bounds, expected) => {
    expect(new URL(crossrefUrl({ query: 'q', ...bounds }, OPTIONS)).searchParams.get('filter')).toBe(expected)
  })
})

describe('search', () => {
  it('maps what the endpoint returned', async () => {
    stubFetch(() => Promise.resolve(
      new Response(JSON.stringify({ message: { items: [{ title: ['A'], DOI: '10.1/a' }] } })),
    ))

    const records = await search({ query: 'q' }, OPTIONS, AbortSignal.timeout(1000))

    expect(records).toMatchObject([{ doi: '10.1/a', source: 'crossref' }])
    expect(CROSSREF_ENDPOINT).toContain('api.crossref.org')
  })
})
