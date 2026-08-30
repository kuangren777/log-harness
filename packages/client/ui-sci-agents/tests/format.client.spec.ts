/**
 * The readings the three pages put on screen: what each host number turns
 * into, and where each abbreviation switches magnitude.
 */
import { describe, expect, it } from 'vitest'
import { formatClock, formatCount, formatDuration, formatTokens, glyphOf } from '../src/client/format.ts'

describe('glyphOf', () => {
  it('walks the six Greek glyphs in roster order', () => {
    expect([0, 1, 2, 3, 4, 5].map(glyphOf)).toEqual(['α', 'β', 'γ', 'δ', 'ε', 'ζ'])
  })

  it('numbers a seventh persona rather than repeating a glyph', () => {
    expect(glyphOf(6)).toBe('7')
  })
})

describe('formatDuration', () => {
  it('reads under a minute in seconds, with one decimal', () => {
    expect(formatDuration(800)).toBe('0.8s')
    expect(formatDuration(11_600)).toBe('11.6s')
    expect(formatDuration(59_900)).toBe('59.9s')
  })

  it('reads a minute and above as m:ss', () => {
    expect(formatDuration(60_000)).toBe('1:00')
    expect(formatDuration(96_000)).toBe('1:36')
    expect(formatDuration(3_723_000)).toBe('62:03')
  })
})

describe('formatTokens', () => {
  it('leaves a count below a thousand exactly as the host reported it', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('abbreviates at thousands and millions, dropping a bare .0', () => {
    expect(formatTokens(9200)).toBe('9.2K')
    expect(formatTokens(31_000)).toBe('31K')
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(31_000_000)).toBe('31M')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1204)).toBe('1,204')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatClock', () => {
  it('reads a delegation in the reader s own zone, padded throughout', () => {
    // Built from the same local-time components the reading is, so the
    // expectation holds in whatever zone the suite runs in.
    const at = new Date(2026, 7, 30, 14, 2, 41)
    expect(formatClock(at.getTime())).toBe('08-30 14:02:41')

    const early = new Date(2026, 0, 5, 9, 8, 7)
    expect(formatClock(early.getTime())).toBe('01-05 09:08:07')
  })
})
