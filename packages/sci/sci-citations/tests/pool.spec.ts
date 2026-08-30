// The pure shape of a pool. The merge rule carries most of the weight here:
// re-reading `refs.bib` has to replace the bibliographic half of a row and
// leave the half a person decided exactly where it was.
import { describe, expect, it } from 'vitest'
import { QUARANTINE_BELOW, UNGROUPED } from '../src/config.ts'
import { BIB_SOURCE } from '../src/confidence.ts'
import {
  DEFAULT_BIB_TYPE,
  FALLBACK_BIB_TYPE,
  FALLBACK_GROUP_KEY,
  GROUP_PALETTE,
  bibEntryFromCitation,
  bibFacts,
  bibYear,
  citationFromBib,
  citationId,
  citationRow,
  cleanBibValue,
  groupKeyFromLabel,
  groupRowKey,
  mergeBibEntry,
  normalizeDoi,
  paletteColor,
  poolStats,
  quarantineFlag,
  quarantineFloor,
  renderBibtexFile,
  sortCitations,
  sortGroups,
} from '../src/pool.ts'
import type { CitationGroup } from '../src/types.ts'
import { PROJECT, T0, bibEntry, citation } from './fixtures.ts'

describe('citationId and groupRowKey', () => {
  it('key rows by the project and the stable token inside it', () => {
    expect(citationId(PROJECT, 'zhao2015')).toBe('snse:zhao2015')
    expect(groupRowKey(PROJECT, 'method')).toBe('snse:method')
  })
})

describe('citationRow', () => {
  it('drops an optional column that holds nothing, so the read schema still accepts the row', () => {
    const row = citationRow(citation({ note: '', venue: undefined, year: 2015 }))

    expect(Object.hasOwn(row, 'note')).toBe(false)
    expect(Object.hasOwn(row, 'venue')).toBe(false)
    expect(row.year).toBe(2015)
  })

  it('copies the arrays rather than aliasing the caller’s', () => {
    const authors = ['Zhao, Li-Dong']
    const row = citationRow(citation({ authors }))

    authors.push('Later, Addition')

    expect(row.authors).toEqual(['Zhao, Li-Dong'])
  })
})

describe('cleanBibValue', () => {
  it.each([
    ['grouping braces', 'Ultralow {SnSe} conductivity', 'Ultralow SnSe conductivity'],
    ['wrapped lines', 'a\n   b', 'a b'],
    ['surrounding space', '  a  ', 'a'],
  ])('folds %s away', (_case, value, expected) => {
    expect(cleanBibValue(value)).toBe(expected)
  })
})

describe('normalizeDoi', () => {
  it.each([
    ['a bare DOI', '10.1038/Nature13184', '10.1038/nature13184'],
    ['a doi.org URL', 'https://doi.org/10.1038/nature13184', '10.1038/nature13184'],
    ['a dx.doi.org URL', 'http://dx.doi.org/10.1038/nature13184', '10.1038/nature13184'],
    ['a doi: form', 'doi: 10.1038/nature13184', '10.1038/nature13184'],
  ])('normalizes %s', (_case, value, expected) => {
    expect(normalizeDoi(value)).toBe(expected)
  })

  it.each([
    ['nothing given', undefined],
    ['an empty string', '  '],
  ])('answers undefined for %s', (_case, value) => {
    expect(normalizeDoi(value)).toBeUndefined()
  })
})

describe('bibYear', () => {
  it.each([
    ['a plain year', '2015', 2015],
    ['a year inside prose', 'in press, 2015', 2015],
  ])('reads %s', (_case, value, expected) => {
    expect(bibYear(value)).toBe(expected)
  })

  it.each([
    ['an absent field', undefined],
    ['a field holding no four-digit number', 'in press'],
  ])('answers undefined for %s', (_case, value) => {
    expect(bibYear(value)).toBeUndefined()
  })
})

describe('bibFacts', () => {
  it('reads every field the pool carries', () => {
    const facts = bibFacts(bibEntry({
      fields: {
        title: 'Ultralow {thermal} conductivity',
        year: '2015',
        journal: 'Nature',
        doi: 'https://doi.org/10.1038/NATURE13184',
        eprint: '1501.00001',
        url: 'https://example.org/p',
      },
      authors: ['Zhao,  Li-Dong'],
    }))

    expect(facts).toEqual({
      title: 'Ultralow thermal conductivity',
      authors: ['Zhao, Li-Dong'],
      year: 2015,
      venue: 'Nature',
      doi: '10.1038/nature13184',
      arxivId: '1501.00001',
      url: 'https://example.org/p',
    })
  })

  it('falls back to booktitle for a conference paper', () => {
    expect(bibFacts(bibEntry({ fields: { booktitle: 'NeurIPS' } })).venue).toBe('NeurIPS')
  })

  it('leaves every absent field out and reports an empty title', () => {
    expect(bibFacts(bibEntry({ fields: {}, authors: [] }))).toEqual({ title: '', authors: [] })
  })
})

describe('quarantineFloor', () => {
  it.each([
    ['a request to hold a strong entry back', 90, true, true],
    ['a request to release a strong entry', 90, false, false],
    ['a request to release a weak entry, which the automatic rule refuses', 30, false, true],
    ['a request to hold a weak entry back', 30, true, true],
  ])('answers %s', (_case, score, requested, expected) => {
    expect(quarantineFloor(score, requested)).toBe(expected)
  })

  it('holds back exactly below the threshold, not at it', () => {
    expect(quarantineFloor(QUARANTINE_BELOW, false)).toBe(false)
    expect(quarantineFloor(QUARANTINE_BELOW - 1, false)).toBe(true)
  })
})

describe('quarantineFlag', () => {
  it('keeps a hand-set quarantine through a recomputation that would clear it', () => {
    expect(quarantineFlag(citation({ confidence: 90, quarantined: true }), 95)).toBe(true)
  })

  it('releases a row the threshold alone had held back', () => {
    expect(quarantineFlag(citation({ confidence: 30, quarantined: true }), 95)).toBe(false)
  })

  it('raises the flag on a fresh row scoring under the threshold', () => {
    expect(quarantineFlag(undefined, 30)).toBe(true)
    expect(quarantineFlag(undefined, 95)).toBe(false)
  })
})

describe('citationFromBib', () => {
  it('builds a bib-sourced row, quarantined because nothing verified it', () => {
    const row = citationFromBib(PROJECT, bibEntry({ fields: { title: 'T', year: '2015' }, authors: ['Zhao'] }), T0)

    expect(row).toMatchObject({
      id: 'snse:zhao2015',
      project: PROJECT,
      citekey: 'zhao2015',
      title: 'T',
      authors: ['Zhao'],
      year: 2015,
      sources: [BIB_SOURCE],
      group: UNGROUPED,
      uses: 0,
      quarantined: true,
      addedAt: T0,
      updatedAt: T0,
    })
  })

  it('carries the arXiv id and the landing page the file named', () => {
    const entry = bibEntry({ fields: { title: 'T', eprint: '1501.00001', url: 'https://example.org/p' } })

    expect(citationFromBib(PROJECT, entry, T0)).toMatchObject({
      arxivId: '1501.00001',
      url: 'https://example.org/p',
    })
  })

  it('titles a field-less entry by its own citekey rather than leaving it blank', () => {
    expect(citationFromBib(PROJECT, bibEntry({ fields: {}, authors: [] }), T0).title).toBe('zhao2015')
  })

  it('scores a DOI-carrying bib entry through the formula instead of the bib-only floor', () => {
    const entry = bibEntry({ fields: { title: 'T', year: '2015', journal: 'Nature', doi: '10.1/x' } })

    expect(citationFromBib(PROJECT, entry, T0).confidence).toBe(45)
  })
})

describe('mergeBibEntry', () => {
  const DECIDED = citation({ group: 'method', note: 'read this first', libraryId: 'doi:10.1/x', uses: 3 })

  it('replaces the bibliographic half and touches nothing a person decided', () => {
    const merged = mergeBibEntry(DECIDED, bibEntry({ fields: { title: 'Rewritten', year: '2020' } }), T0 + 1)

    expect(merged).toMatchObject({
      title: 'Rewritten',
      year: 2020,
      group: 'method',
      note: 'read this first',
      libraryId: 'doi:10.1/x',
      uses: 3,
      addedAt: T0,
      updatedAt: T0 + 1,
    })
  })

  it('keeps the stored title and authors when the file states neither', () => {
    const merged = mergeBibEntry(DECIDED, bibEntry({ fields: {}, authors: [] }), T0 + 1)

    expect(merged.title).toBe(DECIDED.title)
    expect(merged.authors).toEqual(DECIDED.authors)
  })

  it('leaves the row untouched, timestamp included, when the file agrees with it', () => {
    const stored = citationFromBib(PROJECT, bibEntry(), T0)

    const merged = mergeBibEntry(stored, bibEntry(), T0 + 5000)

    expect(merged).toEqual(stored)
  })

  it('recomputes confidence for a bib-only row, because the file is its only source', () => {
    const stored = citationFromBib(PROJECT, bibEntry({ fields: { title: 'T' }, authors: [] }), T0)
    expect(stored.confidence).toBe(30)

    const merged = mergeBibEntry(stored, bibEntry({ fields: { title: 'T', doi: '10.1/x', year: '2015' } }), T0 + 1)

    expect(merged.confidence).toBe(35)
    expect(merged.quarantined).toBe(true)
  })

  it('rescores an undated bib-only row at the floor, having no signal to score', () => {
    const stored = citationFromBib(PROJECT, bibEntry({ fields: { title: 'T' }, authors: [] }), T0)

    const merged = mergeBibEntry(stored, bibEntry({ fields: { title: 'Retitled' }, authors: [] }), T0 + 1)

    expect(merged).toMatchObject({ title: 'Retitled', confidence: 30, quarantined: true })
    expect(Object.hasOwn(merged, 'year')).toBe(false)
  })

  it('does not recompute an index-sourced row, whose signals the file never held', () => {
    const merged = mergeBibEntry(citation({ confidence: 90 }), bibEntry({ fields: { title: 'T' } }), T0 + 1)

    expect(merged.confidence).toBe(90)
  })
})

describe('bibEntryFromCitation and renderBibtexFile', () => {
  it('writes an article when a venue is known', () => {
    const entry = bibEntryFromCitation(citation({ arxivId: '1501.00001', url: 'https://example.org/p' }))

    expect(entry).toEqual({
      type: DEFAULT_BIB_TYPE,
      key: 'zhao2015',
      fields: {
        title: 'Ultralow thermal conductivity in SnSe crystals',
        year: '2015',
        journal: 'Nature',
        doi: '10.1038/nature13184',
        eprint: '1501.00001',
        url: 'https://example.org/p',
      },
      authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
    })
  })

  it('writes a misc entry with only a title when nothing else is known', () => {
    const entry = bibEntryFromCitation(citation({ venue: undefined, year: undefined, doi: undefined, authors: [] }))

    expect(entry).toEqual({
      type: FALLBACK_BIB_TYPE,
      key: 'zhao2015',
      fields: { title: 'Ultralow thermal conductivity in SnSe crystals' },
      authors: [],
    })
  })

  it('renders the selection as a file ending in a newline', () => {
    const file = renderBibtexFile([citation({ venue: undefined, doi: undefined, year: undefined, authors: [] })])

    expect(file).toBe('@misc{zhao2015,\n  title = {Ultralow thermal conductivity in SnSe crystals},\n}\n')
  })

  it('renders an empty selection as an empty file', () => {
    expect(renderBibtexFile([])).toBe('')
  })

  it('separates entries with a blank line', () => {
    const file = renderBibtexFile([citation({ citekey: 'a' }), citation({ citekey: 'b' })])

    expect(file.split('\n\n')).toHaveLength(2)
  })
})

describe('sortCitations and sortGroups', () => {
  it('orders citations by the citekey the manuscript uses', () => {
    const rows = [citation({ citekey: 'c' }), citation({ citekey: 'a' }), citation({ citekey: 'b' })]

    expect(sortCitations(rows).map(row => row.citekey)).toEqual(['a', 'b', 'c'])
  })

  it('orders groups by position, breaking ties on the key', () => {
    const group = (key: string, order: number): CitationGroup => ({ project: PROJECT, key, label: key, color: '#fff', order })
    const groups = [group('z', 1), group('a', 1), group('first', 0)]

    expect(sortGroups(groups).map(row => row.key)).toEqual(['first', 'a', 'z'])
  })

  it('breaks a tie the same way whichever order the rows arrived in', () => {
    const group = (key: string): CitationGroup => ({ project: PROJECT, key, label: key, color: '#fff', order: 0 })

    expect(sortGroups([group('a'), group('b')]).map(row => row.key)).toEqual(['a', 'b'])
    expect(sortGroups([group('b'), group('a')]).map(row => row.key)).toEqual(['a', 'b'])
  })
})

describe('poolStats', () => {
  it('counts an empty pool without dividing by zero', () => {
    expect(poolStats([], 0)).toEqual({ total: 0, avgConfidence: 0, quarantined: 0, scannedFiles: 0 })
  })

  it('rounds the mean, counts the quarantined, and reports the newest scan', () => {
    const rows = [
      citation({ citekey: 'a', confidence: 90, lastScanAt: T0 }),
      citation({ citekey: 'b', confidence: 31, quarantined: true, lastScanAt: T0 + 10 }),
    ]

    expect(poolStats(rows, 4)).toEqual({
      total: 2,
      avgConfidence: 61,
      quarantined: 1,
      scannedFiles: 4,
      lastScanAt: T0 + 10,
    })
  })

  it('leaves lastScanAt out until something has been scanned', () => {
    expect(Object.hasOwn(poolStats([citation()], 0), 'lastScanAt')).toBe(false)
  })
})

describe('groupKeyFromLabel and paletteColor', () => {
  it.each([
    ['Method papers', 'method-papers'],
    ['  Spaced  ', 'spaced'],
    ['方法', '方法'],
    ['!!!', FALLBACK_GROUP_KEY],
  ])('folds %j into a key', (label, expected) => {
    expect(groupKeyFromLabel(label)).toBe(expected)
  })

  it('cycles the palette so a project with many groups still gets a color', () => {
    expect(paletteColor(0)).toBe(GROUP_PALETTE[0])
    expect(paletteColor(GROUP_PALETTE.length)).toBe(GROUP_PALETTE[0])
  })
})
