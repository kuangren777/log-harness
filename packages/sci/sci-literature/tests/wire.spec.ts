// The reply narrowing every adapter shares: absent, wrong-typed, and empty all
// read as "no value".
import { describe, expect, it } from 'vitest'
import { asArray, asCount, asRecord, asString, asYear, buildUrl, yearRange } from '@deepseek-ai/dsh-sci-literature'

describe('asRecord', () => {
  it.each([
    ['an object', { a: 1 }, { a: 1 }],
    ['null', null, undefined],
    ['an array', [1], undefined],
    ['a string', 'a', undefined],
  ])('narrows %s', (_case, value, expected) => {
    expect(asRecord(value)).toEqual(expected)
  })
})

describe('asArray', () => {
  it.each([
    ['an array', [1], [1]],
    ['an object', { a: 1 }, undefined],
  ])('narrows %s', (_case, value, expected) => {
    expect(asArray(value)).toEqual(expected)
  })
})

describe('asString', () => {
  it.each([
    ['a non-empty string', 'a', 'a'],
    ['an empty string', '', undefined],
    ['a blank string', '   ', undefined],
    ['a number', 1, undefined],
    ['null', null, undefined],
  ])('narrows %s', (_case, value, expected) => {
    expect(asString(value)).toBe(expected)
  })
})

describe('asCount', () => {
  it.each([
    ['zero', 0, 0],
    ['a positive integer', 41, 41],
    ['a negative integer', -1, undefined],
    ['a fraction', 1.5, undefined],
    ['a string', '1', undefined],
  ])('narrows %s', (_case, value, expected) => {
    expect(asCount(value)).toBe(expected)
  })
})

describe('asYear', () => {
  it.each([
    ['a four-digit year', 2020, 2020],
    ['a year below the range', 999, undefined],
    ['a year above the range', 10000, undefined],
    ['a fraction', 2020.5, undefined],
    ['null', null, undefined],
  ])('narrows %s', (_case, value, expected) => {
    expect(asYear(value)).toBe(expected)
  })
})

describe('buildUrl', () => {
  it('drops absent and empty parameters', () => {
    expect(buildUrl('https://api.openalex.org/works', { search: 'a b', mailto: '', page: undefined }))
      .toBe('https://api.openalex.org/works?search=a+b')
  })

  it('returns the bare endpoint when nothing survives', () => {
    expect(buildUrl('https://api.openalex.org/works', { mailto: '' })).toBe('https://api.openalex.org/works')
  })
})

describe('yearRange', () => {
  it.each([
    [2020, 2024, '2020-2024'],
    [2020, undefined, '2020-'],
    [undefined, 2024, '-2024'],
    [undefined, undefined, undefined],
  ])('renders %s..%s', (from, to, expected) => {
    expect(yearRange(from, to)).toBe(expected)
  })
})
