// Counting what a manuscript actually cites, over the four spellings the
// profile writes in. The ordering of the alternation matters as much as the
// patterns: a backticked mention must not also be read as a bare bracket.
import { describe, expect, it } from 'vitest'
import { CITATION_PATTERN, countUses, mentionedCitekeys } from '../src/scan.ts'

describe('mentionedCitekeys', () => {
  it.each([
    ['a LaTeX cite', '\\cite{zhao2015}', ['zhao2015']],
    ['a comma-joined list', '\\cite{a,b, c}', ['a', 'b', 'c']],
    ['a parenthetical cite', 'text \\citep{zhao2015} more', ['zhao2015']],
    ['a textual cite', '\\citet{zhao2015} showed', ['zhao2015']],
    ['a page-noted cite', '\\cite[p. 5]{zhao2015}', ['zhao2015']],
    ['two page notes', '\\cite[see][p. 5]{zhao2015}', ['zhao2015']],
    ['space before the brace', '\\cite {zhao2015}', ['zhao2015']],
    ['an inline-code mention', 'as in `[zhao2015]` here', ['zhao2015']],
    ['a bare bracket mention', 'as in [zhao2015] here', ['zhao2015']],
    ['an empty cite', '\\cite{}', []],
    ['an empty list item', '\\cite{a,,b}', ['a', 'b']],
    ['a bracket holding a space, which is prose', 'see [not a key] here', []],
    ['prose with no mention at all', 'nothing here', []],
  ])('reads %s', (_case, text, expected) => {
    expect(mentionedCitekeys(text)).toEqual(expected)
  })

  it('counts a backticked mention once, not twice', () => {
    expect(mentionedCitekeys('`[zhao2015]`')).toEqual(['zhao2015'])
  })

  it('keeps repeats and occurrence order', () => {
    expect(mentionedCitekeys('\\cite{b} and [a] and \\citep{b}')).toEqual(['b', 'a', 'b'])
  })

  it('does not resume from a previous call’s position', () => {
    const text = '\\cite{zhao2015}'

    expect(mentionedCitekeys(text)).toEqual(mentionedCitekeys(text))
    expect(CITATION_PATTERN.lastIndex).toBe(0)
  })
})

describe('countUses', () => {
  it('reports zero for a citekey nobody wrote, rather than omitting it', () => {
    const counts = countUses([{ path: '/p/a.md', text: 'nothing' }], ['zhao2015'])

    expect(counts).toEqual({ zhao2015: 0 })
  })

  it('sums across files and ignores a mention of a key it was not asked about', () => {
    const files = [
      { path: '/p/a.tex', text: '\\cite{zhao2015,other} \\citet{zhao2015}' },
      { path: '/p/b.md', text: 'see `[zhao2015]` and [stranger]' },
    ]

    expect(countUses(files, ['zhao2015'])).toEqual({ zhao2015: 3 })
  })

  it('answers an empty object when nothing was asked about', () => {
    expect(countUses([{ path: '/p/a.md', text: '[a]' }], [])).toEqual({})
  })
})
