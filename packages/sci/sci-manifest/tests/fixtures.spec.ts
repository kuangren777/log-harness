import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUNDLE_KINDS,
  validateCanvas,
  validatePaper,
  validateSciplot,
} from '@deepseek-ai/dsh-sci-manifest'
import type { ManifestKind, ValidationResult } from '@deepseek-ai/dsh-sci-manifest'

/** One `expected.json` entry: the error substrings a fixture must produce. */
interface FixtureExpectation {
  readonly errors: readonly string[]
  /** Canvas only: asset paths the injected `assetExists` reports as present. */
  readonly assets?: readonly string[]
}

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/', import.meta.url))

/**
 * Read one kind's fixture directory and pair each JSON file with its expectation.
 * @param kind - manifest kind, which is also the directory name.
 * @returns every fixture in sorted order.
 */
function loadFixtures(kind: ManifestKind): { name: string; json: unknown; expectation: FixtureExpectation }[] {
  const dir = `${FIXTURE_ROOT}${kind}/`
  const expectations = JSON.parse(readFileSync(`${dir}expected.json`, 'utf8')) as Record<string, FixtureExpectation>
  const names = readdirSync(dir).filter(name => name !== 'expected.json').sort()
  expect(Object.keys(expectations).sort(), `${kind}/expected.json must list exactly the fixture files`).toEqual(names)
  return names.map((name) => {
    const expectation = expectations[name]
    if (expectation === undefined) throw new Error(`missing expectation for ${kind}/${name}`)
    return { name, json: JSON.parse(readFileSync(`${dir}${name}`, 'utf8')) as unknown, expectation }
  })
}

/**
 * Validate one fixture with the validator that owns its kind.
 * @param kind - manifest kind selecting the validator.
 * @param json - parsed fixture content.
 * @param expectation - supplies the canvas asset inventory.
 * @returns the validation result.
 */
function validate(kind: ManifestKind, json: unknown, expectation: FixtureExpectation): ValidationResult {
  if (kind === 'paper') return validatePaper(json)
  if (kind === 'sciplot') return validateSciplot(json)
  const assets = new Set(expectation.assets ?? [])
  return validateCanvas(json, { assetExists: relativePath => assets.has(relativePath) })
}

describe.each(BUNDLE_KINDS)('%s fixtures', (kind) => {
  const fixtures = loadFixtures(kind)

  it('ships at least three valid and three invalid examples', () => {
    const valid = fixtures.filter(fixture => fixture.name.startsWith('valid-'))
    const invalid = fixtures.filter(fixture => fixture.name.startsWith('invalid-'))
    expect(valid.length).toBeGreaterThanOrEqual(3)
    expect(invalid.length).toBeGreaterThanOrEqual(3)
    expect(valid.length + invalid.length).toBe(fixtures.length)
  })

  it.each(fixtures.map(fixture => fixture.name))('%s matches its recorded expectation', (name) => {
    const fixture = fixtures.find(candidate => candidate.name === name)
    if (fixture === undefined) throw new Error(`fixture ${name} vanished`)
    const result = validate(kind, fixture.json, fixture.expectation)

    expect(result.kind).toBe(kind)
    expect(result.ok, `${name}: ${result.ok ? '' : result.errors.join(' | ')}`)
      .toBe(fixture.expectation.errors.length === 0)
    if (result.ok) return
    for (const substring of fixture.expectation.errors) {
      expect(result.errors.join('\n')).toContain(substring)
    }
  })
})
