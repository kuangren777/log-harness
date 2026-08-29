// The hand-written Atom reader against the recorded feed. arXiv is the only
// source with no JSON, so this is the one place a parsing regression could
// silently return nothing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARXIV_ENDPOINT,
  arxivSearchQuery,
  arxivUrl,
  captured,
  decodeEntities,
  elementText,
  elementTexts,
  mapArxiv,
  pdfLink,
  search,
} from '@deepseek-ai/dsh-sci-literature/src/adapters/arxiv.ts'
import type { LiteratureAdapterOptions } from '@deepseek-ai/dsh-sci-literature'
import { stubFetch } from '../fetch-stub.ts'
import { fixture } from '../fixtures.ts'

const OPTIONS: LiteratureAdapterOptions = {
  mailto: '',
  userAgent: 'camel-science/0.1 (+https://sci.camelco.de)',
  maxPerSource: 15,
}

const FEED = fixture('arxiv.xml')

afterEach(() => { vi.unstubAllGlobals() })

describe('mapArxiv', () => {
  const records = mapArxiv(FEED)

  it('maps every entry in the recorded feed', () => {
    expect(records).toHaveLength(5)
    expect(records[0]).toMatchObject({
      id: 'arxiv:1601.00753',
      title: 'n-type SnSe$_{1-x}$ for Thermoelectric Application',
      authors: ['Tutul Bera', 'Anup V. Sanchela', 'C. V. Tomy', 'Ajay D. Thakur'],
      year: 2016,
      arxivId: '1601.00753',
      url: 'https://arxiv.org/abs/1601.00753',
      pdfUrl: 'https://arxiv.org/pdf/1601.00753v2',
      source: 'arxiv',
      sources: ['arxiv'],
    })
    expect(records[0]?.abstract).toContain('We report the synthesis of n-type SnSe')
  })

  it('reads the published DOI and journal reference when the entry carries them', () => {
    expect(records[1]).toMatchObject({ doi: '10.1103/physrevb.91.205201', arxivId: '1502.04599' })
    expect(records[2]?.venue).toBe('Scripta Materialia 223, 115081 (2023)')
  })

  it('keys the record by DOI once the preprint was published', () => {
    expect(records[1]?.id).toBe('doi:10.1103/physrevb.91.205201')
  })

  it.each([
    ['a feed with no entries', '<feed></feed>'],
    ['an entry with no title', '<entry><id>http://arxiv.org/abs/2401.01234v1</id></entry>'],
    ['an entry with no id', '<entry><title>A</title></entry>'],
    ['an entry whose id is not an arXiv identifier', '<entry><title>A</title><id>urn:x</id></entry>'],
  ])('drops %s', (_case, xml) => {
    expect(mapArxiv(xml)).toEqual([])
  })

  it('leaves the year unset for an unparseable published date', () => {
    expect(mapArxiv('<entry><title>A</title><id>http://arxiv.org/abs/2401.01234v1</id><published>soon</published></entry>')[0]?.year)
      .toBeUndefined()
  })

  it('leaves the year unset when the entry carries no published date', () => {
    expect(mapArxiv('<entry><title>A</title><id>http://arxiv.org/abs/2401.01234v1</id></entry>')[0])
      .toMatchObject({ arxivId: '2401.01234', url: 'https://arxiv.org/abs/2401.01234' })
  })
})

describe('captured', () => {
  it('answers the first group of a match', () => {
    expect(captured(/<a>(.*)<\/a>/.exec('<a>x</a>') ?? [])).toBe('x')
  })

  it('answers empty for a match with no group, which no pattern here produces', () => {
    expect(captured([])).toBe('')
  })
})

describe('decodeEntities', () => {
  it.each([
    ['named entities', 'a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;', 'a & b <c> "d" \'e\''],
    ['a decimal reference', '&#8212;', '—'],
    ['a hexadecimal reference', '&#x2014;', '—'],
    ['an unknown named entity', '&nbsp;', '&nbsp;'],
    ['an out-of-range code point', '&#x110000;', '&#x110000;'],
  ])('decodes %s', (_case, input, expected) => {
    expect(decodeEntities(input)).toBe(expected)
  })
})

describe('elementText', () => {
  it('reads the first matching element and decodes it', () => {
    expect(elementText('<a><b>x &amp; y</b><b>z</b></a>', 'b')).toBe('x & y')
  })

  it('reads an element that carries attributes', () => {
    expect(elementText('<b type="html">x</b>', 'b')).toBe('x')
  })

  it.each([
    ['an absent element', '<a></a>'],
    ['an empty element', '<a><b>  </b></a>'],
  ])('answers undefined for %s', (_case, xml) => {
    expect(elementText(xml, 'b')).toBeUndefined()
  })
})

describe('elementTexts', () => {
  it('reads every occurrence and drops the empty ones', () => {
    expect(elementTexts('<a><b>x</b><b> </b><b>y</b></a>', 'b')).toEqual(['x', 'y'])
  })
})

describe('pdfLink', () => {
  it('takes the href of the link titled pdf', () => {
    expect(pdfLink('<link href="https://x.test/a" rel="alternate"/><link title="pdf" href="https://x.test/a.pdf"/>'))
      .toBe('https://x.test/a.pdf')
  })

  it.each([
    ['a feed with no pdf link', '<link href="https://x.test/a" rel="alternate"/>'],
    ['a pdf link with no href', '<link title="pdf"/>'],
  ])('answers undefined for %s', (_case, xml) => {
    expect(pdfLink(xml)).toBeUndefined()
  })
})

describe('arxivSearchQuery', () => {
  it('ANDs every term, because bare whitespace means OR to arXiv', () => {
    expect(arxivSearchQuery('n-type SnSe thermoelectric'))
      .toBe('all:n-type AND all:SnSe AND all:thermoelectric')
  })

  it('collapses repeated whitespace', () => {
    expect(arxivSearchQuery('  a   b ')).toBe('all:a AND all:b')
  })
})

describe('arxivUrl', () => {
  it('sends the ANDed query, the result cap, and relevance ordering', () => {
    const url = new URL(arxivUrl({ query: 'n-type SnSe' }, OPTIONS))
    expect(url.origin + url.pathname).toBe(ARXIV_ENDPOINT)
    expect(url.searchParams.get('search_query')).toBe('all:n-type AND all:SnSe')
    expect(url.searchParams.get('max_results')).toBe('15')
    expect(url.searchParams.get('sortBy')).toBe('relevance')
  })
})

describe('search', () => {
  it('applies the year bounds the endpoint cannot express', async () => {
    stubFetch(() => Promise.resolve(new Response(FEED)))

    await expect(search({ query: 'q', yearFrom: 2016, yearTo: 2016 }, OPTIONS, AbortSignal.timeout(1000)))
      .resolves.toMatchObject([{ arxivId: '1601.00753' }])
  })

  it('keeps every entry when the request bounds no year', async () => {
    stubFetch(() => Promise.resolve(new Response(FEED)))

    await expect(search({ query: 'q' }, OPTIONS, AbortSignal.timeout(1000))).resolves.toHaveLength(5)
  })

  it('drops an undated entry from a bounded search', async () => {
    stubFetch(() => Promise.resolve(
      new Response('<entry><title>A</title><id>http://arxiv.org/abs/2401.01234v1</id></entry>'),
    ))

    await expect(search({ query: 'q', yearFrom: 2020 }, OPTIONS, AbortSignal.timeout(1000))).resolves.toEqual([])
  })
})
