/**
 * The BibTeX projection: which fields reach the entry, how the cite key is
 * built, and what happens to the two characters TeX reads as grouping.
 */
import { describe, expect, it } from 'vitest'
import { citeKey, toBibtex } from '../src/client/bibtex.ts'
import { BARE, FULL } from './records.client.ts'

describe('citeKey', () => {
  it('joins the first author family name to the year', () => {
    expect(citeKey(FULL)).toBe('Zhao2024')
  })

  it('falls back to anon and n.d. when the record names neither', () => {
    expect(citeKey(BARE)).toBe('anonn.d.')
  })

  it('keeps only letters and digits of the family name', () => {
    expect(citeKey({ ...BARE, authors: ["O'Brien-Smith, Ada"], year: 1999 })).toBe('OBrienSmith1999')
  })

  it('takes the last token as the family name when the source gave no comma', () => {
    // OpenAlex and Semantic Scholar give display order; keying on the first
    // token would cite "Ruiqiang Guo" as Ruiqiang2015.
    expect(citeKey({ ...BARE, authors: ['Ruiqiang Guo'], year: 2015 })).toBe('Guo2015')
    expect(citeKey({ ...BARE, authors: ['Guo, Ruiqiang'], year: 2015 })).toBe('Guo2015')
    expect(citeKey({ ...BARE, authors: ['Ada Lovelace'], year: 1843 })).toBe('Lovelace1843')
  })

  it('reads the same rule for a spaced CJK name and a single-token one', () => {
    expect(citeKey({ ...BARE, authors: ['李 明'], year: 2015 })).toBe('明2015')
    expect(citeKey({ ...BARE, authors: ['Aristotle'], year: 2015 })).toBe('Aristotle2015')
    expect(citeKey({ ...BARE, authors: ['van der Waals, Johannes'], year: 1873 })).toBe('vanderWaals1873')
  })
})

describe('toBibtex', () => {
  it('renders every field the record carries', () => {
    expect(toBibtex(FULL)).toBe([
      '@article{Zhao2024,',
      '  title = {Halide doping raises the zT of n-type SnSe above 2.4},',
      '  author = {Zhao, Li-Dong and Chang, Cheng and Wang, Dongyang and Qin, Bingchao},',
      '  journal = {Nature},',
      '  year = {2024},',
      '  doi = {10.1038/s41586-024-07001-2},',
      '  eprint = {2607.09182},',
      '  url = {https://doi.org/10.1038/s41586-024-07001-2},',
      '}',
    ].join('\n'))
  })

  it('omits every absent field rather than rendering it empty', () => {
    const entry = toBibtex(BARE)
    expect(entry).toContain('  title = {Grain-boundary engineering of selenide thermoelectrics},')
    expect(entry).toContain('  url = {https://arxiv.org/abs/2608.00011},')
    for (const field of ['author', 'journal', 'year', 'doi', 'eprint']) {
      expect(entry).not.toContain(`  ${field} = `)
    }
  })

  it('escapes the braces that would break the entry', () => {
    const entry = toBibtex({ ...BARE, title: 'On {Bi2Te3} and }rogue{ braces', venue: 'J. {Mater}' })
    expect(entry).toContain('  title = {On \\{Bi2Te3\\} and \\}rogue\\{ braces},')
    expect(entry).toContain('  journal = {J. \\{Mater\\}},')
  })
})
