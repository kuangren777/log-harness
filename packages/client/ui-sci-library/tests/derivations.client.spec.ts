/**
 * The package's pure decisions: the BibTeX an entry renders as, what the
 * detail page can preview and how, the request one view state asks for, and
 * the upload code one refused response carries.
 */
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../src/client/contract.ts'
import { citeKey, toBibtex } from '../src/client/bibtex.ts'
import { clampAbstract } from '../src/client/EntryCard.tsx'
import { identityLine, pdfTarget } from '../src/client/EntryDetail.tsx'
import { kindOf } from '../src/client/UploadButton.tsx'
import { requestOf } from '../src/client/LibraryView.tsx'
import { fileUrl, uploadCodeOf, uploadUrl } from '../src/client/routes.ts'
import {
  PREVIEW_MAX_BYTES, formatSize, highlightLanguage, isPreviewable, previewKindFor,
} from '../src/client/preview.ts'
import { BARE, CSV_FILE, FULL, HUGE_FILE, PDF_FILE } from './entries.client.ts'

describe('toBibtex', () => {
  it('renders a paper as @article with every field the entry carries', () => {
    expect(toBibtex(FULL)).toBe([
      '@article{Zhao2024,',
      `  title = {${FULL.title}},`,
      '  author = {Zhao, Li-Dong and Chang, Cheng},',
      '  journal = {Nature},',
      '  year = {2024},',
      '  doi = {10.1038/s41586-024-07001-2},',
      '  eprint = {2607.09182},',
      '  url = {https://doi.org/10.1038/s41586-024-07001-2},',
      '  keywords = {thermoelectric, snse, doping},',
      '}',
    ].join('\n'))
  })

  it('renders a dataset as @misc and leaves out every field it lacks', () => {
    expect(toBibtex(BARE)).toBe(`@misc{anonn.d.,\n  title = {${BARE.title}},\n}`)
  })

  it('escapes the two braces TeX reads as grouping', () => {
    const braced: LibraryEntry = { ...BARE, title: 'A {curly} title', tags: ['a}b'] }
    expect(toBibtex(braced)).toContain('title = {A \\{curly\\} title}')
    expect(toBibtex(braced)).toContain('keywords = {a\\}b}')
  })
})

describe('citeKey', () => {
  it('takes the family name from an inverted author string', () => {
    expect(citeKey({ ...BARE, authors: ['Guo, Ruiqiang'], year: 2021 })).toBe('Guo2021')
  })

  it('takes the LAST token of a display-order author string', () => {
    expect(citeKey({ ...BARE, authors: ['Ruiqiang Guo'], year: 2021 })).toBe('Guo2021')
  })

  it('drops everything a cite key may not carry', () => {
    expect(citeKey({ ...BARE, authors: ['Ángel  Núñez-Pérez'], year: 2019 })).toBe('NunezPerez2019')
  })

  it('names an authorless, undated entry as anonymous', () => {
    expect(citeKey(BARE)).toBe('anonn.d.')
  })
})

describe('preview dispatch', () => {
  it('routes each media type to the arm that draws it', () => {
    expect(previewKindFor('application/pdf')).toBe('pdf')
    expect(previewKindFor('text/markdown')).toBe('markdown')
    expect(previewKindFor('image/png')).toBe('image')
    expect(previewKindFor('text/csv')).toBe('text')
    expect(previewKindFor('application/json')).toBe('text')
    expect(previewKindFor('application/x-ndjson')).toBe('text')
    expect(previewKindFor('application/octet-stream')).toBe('binary')
  })

  it('offers a preview only for a drawable file within the inline cap', () => {
    expect(isPreviewable(PDF_FILE)).toBe(true)
    expect(isPreviewable(CSV_FILE)).toBe(true)
    // Not drawable at all.
    expect(isPreviewable(HUGE_FILE)).toBe(false)
    // Drawable, but past the cap: the row keeps its download alone.
    expect(isPreviewable({ ...PDF_FILE, size: PREVIEW_MAX_BYTES + 1 })).toBe(false)
    expect(isPreviewable({ ...PDF_FILE, size: PREVIEW_MAX_BYTES })).toBe(true)
  })

  it('names the grammar of a file that has an extension', () => {
    expect(highlightLanguage('zt.csv')).toBe('csv')
    expect(highlightLanguage('README')).toBeUndefined()
    expect(highlightLanguage('.gitignore')).toBeUndefined()
  })

  it('reads a byte count the way a person reads a file size', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(4_096)).toBe('4 KB')
    expect(formatSize(2_400_000)).toBe('2.3 MB')
  })
})

describe('the library routes', () => {
  it('addresses one stored file, escaping both parameters', () => {
    expect(fileUrl('doi:10.1038/x', 'a b.pdf'))
      .toBe('/library-api/file?entryId=doi%3A10.1038%2Fx&name=a%20b.pdf')
  })

  it('addresses the upload route with the kind a new entry would take', () => {
    expect(uploadUrl('new', 'dataset')).toBe('/library-api/upload?entryId=new&kind=dataset')
  })

  it('names each refusal the route can answer with', () => {
    expect(uploadCodeOf(413)).toBe('too-large')
    expect(uploadCodeOf(415)).toBe('unsupported-type')
    expect(uploadCodeOf(403)).toBe('forbidden')
    expect(uploadCodeOf(500)).toBe('failed')
  })
})

describe('requestOf', () => {
  it('asks for everything when nothing is filtered', () => {
    expect(requestOf('', 'all', null)).toEqual({})
  })

  it('sends a trimmed query, a kind, and a tag', () => {
    expect(requestOf('  snse  ', 'paper', 'thermoelectric'))
      .toEqual({ query: 'snse', kind: 'paper', tag: 'thermoelectric' })
  })

  it('turns the low-confidence chip into the status the host filters by', () => {
    expect(requestOf('', 'lowConfidence', null)).toEqual({ status: 'low-confidence' })
  })

  it('sends the other two kind chips as kinds', () => {
    expect(requestOf('', 'dataset', null)).toEqual({ kind: 'dataset' })
    expect(requestOf('', 'note', null)).toEqual({ kind: 'note' })
  })
})

describe('entry derivations', () => {
  it('clamps a long abstract and leaves a short one whole', () => {
    expect(clampAbstract('A'.repeat(160))).toBe(`${'A'.repeat(120)}…`)
    expect(clampAbstract('Short.')).toBe('Short.')
    expect(clampAbstract(undefined)).toBeUndefined()
  })

  it('builds the identifier line from whichever parts the entry carries', () => {
    expect(identityLine(FULL)).toEqual([
      'Zhao, Li-Dong, Chang, Cheng', 'doi:10.1038/s41586-024-07001-2', 'arXiv:2607.09182',
    ])
    expect(identityLine(BARE)).toEqual([])
  })

  it('prefers a stored PDF over the open-access url', () => {
    expect(pdfTarget(FULL)).toBe(fileUrl(FULL.id, 'snse.pdf'))
    expect(pdfTarget({ ...FULL, files: [CSV_FILE] })).toBe(FULL.pdfUrl)
    expect(pdfTarget(BARE)).toBeUndefined()
  })

  it('classifies a picked file by what it is', () => {
    expect(kindOf(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }))).toBe('paper')
    expect(kindOf(new File(['a,b'], 'a.csv', { type: 'text/csv' }))).toBe('dataset')
  })
})
