// The deterministic score, term by term and then as a whole. Table-driven
// because the formula is a published contract: a user reads the number as a
// reason, so every term's weight is pinned rather than described.
import { describe, expect, it } from 'vitest'
import {
  BIB_ONLY_SCORE,
  BIB_SOURCE,
  CITED_BY_CAP,
  CITED_BY_MAX,
  LOW_CONFIDENCE_CEILING,
  NOT_ARXIV_ONLY_POINTS,
  SOURCES_ONE,
  SOURCES_THREE,
  SOURCES_TWO,
  STATUS_LOW_CONFIDENCE,
  STATUS_VERIFIED,
  VENUE_POINTS,
  YEAR_POINTS,
  citedByPoints,
  confidence,
  isArxivOnly,
  isBibOnly,
  sourcePoints,
} from '../src/confidence.ts'

describe('sourcePoints', () => {
  it.each([
    ['no source', [], 0],
    ['one source', ['openalex'], SOURCES_ONE],
    ['two sources', ['openalex', 'crossref'], SOURCES_TWO],
    ['three sources', ['openalex', 'crossref', 'arxiv'], SOURCES_THREE],
    ['four sources, capped at the three-source award', ['a', 'b', 'c', 'd'], SOURCES_THREE],
  ])('awards %s', (_case, sources, expected) => {
    expect(sourcePoints(sources)).toBe(expected)
  })
})

describe('citedByPoints', () => {
  it.each([
    ['an unreported count', undefined, 0],
    ['zero citations', 0, 0],
    ['a negative count', -5, 0],
    ['one citation', 1, 3],
    ['ten citations', 10, 9],
    ['a hundred citations', 100, 17],
    ['the saturation point', CITED_BY_CAP, CITED_BY_MAX],
    ['beyond saturation', CITED_BY_CAP * 100, CITED_BY_MAX],
  ])('scores %s', (_case, citedBy, expected) => {
    expect(citedByPoints(citedBy)).toBe(expected)
  })
})

describe('isArxivOnly and isBibOnly', () => {
  it.each([
    [['arxiv'], true, false],
    [[BIB_SOURCE], false, true],
    [['arxiv', 'crossref'], false, false],
    [[], false, false],
  ])('classifies %j', (sources, arxiv, bib) => {
    expect(isArxivOnly(sources)).toBe(arxiv)
    expect(isBibOnly(sources)).toBe(bib)
  })
})

describe('confidence', () => {
  it.each([
    [
      'a work three indexes agree on, dated, venued, and well cited',
      { sources: ['openalex', 'crossref', 'semanticscholar'], year: 2015, venue: 'Nature', citedBy: 3000 },
      100,
    ],
    [
      'a two-source work with a year and a venue',
      { sources: ['openalex', 'crossref'], year: 2015, venue: 'Nature' },
      SOURCES_TWO + YEAR_POINTS + VENUE_POINTS + NOT_ARXIV_ONLY_POINTS,
    ],
    [
      'an arXiv-only preprint, which forgoes the non-preprint award',
      { sources: ['arxiv'], year: 2026 },
      SOURCES_ONE + YEAR_POINTS,
    ],
    [
      'a single non-arXiv source with nothing else known',
      { sources: ['openalex'] },
      SOURCES_ONE + NOT_ARXIV_ONLY_POINTS,
    ],
    ['a record no source vouched for', { sources: [] }, NOT_ARXIV_ONLY_POINTS],
    ['a bib-only entry with no DOI, which the formula does not decide', { sources: [BIB_SOURCE] }, BIB_ONLY_SCORE],
    [
      'a bib-only entry carrying a DOI, which the formula does decide',
      { sources: [BIB_SOURCE], doi: '10.1038/nature13184', year: 2015 },
      SOURCES_ONE + YEAR_POINTS + NOT_ARXIV_ONLY_POINTS,
    ],
  ])('scores %s', (_case, input, expected) => {
    expect(confidence(input)).toBe(expected)
  })

  it('pins a verified library entry at 100 whatever the signals say', () => {
    expect(confidence({ sources: [BIB_SOURCE], libraryStatus: STATUS_VERIFIED })).toBe(100)
  })

  it('caps a low-confidence library entry, and never raises one below the ceiling', () => {
    const strong = { sources: ['openalex', 'crossref', 'arxiv'], year: 2015, venue: 'Nature' }

    expect(confidence({ ...strong, libraryStatus: STATUS_LOW_CONFIDENCE })).toBe(LOW_CONFIDENCE_CEILING)
    expect(confidence({ sources: ['arxiv'], libraryStatus: STATUS_LOW_CONFIDENCE })).toBe(SOURCES_ONE)
  })

  it('ignores a library status it does not know', () => {
    expect(confidence({ sources: ['openalex'], libraryStatus: 'unread' }))
      .toBe(SOURCES_ONE + NOT_ARXIV_ONLY_POINTS)
  })

  it('is a pure function of its input', () => {
    const input = { sources: ['openalex', 'crossref'], year: 2015, citedBy: 42 }

    expect(confidence(input)).toBe(confidence(input))
  })
})
