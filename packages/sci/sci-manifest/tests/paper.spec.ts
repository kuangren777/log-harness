import { describe, expect, it } from 'vitest'
import { validatePaper } from '@deepseek-ai/dsh-sci-manifest'

/**
 * The manifest from the `clawsgo-paper` skill, with per-case overrides.
 * @param overrides - fields replacing the skill's example values.
 * @returns a paper manifest candidate.
 */
function paper(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    title: 'Attention-based dose-response modeling',
    entry: 'src/main.tex',
    versions: [],
    createdAt: '2026-07-23T08:00:00Z',
    updatedAt: '2026-07-23T08:00:00Z',
    ...overrides,
  }
}

/**
 * Validate a candidate and return its errors.
 * @param candidate - value passed to `validatePaper`.
 * @returns the reported errors, or `[]` when the manifest is valid.
 */
function errorsOf(candidate: unknown): readonly string[] {
  const result = validatePaper(candidate)
  return result.ok ? [] : result.errors
}

describe('validatePaper', () => {
  it('accepts the manifest from the skill', () => {
    expect(validatePaper(paper())).toEqual({ ok: true, kind: 'paper' })
  })

  it('reports the root itself when the value is not a JSON object', () => {
    expect(errorsOf(['not', 'a', 'manifest'])).toEqual(['paper manifest must be a JSON object'])
    expect(errorsOf(null)).toEqual(['paper manifest must be a JSON object'])
    expect(errorsOf('{}')).toEqual(['paper manifest must be a JSON object'])
  })

  it('pins the version discriminator at 1', () => {
    expect(errorsOf(paper({ version: 2 }))).toEqual(['paper manifest.version must be 1'])
  })

  it('requires a non-empty title', () => {
    expect(errorsOf(paper({ title: '' }))).toEqual(['paper manifest.title must be a non-empty string'])
  })

  it('rejects an entry that leaves the bundle', () => {
    expect(errorsOf(paper({ entry: '../other-paper/src/main.tex' }))).toEqual([
      'paper manifest.entry must stay inside the bundle; "../other-paper/src/main.tex" escapes it with ".."',
    ])
    expect(errorsOf(paper({ entry: 'https://example.org/main.tex' }))[0])
      .toContain('not a URL or drive-qualified path')
    expect(errorsOf(paper({ entry: '\\\\server\\share\\main.tex' }))[0]).toContain('not an absolute path')
  })

  it('rejects an entry that is not a .tex file', () => {
    expect(errorsOf(paper({ entry: 'src/main.md' }))).toEqual([
      'paper manifest.entry must name a file with one of these extensions: .tex (got "src/main.md")',
    ])
  })

  it('names a missing entry once, without the extension follow-up', () => {
    expect(errorsOf(paper({ entry: 42 }))).toEqual(['paper manifest.entry must be a non-empty string'])
  })

  it('keeps the platform-owned versions archive an array', () => {
    expect(errorsOf(paper({ versions: {} }))).toEqual(['paper manifest.versions must be an array'])
  })

  it('accepts any row shape inside the platform-owned versions archive', () => {
    expect(validatePaper(paper({ versions: [{ anything: true }, 'v2', 3] })).ok).toBe(true)
  })

  it('requires ISO-8601 UTC timestamps', () => {
    expect(errorsOf(paper({ createdAt: '2026-07-23 08:00:00' }))).toEqual([
      'paper manifest.createdAt must be an ISO-8601 UTC timestamp such as 2026-07-23T08:00:00Z',
    ])
    expect(errorsOf(paper({ updatedAt: 1_753_257_600_000 }))).toEqual([
      'paper manifest.updatedAt must be an ISO-8601 UTC timestamp such as 2026-07-23T08:00:00Z',
    ])
    expect(errorsOf(paper({ updatedAt: '2026-13-01T00:00:00Z' }))).toHaveLength(1)
    expect(validatePaper(paper({ updatedAt: '2026-07-23T23:59:59.999Z' })).ok).toBe(true)
  })

  it('reports every offending field in one pass', () => {
    expect(errorsOf(paper({ version: 0, title: null, versions: 'none' }))).toEqual([
      'paper manifest.version must be 1',
      'paper manifest.title must be a non-empty string',
      'paper manifest.versions must be an array',
    ])
  })
})

describe('strict JSON', () => {
  it('never reaches the validator for a manifest with a trailing comma', () => {
    const text = '{ "version": 1, "title": "t", "entry": "src/main.tex", "versions": [], }'
    expect(() => JSON.parse(text) as unknown).toThrow(SyntaxError)
  })
})
