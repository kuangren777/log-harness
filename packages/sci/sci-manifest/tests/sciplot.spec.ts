import { describe, expect, it } from 'vitest'
import { validateSciplot } from '@deepseek-ai/dsh-sci-manifest'

/**
 * The manifest from the `clawsgo-sciplot` skill, with per-case overrides.
 * @param overrides - fields replacing the skill's example values.
 * @returns a sciplot manifest candidate.
 */
function sciplot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: 'Treatment effect by group',
    language: 'en',
    style: 'nature',
    entry: 'code/plot.py',
    history: [],
    annotations: [],
    ...overrides,
  }
}

/**
 * Validate a candidate and return its errors.
 * @param candidate - value passed to `validateSciplot`.
 * @returns the reported errors, or `[]` when the manifest is valid.
 */
function errorsOf(candidate: unknown): readonly string[] {
  const result = validateSciplot(candidate)
  return result.ok ? [] : result.errors
}

describe('validateSciplot', () => {
  it('accepts the manifest from the skill', () => {
    expect(validateSciplot(sciplot())).toEqual({ ok: true, kind: 'sciplot' })
  })

  it('reports the root itself when the value is not a JSON object', () => {
    expect(errorsOf(7)).toEqual(['sciplot manifest must be a JSON object'])
  })

  it('requires the figure language that every label follows', () => {
    expect(errorsOf(sciplot({ language: '' }))).toEqual(['sciplot manifest.language must be a non-empty string'])
  })

  it('accepts a preset name or the user own wording for style', () => {
    expect(validateSciplot(sciplot({ style: 'ieee' })).ok).toBe(true)
    expect(validateSciplot(sciplot({ style: 'two-column, grayscale-safe dashes' })).ok).toBe(true)
    expect(errorsOf(sciplot({ style: null }))).toEqual(['sciplot manifest.style must be a non-empty string'])
  })

  it('accepts every render-script language and ignores extension case', () => {
    for (const entry of ['code/plot.py', 'code/plot.R', 'code/render.sh', 'code/plot.jl']) {
      expect(validateSciplot(sciplot({ entry })).ok, entry).toBe(true)
    }
  })

  it('rejects an entry the render script cannot run', () => {
    expect(errorsOf(sciplot({ entry: 'code/plot.js' }))).toEqual([
      'sciplot manifest.entry must name a file with one of these extensions: .py, .r, .sh, .jl (got "code/plot.js")',
    ])
  })

  it('keeps the render-script-owned and user-owned arrays arrays', () => {
    expect(errorsOf(sciplot({ history: null }))).toEqual(['sciplot manifest.history must be an array'])
    expect(errorsOf(sciplot({ annotations: 'none' }))).toEqual(['sciplot manifest.annotations must be an array'])
  })

  it('leaves the render-script-owned output field unconstrained', () => {
    expect(validateSciplot(sciplot({ output: 'versions/v2/figure.png' })).ok).toBe(true)
    expect(validateSciplot(sciplot({ output: { png: 'figure.png', svg: 'figure.svg' } })).ok).toBe(true)
  })

  it('accepts annotation rows of any shape', () => {
    const annotations = [{ id: 'a1', rect: [0.1, 0.2, 0.3, 0.15], comment: 'legend overlaps', resolved: false }]
    expect(validateSciplot(sciplot({ annotations })).ok).toBe(true)
  })

  it('reports every offending field in one pass', () => {
    expect(errorsOf(sciplot({ version: 2, title: '', entry: '/abs/plot.py' }))).toEqual([
      'sciplot manifest.version must be 1',
      'sciplot manifest.title must be a non-empty string',
      'sciplot manifest.entry must be a bundle-relative path, not an absolute path: "/abs/plot.py"',
    ])
  })
})
