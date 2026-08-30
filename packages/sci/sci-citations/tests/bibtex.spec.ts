// The `refs.bib` reader and writer against the shapes real bibliographies come
// in: braced, quoted, and bare values, nested braces, `@string` macros, and the
// damaged blocks that must become one reported error each instead of an empty
// file. The writer is checked byte-for-byte, because the whole point of
// upserting rather than rewriting is that the user's own file survives.
import { describe, expect, it } from 'vitest'
import {
  AUTHOR_SEPARATOR,
  BIB_FIELD_ORDER,
  NON_RECORD_TYPES,
  formatBibtexEntry,
  lineAt,
  parseBibtex,
  removeBibtexEntry,
  splitAuthors,
  upsertBibtexEntry,
} from '../src/bibtex.ts'
import { bibEntry } from './fixtures.ts'

const BRACED = `@article{zhao2015,
  title = {Ultralow thermal {conductivity} in SnSe},
  author = {Zhao, Li-Dong and Chang, Cheng},
  year = {2015},
  journal = {Nature},
}`

describe('parseBibtex', () => {
  it('reads a braced entry, keeping nested braces and splitting the authors', () => {
    const parsed = parseBibtex(BRACED)

    expect(parsed.errors).toEqual([])
    expect(parsed.entries).toEqual([{
      type: 'article',
      key: 'zhao2015',
      fields: {
        title: 'Ultralow thermal {conductivity} in SnSe',
        author: 'Zhao, Li-Dong and Chang, Cheng',
        year: '2015',
        journal: 'Nature',
      },
      authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
    }])
  })

  it('reads quoted and bare values, and an entry closing without a trailing comma', () => {
    const parsed = parseBibtex('@inproceedings{k, title = "A {braced} title", year = 2020, pages = 1--9 }')

    expect(parsed.errors).toEqual([])
    expect(parsed.entries[0]).toMatchObject({
      type: 'inproceedings',
      key: 'k',
      fields: { title: 'A {braced} title', year: '2020', pages: '1--9' },
      authors: [],
    })
  })

  it('reads a field-less entry and an upper-case type', () => {
    const parsed = parseBibtex('@MISC{barekey}')

    expect(parsed.entries).toEqual([{ type: 'misc', key: 'barekey', fields: {}, authors: [] }])
  })

  it('reads several entries and keeps a duplicate citekey once per occurrence', () => {
    const parsed = parseBibtex(`${BRACED}\n\n@misc{zhao2015, title = {Second}}\n`)

    expect(parsed.entries.map(entry => entry.key)).toEqual(['zhao2015', 'zhao2015'])
  })

  it.each(NON_RECORD_TYPES)('consumes an @%s block without returning a work', (type) => {
    const parsed = parseBibtex(`@${type}{ nothing = {here} }\n\n${BRACED}`)

    expect(parsed.errors).toEqual([])
    expect(parsed.entries.map(entry => entry.key)).toEqual(['zhao2015'])
  })

  it('survives an @ inside a field value', () => {
    const parsed = parseBibtex('@misc{k, note = {write to a@b.example}}')

    expect(parsed.entries.map(entry => entry.fields['note'])).toEqual(['write to a@b.example'])
  })

  it.each([
    ['a type that is not a word', '@1{k, a = {b}}', 'expected an entry type after "@"'],
    ['a type with no brace', '@article k', 'entry type "article" is not followed by "{"'],
    ['a key that never closes', '@article{k', 'entry is never closed'],
    ['a braced value that never closes', '@article{k, title = {open', 'braced value is never closed'],
    ['a quoted value that never closes', '@article{k, title = "open', 'quoted value is never closed'],
    ['a field with no value', '@article{k, title = ,}', 'field has no value'],
    ['a field with no name', '@article{k, = {b}}', 'expected a field name'],
    ['a field with no equals', '@article{k, title {b}}', 'field "title" is not followed by "="'],
    ['a field list that never closes', '@article{k, title = {b},', 'entry is never closed'],
    ['a value followed by junk', '@article{k, title = {b} year = {c}}', 'field "title" is not followed by "," or "}"'],
  ])('reports %s as one error instead of failing the file', (_case, text, message) => {
    const parsed = parseBibtex(`${BRACED}\n\n${text}`)

    expect(parsed.entries.map(entry => entry.key)).toEqual(['zhao2015'])
    expect(parsed.errors).toEqual([{ line: 8, message }])
  })

  it('reports nothing for a file with no entries at all', () => {
    expect(parseBibtex('% just a comment\n')).toEqual({ entries: [], errors: [] })
  })

  it('resynchronizes on the next block rather than on the next character', () => {
    const parsed = parseBibtex(`@article{broken, title = {a}\n\n${BRACED}`)

    expect(parsed.errors).toHaveLength(1)
    expect(parsed.entries.map(entry => entry.key)).toEqual(['zhao2015'])
  })
})

describe('lineAt', () => {
  it('counts from 1 and clamps an offset past the end', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1)
    expect(lineAt('a\nb\nc', 4)).toBe(3)
    expect(lineAt('a\nb\nc', 999)).toBe(3)
  })
})

describe('splitAuthors', () => {
  it.each([
    ['no author field', undefined, []],
    ['one name', 'Zhao, Li-Dong', ['Zhao, Li-Dong']],
    ['two names', 'Zhao, Li-Dong and Chang, Cheng', ['Zhao, Li-Dong', 'Chang, Cheng']],
    ['a braced name', '{Zhao}, Li-Dong', ['Zhao, Li-Dong']],
    ['collapsed whitespace', 'Zhao,   Li-Dong', ['Zhao, Li-Dong']],
    ['an empty field', '   ', []],
    ['a trailing separator', 'Zhao and ', ['Zhao']],
  ])('splits %s', (_case, author, expected) => {
    expect(splitAuthors(author)).toEqual(expected)
  })
})

describe('formatBibtexEntry', () => {
  it('writes the known fields in order and appends the rest sorted', () => {
    const block = formatBibtexEntry(bibEntry({
      fields: { zzz: 'last', year: '2015', title: 'T', aaa: 'first' },
      authors: ['Zhao, Li-Dong'],
    }))

    expect(block).toBe([
      '@article{zhao2015,',
      '  title = {T},',
      '  author = {Zhao, Li-Dong},',
      '  year = {2015},',
      '  aaa = {first},',
      '  zzz = {last},',
      '}',
    ].join('\n'))
  })

  it('keeps a stale author field when the entry carries no author list', () => {
    const block = formatBibtexEntry(bibEntry({ fields: { author: 'Stale, Name' }, authors: [] }))

    expect(block).toContain('author = {Stale, Name}')
  })

  it('joins several authors with the BibTeX separator', () => {
    const block = formatBibtexEntry(bibEntry({ fields: {}, authors: ['A', 'B'] }))

    expect(block).toContain(`author = {A${AUTHOR_SEPARATOR}B}`)
  })

  it('sorts two unknown fields by name whichever order they arrived in', () => {
    const forward = formatBibtexEntry(bibEntry({ fields: { aaa: '1', zzz: '2' }, authors: [] }))
    const reversed = formatBibtexEntry(bibEntry({ fields: { zzz: '2', aaa: '1' }, authors: [] }))

    expect(forward).toBe(reversed)
    expect(forward.indexOf('aaa')).toBeLessThan(forward.indexOf('zzz'))
  })

  it('orders every documented field ahead of an unknown one', () => {
    const fields = Object.fromEntries(BIB_FIELD_ORDER.map(name => [name, name]))
    const block = formatBibtexEntry(bibEntry({ fields: { ...fields, unknown: 'x' }, authors: [] }))

    expect(block.trimEnd().split('\n').at(-2)).toBe('  unknown = {x},')
  })
})

describe('upsertBibtexEntry', () => {
  it('writes the first entry of an empty file', () => {
    expect(upsertBibtexEntry('', bibEntry({ fields: { title: 'T' }, authors: [] })))
      .toBe('@article{zhao2015,\n  title = {T},\n}\n')
  })

  it('treats a whitespace-only file as empty', () => {
    expect(upsertBibtexEntry('\n  \n', bibEntry({ fields: {}, authors: [] })))
      .toBe('@article{zhao2015,\n}\n')
  })

  it.each([
    ['no trailing newline', '@misc{other}', '@misc{other}\n\n@article{zhao2015,\n}\n'],
    ['one trailing newline', '@misc{other}\n', '@misc{other}\n\n@article{zhao2015,\n}\n'],
    ['a blank line at the end', '@misc{other}\n\n', '@misc{other}\n\n@article{zhao2015,\n}\n'],
  ])('appends a new citekey after a file ending in %s', (_case, before, expected) => {
    expect(upsertBibtexEntry(before, bibEntry({ fields: {}, authors: [] }))).toBe(expected)
  })

  it('replaces exactly the block of an existing citekey and touches nothing else', () => {
    const file = `% hand-written header\n@string{nat = "Nature"}\n\n${BRACED}\n\n@misc{other, title = {Keep me}}\n`

    const next = upsertBibtexEntry(file, bibEntry({ fields: { title: 'Rewritten' }, authors: ['Zhao, Li-Dong'] }))

    expect(next).toBe('% hand-written header\n@string{nat = "Nature"}\n\n'
      + '@article{zhao2015,\n  title = {Rewritten},\n  author = {Zhao, Li-Dong},\n}\n\n'
      + '@misc{other, title = {Keep me}}\n')
  })

  it('is idempotent: writing the same entry twice leaves the same bytes', () => {
    const entry = bibEntry({ fields: { title: 'T' }, authors: ['Zhao, Li-Dong'] })
    const once = upsertBibtexEntry('', entry)

    expect(upsertBibtexEntry(once, entry)).toBe(once)
  })
})

describe('removeBibtexEntry', () => {
  it('drops the block and the blank line under it', () => {
    const file = `${BRACED}\n\n@misc{other, title = {Keep me}}\n`

    expect(removeBibtexEntry(file, 'zhao2015')).toBe('@misc{other, title = {Keep me}}\n')
  })

  it('leaves a file that never held the citekey byte-identical', () => {
    expect(removeBibtexEntry(BRACED, 'absent')).toBe(BRACED)
  })

  it('collapses the tail rather than growing a hole over repeated removals', () => {
    const file = '@misc{a}\n\n@misc{b}\n\n@misc{c}\n'

    expect(removeBibtexEntry(removeBibtexEntry(file, 'b'), 'c')).toBe('@misc{a}\n')
  })
})
