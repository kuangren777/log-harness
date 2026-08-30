// The rules a re-add, an edit, and the size cap follow. Two of them are the
// ones a user notices when they are wrong: a second add must not lose a tag,
// and the trim must never drop a row whose files are on disk.
import { describe, expect, it } from 'vitest'
import { MAX_NOTE_CHARS, MAX_TAGS, MAX_TITLE_CHARS } from '../src/config.ts'
import {
  LIBRARY_KINDS,
  LIBRARY_SOURCES,
  LIBRARY_STATUSES,
  OPTIONAL_COLUMNS,
  applyPatch,
  clampTitle,
  entryFromDraft,
  entryFromRecord,
  entryRow,
  expiredEntryIds,
  facetTags,
  filterEntries,
  libraryCounts,
  mergeEntry,
  normalizeTags,
  orderEntries,
  pageBounds,
  withFile,
} from '../src/entries.ts'
import { entry, file, T0 } from './fixtures.ts'

describe('entryRow', () => {
  it('leaves every unfilled optional column absent rather than storing undefined', () => {
    const row = entryRow(entry({ year: undefined, venue: undefined }))

    expect(Object.keys(row)).not.toContain('year')
    expect(Object.keys(row)).not.toContain('venue')
  })

  it('drops an empty string, which the read-side schema would refuse at the next boot', () => {
    const row = entryRow(entry({ venue: '' }))

    expect('venue' in row).toBe(false)
  })

  it('keeps every optional column that holds a value', () => {
    const row = entryRow(entry({
      year: 2015, venue: 'PRB', abstract: 'a', doi: 'd', arxivId: 'x',
      url: 'u', pdfUrl: 'p', citedBy: 7, note: 'n',
    }))

    expect(OPTIONAL_COLUMNS.every(column => column in row)).toBe(true)
  })

  it('copies the arrays so the stored row cannot alias a caller list', () => {
    const authors = ['a']
    const row = entryRow(entry({ authors }))
    authors.push('b')

    expect(row.authors).toEqual(['a'])
  })
})

describe('normalizeTags', () => {
  it('lowercases, trims, and de-duplicates while keeping insertion order', () => {
    expect(normalizeTags([' Thermo ', 'thermo', 'ZT'])).toEqual(['thermo', 'zt'])
  })

  it('drops blanks', () => {
    expect(normalizeTags(['', '  '])).toEqual([])
  })

  it('stops at the tag cap', () => {
    expect(normalizeTags(Array.from({ length: MAX_TAGS + 10 }, (_, index) => `t${index}`))).toHaveLength(MAX_TAGS)
  })
})

describe('clampTitle', () => {
  it('trims and truncates', () => {
    expect(clampTitle(`  ${'x'.repeat(MAX_TITLE_CHARS + 10)}  `)).toHaveLength(MAX_TITLE_CHARS)
  })

  it('refuses a blank title, because an entry with none has nothing to list', () => {
    expect(() => clampTitle('   ')).toThrow(TypeError)
  })
})

describe('entryFromRecord', () => {
  it('reuses the record id and carries its optional columns', () => {
    const built = entryFromRecord({
      id: 'doi:10.1/x',
      title: 'A work',
      authors: ['Zhao, Li-Dong'],
      year: 2015,
      doi: '10.1/x',
      sources: ['openalex', 'crossref'],
    }, ['ZT'], T0)

    expect(built).toMatchObject({
      id: 'doi:10.1/x', kind: 'paper', status: 'unread', year: 2015, doi: '10.1/x',
      sources: ['openalex', 'crossref'], tags: ['zt'], files: [], addedAt: T0, updatedAt: T0,
    })
  })

  it('takes an empty source list when the record named none', () => {
    expect(entryFromRecord({ id: 'a', title: 't', authors: [] }, [], T0).sources).toEqual([])
  })
})

describe('entryFromDraft', () => {
  it('defaults kind, status, and sources for a hand-written entry', () => {
    const built = entryFromDraft({ title: 'Note' }, 'note:1', [], T0)

    expect(built).toMatchObject({ kind: 'paper', status: 'unread', sources: ['manual'], authors: [] })
  })

  it('merges the draft tags with the call tags', () => {
    expect(entryFromDraft({ title: 'x', tags: ['a'] }, 'note:1', ['B'], T0).tags).toEqual(['a', 'b'])
  })

  it('honours an explicit kind, status, and source list', () => {
    const built = entryFromDraft({ title: 'x', kind: 'dataset', status: 'read', sources: ['upload'] }, 'file:1', [], T0)

    expect(built).toMatchObject({ kind: 'dataset', status: 'read', sources: ['upload'] })
  })
})

describe('mergeEntry', () => {
  const stored = entry({ title: 'Edited title', status: 'read', tags: ['zt'], note: 'mine', authors: ['a', 'b'] })

  it('keeps the stored title, status, and note a second add would have overwritten', () => {
    const merged = mergeEntry(stored, entry({ title: 'Original title', status: 'unread' }), T0 + 1)

    expect(merged).toMatchObject({ title: 'Edited title', status: 'read', note: 'mine' })
  })

  it('unions the tags', () => {
    expect(mergeEntry(stored, entry({ tags: ['snse'] }), T0 + 1).tags).toEqual(['zt', 'snse'])
  })

  it('unions the sources', () => {
    const merged = mergeEntry(entry({ sources: ['openalex'] }), entry({ sources: ['crossref', 'openalex'] }), T0 + 1)

    expect(merged.sources).toEqual(['openalex', 'crossref'])
  })

  it('fills an optional column the stored row never had', () => {
    const merged = mergeEntry(entry({ doi: undefined }), entry({ doi: '10.1/x' }), T0 + 1)

    expect(merged.doi).toBe('10.1/x')
  })

  it('leaves a column neither side filled absent', () => {
    expect('venue' in mergeEntry(entry(), entry(), T0 + 1)).toBe(false)
  })

  it('keeps the longer author list, because a truncated one is not a fact', () => {
    expect(mergeEntry(stored, entry({ authors: ['a', 'b', 'c'] }), T0 + 1).authors).toEqual(['a', 'b', 'c'])
  })

  it('unions the files by name, so a re-add never duplicates one', () => {
    const merged = mergeEntry(
      entry({ files: [file({ name: 'paper.pdf' })] }),
      entry({ files: [file({ name: 'paper.pdf' }), file({ name: 'data.csv' })] }),
      T0 + 1,
    )

    expect(merged.files.map(stored2 => stored2.name)).toEqual(['paper.pdf', 'data.csv'])
  })

  it('bumps updatedAt and keeps addedAt', () => {
    const merged = mergeEntry(stored, entry(), T0 + 9)

    expect(merged).toMatchObject({ addedAt: T0, updatedAt: T0 + 9 })
  })
})

describe('applyPatch', () => {
  it('changes only the named fields', () => {
    const patched = applyPatch(entry({ tags: ['a'] }), { status: 'reading' }, T0 + 1)

    expect(patched).toMatchObject({ status: 'reading', tags: ['a'], updatedAt: T0 + 1 })
  })

  it('normalizes the tags it is given', () => {
    expect(applyPatch(entry(), { tags: [' ZT ', 'zt'] }, T0 + 1).tags).toEqual(['zt'])
  })

  it('clamps a new title and truncates a long note', () => {
    const patched = applyPatch(entry(), { title: '  New  ', note: 'x'.repeat(MAX_NOTE_CHARS + 5) }, T0 + 1)

    expect(patched.title).toBe('New')
    expect(patched.note).toHaveLength(MAX_NOTE_CHARS)
  })

  it('clears the note when given an empty string', () => {
    expect('note' in applyPatch(entry({ note: 'old' }), { note: '' }, T0 + 1)).toBe(false)
  })
})

describe('withFile', () => {
  it('appends and replaces a same-named earlier file', () => {
    const once = withFile(entry(), file({ name: 'a.pdf', size: 1 }), T0 + 1)
    const twice = withFile(once, file({ name: 'a.pdf', size: 2 }), T0 + 2)

    expect(twice.files).toHaveLength(1)
    expect(twice.files[0]?.size).toBe(2)
    expect(twice.updatedAt).toBe(T0 + 2)
  })
})

describe('filterEntries', () => {
  const rows = [
    entry({ id: 'p', kind: 'paper', status: 'unread', tags: ['zt'] }),
    entry({ id: 'd', kind: 'dataset', status: 'read', tags: [] }),
  ]

  it('keeps everything when no filter is named', () => {
    expect(filterEntries(rows, {})).toHaveLength(2)
  })

  it('filters by kind, status, and tag', () => {
    expect(filterEntries(rows, { kind: 'dataset' }).map(row => row.id)).toEqual(['d'])
    expect(filterEntries(rows, { status: 'read' }).map(row => row.id)).toEqual(['d'])
    expect(filterEntries(rows, { tag: ' ZT ' }).map(row => row.id)).toEqual(['p'])
  })

  it('treats a blank tag as no tag filter', () => {
    expect(filterEntries(rows, { tag: '  ' })).toHaveLength(2)
  })
})

describe('facetTags', () => {
  it('counts tags most frequent first, ties by name', () => {
    const facets = facetTags([entry({ tags: ['zt', 'snse'] }), entry({ tags: ['zt', 'alpha'] })])

    expect(facets).toEqual([{ tag: 'zt', count: 2 }, { tag: 'alpha', count: 1 }, { tag: 'snse', count: 1 }])
  })
})

describe('libraryCounts', () => {
  it('counts the whole library by kind and low confidence', () => {
    const counts = libraryCounts([
      entry({ kind: 'paper' }),
      entry({ kind: 'dataset' }),
      entry({ kind: 'note', status: 'low-confidence' }),
    ])

    expect(counts).toEqual({ all: 3, paper: 1, dataset: 1, note: 1, lowConfidence: 1 })
  })
})

describe('orderEntries', () => {
  const rows = [entry({ id: 'a', title: 'snse', updatedAt: T0 }), entry({ id: 'b', title: 'graphene', updatedAt: T0 + 1 })]

  it('falls back to recency for an absent or blank query', () => {
    expect(orderEntries(rows, undefined).map(row => row.id)).toEqual(['b', 'a'])
    expect(orderEntries(rows, '   ').map(row => row.id)).toEqual(['b', 'a'])
  })

  it('ranks by score when a query is given', () => {
    expect(orderEntries(rows, 'snse').map(row => row.id)).toEqual(['a'])
  })
})

describe('expiredEntryIds', () => {
  it('drops nothing while the library is inside the cap', () => {
    expect(expiredEntryIds([entry()], 5)).toEqual([])
  })

  it('drops the oldest rows past the cap, oldest first', () => {
    const rows = [
      entry({ id: 'new', updatedAt: T0 + 3 }),
      entry({ id: 'mid', updatedAt: T0 + 2 }),
      entry({ id: 'old', updatedAt: T0 + 1 }),
    ]

    expect(expiredEntryIds(rows, 1)).toEqual(['old', 'mid'])
  })

  it('never drops a row that owns files, however old it is', () => {
    const rows = [
      entry({ id: 'new', updatedAt: T0 + 3 }),
      entry({ id: 'has-files', updatedAt: T0, files: [file()] }),
    ]

    expect(expiredEntryIds(rows, 1)).toEqual([])
  })
})

describe('pageBounds', () => {
  it('applies the default limit and a zero offset', () => {
    expect(pageBounds(undefined, undefined, 50, 100)).toEqual({ limit: 50, offset: 0 })
  })

  it('clamps a limit into range and truncates a fractional one', () => {
    expect(pageBounds(0, 0, 50, 100).limit).toBe(1)
    expect(pageBounds(1000, 0, 50, 100).limit).toBe(100)
    expect(pageBounds(7.9, 0, 50, 100).limit).toBe(7)
  })

  it('falls back to the default for a non-finite limit', () => {
    expect(pageBounds(Number.NaN, 0, 50, 100).limit).toBe(50)
  })

  it('floors a negative or fractional offset at zero', () => {
    expect(pageBounds(10, -5, 50, 100).offset).toBe(0)
    expect(pageBounds(10, 3.7, 50, 100).offset).toBe(3)
    expect(pageBounds(10, Number.NaN, 50, 100).offset).toBe(0)
  })
})

describe('schema enums', () => {
  it('name every value the row type allows', () => {
    expect(LIBRARY_KINDS).toEqual(['paper', 'dataset', 'note'])
    expect(LIBRARY_STATUSES).toEqual(['unread', 'reading', 'read', 'verified', 'low-confidence'])
    expect(LIBRARY_SOURCES).toContain('upload')
  })
})
