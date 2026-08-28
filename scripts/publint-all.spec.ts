import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const runner = fileURLToPath(new URL('./publint-all.ts', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(options: {
  exportPath?: string
  indexSource?: string
  files?: Record<string, string>
  manifestFiles?: string[]
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-publint-all-'))
  roots.push(root)
  const packageDir = join(root, 'packages/core/probe')
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-probe',
    version: '0.0.1',
    type: 'module',
    license: 'MIT',
    engines: { node: '>=22.19' },
    sideEffects: false,
    files: options.manifestFiles ?? ['lib'],
    exports: { '.': { default: options.exportPath ?? './lib/index.js' } },
  }, null, 2)}\n`)
  writeFileSync(join(packageDir, 'README.md'), '# Probe\n')
  writeFileSync(join(packageDir, 'lib/index.js'), options.indexSource ?? 'export const probe = true\n')
  for (const [path, source] of Object.entries(options.files ?? {})) {
    mkdirSync(join(packageDir, path, '..'), { recursive: true })
    writeFileSync(join(packageDir, path), source)
  }
  writeFileSync(join(packageDir, 'unpublished.js'), 'export const hidden = true\n')
  return root
}

/** A package with no `lib/` output at all (e.g. never built), for the skip case. */
function fixtureWithoutLib(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-publint-all-'))
  roots.push(root)
  const packageDir = join(root, 'packages/core/nolib')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-nolib',
    version: '0.0.1',
    type: 'module',
    license: 'MIT',
    engines: { node: '>=22.19' },
    sideEffects: false,
    files: ['index.js'],
    exports: { '.': { default: './index.js' } },
  }, null, 2)}\n`)
  writeFileSync(join(packageDir, 'README.md'), '# No lib\n')
  writeFileSync(join(packageDir, 'index.js'), 'export const nolib = true\n')
  return root
}

function run(root: string) {
  return spawnSync(process.execPath, [
    '--import', 'tsx', runner,
    '--packages-root', root,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
  })
}

describe('publint package runner', () => {
  it('lints recursively declared files from an in-memory publication view', () => {
    const result = run(fixture())
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('linting 1 package(s)')
    expect(result.stdout).toContain('All good!')
  })

  it('rejects an export that exists in the workspace but is not published', () => {
    const result = run(fixture({ exportPath: './unpublished.js' }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('unpublished.js')
  })

  it('rejects a public export whose built file is missing', () => {
    const result = run(fixture({ exportPath: './lib/missing.js' }))
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('missing.js')
  })

  it('accepts published relative JavaScript and CSS targets', () => {
    const result = run(fixture({
      indexSource: "export { helper } from './helper.js'\nimport './theme.css'\n",
      files: {
        'lib/helper.js': 'export const helper = true\n',
        'lib/theme.css': ':root {}\n',
      },
    }))
    expect(result.status, result.stderr).toBe(0)
  })

  it('rejects unpublished relative JavaScript and CSS targets', () => {
    const result = run(fixture({
      indexSource: "export { helper } from './missing.js'\nimport './missing.css'\n",
    }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('imports "./missing.js"')
    expect(result.stderr).toContain('imports "./missing.css"')
  })
})

describe('lib chunk file-list coverage', () => {
  it('rejects a built lib/*.js chunk unmatched by any files pattern', () => {
    const result = run(fixture({
      manifestFiles: ['lib/index.js'],
      files: { 'lib/plugin-abc.js': 'export const plugin = true\n' },
    }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('@deepseek-ai/dsh-probe')
    expect(result.stderr).toContain('plugin-abc.js')
    expect(result.stderr).toContain('add `lib/*.js` to files')
  })

  it('accepts a built lib/*.js chunk matched by a files glob', () => {
    const result = run(fixture({
      manifestFiles: ['lib/*.js'],
      files: { 'lib/plugin-abc.js': 'export const plugin = true\n' },
    }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('All good!')
  })

  it('skips a package with no lib/ directory', () => {
    const result = run(fixtureWithoutLib())
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('All good!')
  })
})
