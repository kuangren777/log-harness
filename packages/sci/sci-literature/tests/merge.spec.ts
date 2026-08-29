// Identity, cross-source merging, and ranking. The cross-source case is taken
// from the recorded replies themselves: OpenAlex and arXiv both return
// Kutorasinski et al., one as a published article and one as the preprint.
import { describe, expect, it } from 'vitest'
import {
  CITATION_WEIGHT,
  MAX_ABSTRACT_CHARS,
  MAX_AUTHORS,
  SOURCE_PRIORITY,
  cleanTitle,
  clampAbstract,
  clampAuthors,
  dedupeKey,
  dedupeKeys,
  identify,
  mapArxiv,
  mapOpenAlex,
  mergeRecordPair,
  mergeRecords,
  normalizeArxivId,
  normalizeDoi,
  normalizeTitle,
  rankRecords,
} from '@deepseek-ai/dsh-sci-literature'
import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature'
import { fixture, jsonFixture } from './fixtures.ts'

/**
 * Build one record for a merge case.
 * @param overrides - the fields this case cares about.
 * @returns the record, identified from its own fields.
 */
function record(overrides: Partial<Omit<LiteratureRecord, 'id'>>): LiteratureRecord {
  return identify({
    title: 'A study of nothing',
    authors: [],
    url: 'https://x.test/a',
    source: 'openalex',
    sources: ['openalex'],
    ...overrides,
  })
}

describe('normalizeTitle', () => {
  it.each([
    ['punctuation and case', 'N-type SnSe: a Study!', 'ntypesnseastudy'],
    ['compatibility forms', 'p‐type SnSe', 'ptypesnse'],
    ['a title with no letters or digits', '!!!', ''],
  ])('collapses %s', (_case, title, expected) => {
    expect(normalizeTitle(title)).toBe(expected)
  })
})

describe('dedupeKeys', () => {
  it('orders DOI, arXiv id, then title', () => {
    const keys = dedupeKeys(record({ doi: '10.1/a', arxivId: '2401.01234' }))
    expect(keys[0]).toBe('doi:10.1/a')
    expect(keys[1]).toBe('arxiv:2401.01234')
    expect(keys[2]).toMatch(/^title:[0-9a-f]{40}$/)
  })

  it('always yields a title key, even for a title that normalizes to nothing', () => {
    expect(dedupeKeys(record({ title: '!!!' }))).toHaveLength(1)
    expect(dedupeKey(record({ title: '!!!' }))).toMatch(/^title:[0-9a-f]{40}$/)
  })

  it('keys two spellings of one title the same way', () => {
    expect(dedupeKey(record({ title: 'N-type SnSe' }))).toBe(dedupeKey(record({ title: 'n type snse' })))
  })
})

describe('identify', () => {
  it('assigns the strongest key as the record id', () => {
    expect(identify({ ...record({}), doi: '10.1/a' }).id).toBe('doi:10.1/a')
  })
})

describe('mergeRecordPair', () => {
  it('fills absent fields from the weaker record and takes the larger citation count', () => {
    const merged = mergeRecordPair(
      record({ doi: '10.1/a', citedBy: 5, source: 'openalex', sources: ['openalex'] }),
      record({ doi: '10.1/a', venue: 'Nature', year: 2020, citedBy: 9, source: 'crossref', sources: ['crossref'] }),
    )
    expect(merged).toMatchObject({ venue: 'Nature', year: 2020, citedBy: 9, source: 'openalex' })
    expect(merged.sources).toEqual(['openalex', 'crossref'])
  })

  it('labels the merged record with the higher-priority source, whichever arrived first', () => {
    const arxivFirst = record({ doi: '10.1/a', source: 'arxiv', sources: ['arxiv'], venue: 'preprint' })
    const openAlex = record({ doi: '10.1/a', source: 'openalex', sources: ['openalex'] })
    expect(mergeRecordPair(arxivFirst, openAlex).source).toBe('openalex')
    expect(mergeRecordPair(openAlex, arxivFirst).source).toBe('openalex')
    // The weaker record still contributes the fields the stronger one lacks.
    expect(mergeRecordPair(openAlex, arxivFirst).venue).toBe('preprint')
  })

  it('keeps the longer author list', () => {
    const merged = mergeRecordPair(
      record({ doi: '10.1/a', authors: ['Shi, G.'], source: 'arxiv', sources: ['arxiv'] }),
      record({ doi: '10.1/a', authors: ['Shi, G.', 'Kioupakis, E.'], source: 'crossref', sources: ['crossref'] }),
    )
    expect(merged.authors).toEqual(['Shi, G.', 'Kioupakis, E.'])
  })

  it('keeps the longer author list even when the weaker source holds it', () => {
    // OpenAlex wins the `source` label but truncated the author list; the
    // preprint has the full one, and a truncated author list is not a fact.
    const merged = mergeRecordPair(
      record({ doi: '10.1/a', authors: ['Shi, G.'], source: 'openalex', sources: ['openalex'] }),
      record({ doi: '10.1/a', authors: ['Shi, G.', 'Kioupakis, E.'], source: 'arxiv', sources: ['arxiv'] }),
    )
    expect(merged).toMatchObject({ source: 'openalex', authors: ['Shi, G.', 'Kioupakis, E.'] })
  })

  it('carries every optional field the pair holds', () => {
    const merged = mergeRecordPair(
      record({ arxivId: '2401.01234', abstract: 'a', source: 'arxiv', sources: ['arxiv'] }),
      record({ arxivId: '2401.01234', doi: '10.1/a', pdfUrl: 'https://x.test/a.pdf', source: 'crossref', sources: ['crossref'] }),
    )
    expect(merged).toMatchObject({ abstract: 'a', doi: '10.1/a', pdfUrl: 'https://x.test/a.pdf' })
    // The pair gained a DOI, so the merged record is re-keyed by it.
    expect(merged.id).toBe('doi:10.1/a')
  })

  it('leaves the citation count unset when neither record reported one', () => {
    expect(mergeRecordPair(record({ doi: '10.1/a' }), record({ doi: '10.1/a' })).citedBy).toBeUndefined()
  })

  it('does not repeat a source both records already list', () => {
    const both = record({ doi: '10.1/a', sources: ['openalex', 'crossref'] })
    expect(mergeRecordPair(both, both).sources).toEqual(['openalex', 'crossref'])
  })
})

describe('mergeRecords', () => {
  it('merges the published article and its preprint from the recorded replies', () => {
    const openAlex = mapOpenAlex(jsonFixture('openalex.json'))
    const arxiv = mapArxiv(fixture('arxiv.xml'))
    const merged = mergeRecords([openAlex, arxiv])

    const kutorasinski = merged.find(candidate => candidate.record.doi === '10.1103/physrevb.91.205201')
    expect(kutorasinski?.record.sources).toEqual(['openalex', 'arxiv'])
    expect(kutorasinski?.record.source).toBe('openalex')
    // OpenAlex has the citation count and the venue; arXiv contributes the id.
    expect(kutorasinski?.record).toMatchObject({ venue: 'Physical Review B', citedBy: 177, arxivId: '1502.04599' })
    expect(merged).toHaveLength(openAlex.length + arxiv.length - 1)
  })

  it.each([
    ['a shared DOI', { doi: '10.1/a', title: 'One' }, { doi: '10.1/a', title: 'Two' }],
    ['a shared arXiv id', { arxivId: '2401.01234', title: 'One' }, { arxivId: '2401.01234', title: 'Two' }],
    ['a normalized title', { title: 'N-type SnSe!' }, { title: 'n type snse' }],
  ])('merges two records on %s', (_case, first, second) => {
    expect(mergeRecords([
      [record({ ...first, source: 'openalex', sources: ['openalex'] })],
      [record({ ...second, source: 'crossref', sources: ['crossref'] })],
    ])).toHaveLength(1)
  })

  it('recognizes a record by a key the group only gained on merge', () => {
    // arXiv returns the preprint with no DOI; OpenAlex returns it with one.
    // Crossref then returns only the DOI, which the group must already answer to.
    const merged = mergeRecords([
      [record({ arxivId: '2401.01234', title: 'One', source: 'arxiv', sources: ['arxiv'] })],
      [record({ arxivId: '2401.01234', doi: '10.1/a', title: 'One', source: 'openalex', sources: ['openalex'] })],
      [record({ doi: '10.1/a', title: 'Completely different wording', source: 'crossref', sources: ['crossref'] })],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.record.sources).toEqual(['arxiv', 'openalex', 'crossref'])
  })

  it('accumulates one over rank-plus-one for every list a record appeared in', () => {
    const [first, second] = mergeRecords([
      [record({ doi: '10.1/a', title: 'First' }), record({ doi: '10.1/b', title: 'Second' })],
      [record({ doi: '10.1/b', title: 'Second', source: 'crossref', sources: ['crossref'] })],
    ])
    expect(first?.rankScore).toBe(1)
    expect(second?.rankScore).toBeCloseTo(1 / 2 + 1)
  })

  it('merges two records that share nothing but their title', () => {
    // Two sources may describe one work with neither identifier in common; the
    // title key is what still recognizes it, which is why every record has one.
    expect(mergeRecords([
      [record({ title: 'One study' })],
      [record({ title: 'One study', source: 'crossref', sources: ['crossref'] })],
    ])).toHaveLength(1)
  })

  it('merges nothing from an empty fan-out', () => {
    expect(mergeRecords([])).toEqual([])
  })
})

describe('rankRecords', () => {
  it('puts a work several indexes ranked highly above one a single index ranked first', () => {
    const ranked = rankRecords(mergeRecords([
      [record({ doi: '10.1/solo', title: 'Solo' }), record({ doi: '10.1/shared', title: 'Shared' })],
      [record({ doi: '10.1/shared', title: 'Shared', source: 'crossref', sources: ['crossref'] })],
    ]))
    expect(ranked.map(entry => entry.doi)).toEqual(['10.1/shared', '10.1/solo'])
  })

  it('weights citations logarithmically, so agreement across sources still wins', () => {
    // 5000 citations are worth 0.15*log10(5001) = 0.55 — more than a second
    // source ranking a work fourth, and less than a second source ranking it
    // first. That is the trade the formula is stating.
    const ranked = rankRecords([
      { record: record({ doi: '10.1/new', title: 'New', year: 2025 }), rankScore: 2 },
      { record: record({ doi: '10.1/classic', title: 'Classic', citedBy: 5000, year: 1990 }), rankScore: 1 },
    ])
    expect(ranked.map(entry => entry.doi)).toEqual(['10.1/new', '10.1/classic'])
    expect(CITATION_WEIGHT * Math.log10(5001)).toBeGreaterThan(1 / 5)
    expect(CITATION_WEIGHT * Math.log10(5001)).toBeLessThan(1)
  })

  it('lets a heavily cited work overtake one a second source ranked low', () => {
    const ranked = rankRecords([
      { record: record({ doi: '10.1/two-sources', title: 'Two' }), rankScore: 1 + 1 / 10 },
      { record: record({ doi: '10.1/classic', title: 'Classic', citedBy: 5000 }), rankScore: 1 },
    ])
    expect(ranked[0]?.doi).toBe('10.1/classic')
  })

  it('leaves records already in title order alone', () => {
    const ranked = rankRecords([
      { record: record({ doi: '10.1/a', title: 'A', year: 2020 }), rankScore: 1 },
      { record: record({ doi: '10.1/b', title: 'B', year: 2020 }), rankScore: 1 },
      { record: record({ doi: '10.1/c', title: 'B', year: 2020 }), rankScore: 1 },
    ])
    expect(ranked.map(entry => entry.title)).toEqual(['A', 'B', 'B'])
  })

  it('breaks an exact tie by descending year, then by title', () => {
    const ranked = rankRecords([
      { record: record({ doi: '10.1/b', title: 'B', year: 2020 }), rankScore: 1 },
      { record: record({ doi: '10.1/a', title: 'A', year: 2020 }), rankScore: 1 },
      { record: record({ doi: '10.1/c', title: 'C', year: 2024 }), rankScore: 1 },
      { record: record({ doi: '10.1/d', title: 'D' }), rankScore: 1 },
    ])
    expect(ranked.map(entry => entry.title)).toEqual(['C', 'A', 'B', 'D'])
  })
})

describe('clampAuthors', () => {
  it('drops blank names and caps the list', () => {
    const many = Array.from({ length: 30 }, (_value, index) => `A${index}`)
    expect(clampAuthors([' Shi, G. ', '', ...many])).toEqual(['Shi, G.', ...many.slice(0, MAX_AUTHORS - 1)])
  })
})

describe('clampAbstract', () => {
  it('strips markup and collapses whitespace', () => {
    expect(clampAbstract('<jats:p>We  used\ndensity functional</jats:p>')).toBe('We used density functional')
  })

  it('caps the text', () => {
    expect(clampAbstract('a'.repeat(MAX_ABSTRACT_CHARS + 10))).toHaveLength(MAX_ABSTRACT_CHARS)
  })

  it.each([['an empty string', ''], ['markup with no text', '<jats:p> </jats:p>']])('answers undefined for %s', (_case, text) => {
    expect(clampAbstract(text)).toBeUndefined()
  })
})

describe('normalizeDoi', () => {
  it.each([
    ['a bare DOI', '10.1/A', '10.1/a'],
    ['a doi.org url', 'https://doi.org/10.1/a', '10.1/a'],
    ['a dx.doi.org url', 'http://dx.doi.org/10.1/a', '10.1/a'],
    ['a doi: prefix', 'doi:10.1/a', '10.1/a'],
    ['a value that is not a DOI', 'nope', undefined],
    ['an empty string', '', undefined],
  ])('normalizes %s', (_case, doi, expected) => {
    expect(normalizeDoi(doi)).toBe(expected)
  })
})

describe('normalizeArxivId', () => {
  it.each([
    ['a bare id', '2401.01234', '2401.01234'],
    ['a versioned id', '2401.01234v3', '2401.01234'],
    ['an abs url', 'http://arxiv.org/abs/1601.00753v2', '1601.00753'],
    ['an arXiv: prefix', 'arXiv:2401.01234', '2401.01234'],
    ['a legacy identifier', 'cond-mat/0703001', 'cond-mat/0703001'],
    ['a value that is not an identifier', 'nope', undefined],
  ])('normalizes %s', (_case, value, expected) => {
    expect(normalizeArxivId(value)).toBe(expected)
  })
})

describe('cleanTitle', () => {
  it.each([
    ['markup and wrapping', '<i>N-type</i>\n SnSe', 'N-type SnSe'],
    ['a title that is only markup', '<i></i>', undefined],
  ])('cleans %s', (_case, title, expected) => {
    expect(cleanTitle(title)).toBe(expected)
  })
})

describe('SOURCE_PRIORITY', () => {
  it('ranks the indexes by how complete their metadata is', () => {
    expect(SOURCE_PRIORITY).toEqual(['openalex', 'semanticscholar', 'crossref', 'arxiv'])
  })
})
