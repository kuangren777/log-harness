// Minting a citekey. Every case here is total on purpose: a work with no
// author and no year still has to get a key, because the model has nothing to
// write in `\cite{}` otherwise.
import { describe, expect, it } from 'vitest'
import {
  ANONYMOUS_FAMILY,
  UNDATED_YEAR,
  citekeyBase,
  citekeySuffix,
  familyName,
  normalizeCitekey,
  uniqueCitekey,
} from '../src/citekey.ts'

describe('familyName', () => {
  it.each([
    ['a BibTeX-ordered name', 'Zhao, Li-Dong', 'zhao'],
    ['a display-ordered name', 'Li-Dong Zhao', 'zhao'],
    ['a one-word name', 'Aristotle', 'aristotle'],
    ['a diacritic', 'Serrano-Sánchez, F.', 'serranosanchez'],
    ['a hyphenated family in display order', 'F. Serrano-Sánchez', 'serranosanchez'],
    ['a name with a digit', 'Author2, X', 'author2'],
    ['an empty name', '', ''],
    ['a name with no letters', '???', ''],
  ])('folds %s', (_case, author, expected) => {
    expect(familyName(author)).toBe(expected)
  })
})

describe('citekeyBase', () => {
  it.each([
    ['a first author and a year', ['Zhao, Li-Dong', 'Chang, Cheng'], 2015, 'zhao2015'],
    ['no year', ['Zhao, Li-Dong'], undefined, `zhao${UNDATED_YEAR}`],
    ['no author', [], 2015, `${ANONYMOUS_FAMILY}2015`],
    ['an author that folds to nothing', ['???'], 2015, `${ANONYMOUS_FAMILY}2015`],
    ['neither', [], undefined, `${ANONYMOUS_FAMILY}${UNDATED_YEAR}`],
  ])('mints from %s', (_case, authors, year, expected) => {
    expect(citekeyBase(authors, year)).toBe(expected)
  })
})

describe('citekeySuffix', () => {
  it.each([
    [0, 'a'],
    [25, 'z'],
    [26, 'aa'],
    [51, 'az'],
    [52, 'ba'],
    [701, 'zz'],
    [702, 'aaa'],
  ])('answers %i with %s', (index, expected) => {
    expect(citekeySuffix(index)).toBe(expected)
  })
})

describe('uniqueCitekey', () => {
  it('returns the base itself when nothing has taken it', () => {
    expect(uniqueCitekey('zhao2015', new Set())).toBe('zhao2015')
  })

  it('walks the suffixes past every key already taken', () => {
    const taken = new Set(['zhao2015', 'zhao2015a', 'zhao2015b'])

    expect(uniqueCitekey('zhao2015', taken)).toBe('zhao2015c')
  })
})

describe('normalizeCitekey', () => {
  it.each([
    ['  zhao2015 ', 'zhao2015'],
    ['zhao 2015', 'zhao2015'],
    ['{zhao,2015}', 'zhao2015'],
    ['zhao"@\\2015', 'zhao2015'],
    ['   ', ''],
  ])('folds %j to %j', (given, expected) => {
    expect(normalizeCitekey(given)).toBe(expected)
  })
})
