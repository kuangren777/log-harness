// The whole of the library's search is here: no embedding provider exists in
// this repo, so what "find my paper on SnSe" means is exactly what these
// weights say it means.
import { describe, expect, it } from 'vitest'
import {
  ABSTRACT_WEIGHT,
  compareText,
  AUTHOR_WEIGHT,
  SCORED_ABSTRACT_CHARS,
  TAG_WEIGHT,
  TITLE_WEIGHT,
  entryTerms,
  overlap,
  queryTerms,
  rankEntries,
  relatedEntries,
  scoreEntry,
  sortByRecency,
  tokenize,
} from '../src/score.ts'
import { entry, T0 } from './fixtures.ts'

describe('tokenize', () => {
  it('lowercases and splits on everything that is not a letter or digit', () => {
    expect(tokenize('N-type SnSe: thermo_electric (2015)')).toEqual(['n', 'type', 'snse', 'thermo', 'electric', '2015'])
  })

  it('keeps non-Latin script rather than dropping it', () => {
    expect(tokenize('热电材料 SnSe')).toEqual(['热电材料', 'snse'])
  })

  it('yields nothing for text with no terms', () => {
    expect(tokenize('   --- ')).toEqual([])
  })
})

describe('overlap', () => {
  it('counts every field position a query term matched, not distinct terms', () => {
    expect(overlap(['snse', 'snse', 'other'], new Set(['snse']))).toBe(2)
  })

  it('is zero when nothing matches', () => {
    expect(overlap(['a'], new Set(['b']))).toBe(0)
  })
})

describe('entryTerms', () => {
  it('reads all four weighted fields', () => {
    const terms = entryTerms(entry({
      title: 'SnSe crystals',
      tags: ['thermo-electric'],
      abstract: 'A record ZT',
      authors: ['Zhao, Li-Dong'],
    }))

    expect(terms).toEqual({
      title: ['snse', 'crystals'],
      tags: ['thermo', 'electric'],
      abstract: ['a', 'record', 'zt'],
      authors: ['zhao', 'li', 'dong'],
    })
  })

  it('reads a bounded prefix of the abstract so length cannot outweigh a title', () => {
    const terms = entryTerms(entry({ abstract: `${'x '.repeat(SCORED_ABSTRACT_CHARS)}snse` }))

    expect(terms.abstract).not.toContain('snse')
  })

  it('treats an absent abstract as no terms', () => {
    expect(entryTerms(entry()).abstract).toEqual([])
  })
})

describe('scoreEntry', () => {
  it('weights a title hit above a tag hit above an abstract or author hit', () => {
    const query = new Set(['snse'])

    expect(scoreEntry(entry({ title: 'snse', tags: [], abstract: undefined, authors: [] }), query)).toBe(TITLE_WEIGHT)
    expect(scoreEntry(entry({ title: 'x', tags: ['snse'], abstract: undefined, authors: [] }), query)).toBe(TAG_WEIGHT)
    expect(scoreEntry(entry({ title: 'x', tags: [], abstract: 'snse', authors: [] }), query)).toBe(ABSTRACT_WEIGHT)
    expect(scoreEntry(entry({ title: 'x', tags: [], abstract: undefined, authors: ['snse'] }), query)).toBe(AUTHOR_WEIGHT)
  })

  it('sums the weighted fields', () => {
    const scored = scoreEntry(
      entry({ title: 'snse', tags: ['snse'], abstract: 'snse', authors: ['snse'] }),
      new Set(['snse']),
    )

    expect(scored).toBe(TITLE_WEIGHT + TAG_WEIGHT + ABSTRACT_WEIGHT + AUTHOR_WEIGHT)
  })

  it('scores zero for an empty query rather than matching everything', () => {
    expect(scoreEntry(entry(), new Set())).toBe(0)
  })
})

describe('queryTerms', () => {
  it('de-duplicates, so repeating a word does not multiply its weight', () => {
    expect([...queryTerms('snse SnSe snse')]).toEqual(['snse'])
  })
})

describe('compareText', () => {
  it('is a total order, so every tie-break in the package is decided the same way', () => {
    expect(compareText('a', 'b')).toBe(-1)
    expect(compareText('b', 'a')).toBe(1)
    expect(compareText('a', 'a')).toBe(0)
  })
})

describe('rankEntries', () => {
  it('drops every entry no term matched', () => {
    const hits = rankEntries([entry({ id: 'a', title: 'snse' }), entry({ id: 'b', title: 'graphene' })], 'snse')

    expect(hits.map(hit => hit.id)).toEqual(['a'])
  })

  it('orders by score, then by recency, then by id', () => {
    const hits = rankEntries([
      entry({ id: 'low', title: 'snse crystal', tags: [] }),
      entry({ id: 'tie-b', title: 'snse', tags: ['snse'], updatedAt: T0 }),
      entry({ id: 'tie-a', title: 'snse', tags: ['snse'], updatedAt: T0 }),
      entry({ id: 'newer', title: 'snse', tags: ['snse'], updatedAt: T0 + 1 }),
    ], 'snse')

    expect(hits.map(hit => hit.id)).toEqual(['newer', 'tie-a', 'tie-b', 'low'])
  })

  it('matches nothing for a query with no terms', () => {
    expect(rankEntries([entry()], '---')).toEqual([])
  })
})

describe('sortByRecency', () => {
  it('orders newest-updated first and breaks ties by id', () => {
    const ordered = sortByRecency([
      entry({ id: 'b', updatedAt: T0 }),
      entry({ id: 'a', updatedAt: T0 }),
      entry({ id: 'c', updatedAt: T0 + 5 }),
    ])

    expect(ordered.map(row => row.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('relatedEntries', () => {
  it('scores neighbours on the subject title and abstract and excludes the subject', () => {
    const subject = entry({ id: 'subject', title: 'SnSe thermoelectric', abstract: 'record ZT' })
    const neighbours = relatedEntries(subject, [
      subject,
      entry({ id: 'close', title: 'SnSe crystals' }),
      entry({ id: 'far', title: 'graphene' }),
    ], 3)

    expect(neighbours.map(row => row.id)).toEqual(['close'])
  })

  it('does not use the subject tags, so one shared tag is not a relation', () => {
    const subject = entry({ id: 'subject', title: 'alpha', tags: ['reading-list'] })
    const neighbours = relatedEntries(subject, [subject, entry({ id: 'other', title: 'beta', tags: ['reading-list'] })], 3)

    expect(neighbours).toEqual([])
  })

  it('truncates to the limit', () => {
    const subject = entry({ id: 'subject', title: 'snse' })
    const neighbours = relatedEntries(subject, [
      subject,
      entry({ id: 'a', title: 'snse', updatedAt: T0 + 3 }),
      entry({ id: 'b', title: 'snse', updatedAt: T0 + 2 }),
      entry({ id: 'c', title: 'snse', updatedAt: T0 + 1 }),
    ], 2)

    expect(neighbours.map(row => row.id)).toEqual(['a', 'b'])
  })
})
