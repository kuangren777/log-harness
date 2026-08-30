// The bounded walk over a user's project directory. All three bounds are
// checked with something outside them present, because a limit nothing tests
// against is a limit nobody knows is enforced.
import { describe, expect, it } from 'vitest'
import { SCAN_EXTENSIONS, SCAN_MAX_DEPTH, SCAN_SKIP_DIRS } from '../src/config.ts'
import {
  hasScannedExtension,
  joinPath,
  listDirEntries,
  readTextIfPresent,
  scanTextFiles,
  statPath,
  writeTextFile,
} from '../src/fs-scan.ts'
import { FakeFs } from './fake-fs.ts'

const ROOT = '/home/user/sci/projects/snse'
const LIMITS = { maxBytes: 1000 }

/**
 * A filesystem holding the given files.
 * @param files - path to content.
 * @returns the fake filesystem.
 */
function fsWith(files: Readonly<Record<string, string>>): FakeFs {
  const fs = new FakeFs()
  for (const [path, text] of Object.entries(files)) fs.files.set(path, text)
  return fs
}

describe('joinPath', () => {
  it.each([
    ['one segment', ['/a'], '/a'],
    ['several segments', ['/a', 'b', 'c'], '/a/b/c'],
    ['segments carrying their own separators', ['/a/', '/b/', 'c'], '/a/b/c'],
    ['an empty segment', ['/a', '', 'b'], '/a/b'],
    ['no segment at all', [], ''],
  ])('joins %s', (_case, segments, expected) => {
    expect(joinPath(...segments)).toBe(expected)
  })
})

describe('hasScannedExtension', () => {
  it.each([
    ['paper.md', true],
    ['paper.tex', true],
    ['PAPER.TEX', true],
    ['paper.pdf', false],
    ['refs.bib', false],
    ['md', false],
  ])('answers %s', (name, expected) => {
    expect(hasScannedExtension(name, SCAN_EXTENSIONS)).toBe(expected)
  })
})

describe('statPath', () => {
  it('reports a file, a directory, and an absence', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x' })

    expect(await statPath(fs, `${ROOT}/a.md`)).toMatchObject({ type: 'file' })
    expect(await statPath(fs, ROOT)).toMatchObject({ type: 'directory' })
    expect(await statPath(fs, '/nowhere')).toBeUndefined()
  })

  it('carries an abort signal through to the backend', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x' })

    expect(await statPath(fs, `${ROOT}/a.md`, new AbortController().signal)).toMatchObject({ type: 'file' })
  })
})

describe('listDirEntries', () => {
  it('lists the direct children of a directory', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x', [`${ROOT}/sub/b.md`]: 'y' })

    expect((await listDirEntries(fs, ROOT)).map(entry => [entry.name, entry.type]))
      .toEqual([['a.md', 'file'], ['sub', 'directory']])
  })

  it.each([
    ['a path that is not there', '/nowhere'],
    ['a path that is a file', `${ROOT}/a.md`],
  ])('answers an empty list for %s', async (_case, path) => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x' })

    expect(await listDirEntries(fs, path)).toEqual([])
  })

  it('carries an abort signal through to the backend', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x' })

    expect(await listDirEntries(fs, ROOT, new AbortController().signal)).toHaveLength(1)
  })
})

describe('readTextIfPresent and writeTextFile', () => {
  it('reads a file that is there', async () => {
    expect(await readTextIfPresent(fsWith({ [`${ROOT}/a.md`]: 'x' }), `${ROOT}/a.md`)).toBe('x')
  })

  it.each([
    ['a path that is not there', '/nowhere'],
    ['a path that is a directory', ROOT],
  ])('answers undefined for %s', async (_case, path) => {
    expect(await readTextIfPresent(fsWith({ [`${ROOT}/a.md`]: 'x' }), path)).toBeUndefined()
  })

  it('carries an abort signal through to the backend', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: 'x' })

    expect(await readTextIfPresent(fs, `${ROOT}/a.md`, new AbortController().signal)).toBe('x')
  })

  it('writes through the same seam', async () => {
    const fs = new FakeFs()

    await writeTextFile(fs, `${ROOT}/out.bib`, 'content')

    expect(fs.files.get(`${ROOT}/out.bib`)).toBe('content')
  })
})

describe('scanTextFiles', () => {
  it('reads the scannable files under a root and reports the path each came from', async () => {
    const fs = fsWith({
      [`${ROOT}/paper.tex`]: '\\cite{a}',
      [`${ROOT}/notes.md`]: '[a]',
      [`${ROOT}/figure.png`]: 'binary',
      [`${ROOT}/src/refs.bib`]: '@misc{a}',
    })

    const files = await scanTextFiles(fs, ROOT, LIMITS)

    expect(files.map(file => file.path)).toEqual([`${ROOT}/notes.md`, `${ROOT}/paper.tex`])
  })

  it('answers an empty list for a root that is not there', async () => {
    expect(await scanTextFiles(new FakeFs(), '/nowhere', LIMITS)).toEqual([])
  })

  it.each(SCAN_SKIP_DIRS)('never descends into %s', async (skipped) => {
    const fs = fsWith({ [`${ROOT}/${skipped}/old.md`]: '[a]', [`${ROOT}/keep.md`]: '[a]' })

    expect((await scanTextFiles(fs, ROOT, LIMITS)).map(file => file.path)).toEqual([`${ROOT}/keep.md`])
  })

  it('stops at the depth limit', async () => {
    const deep = Array.from({ length: SCAN_MAX_DEPTH }, (_value, index) => `d${index}`).join('/')
    const fs = fsWith({
      [`${ROOT}/${deep}/too-deep.md`]: '[a]',
      [`${ROOT}/d0/reachable.md`]: '[a]',
    })

    expect((await scanTextFiles(fs, ROOT, LIMITS)).map(file => file.path)).toEqual([`${ROOT}/d0/reachable.md`])
  })

  it('skips a file the listing already reports as too large, without reading it', async () => {
    const fs = fsWith({ [`${ROOT}/huge.md`]: 'x'.repeat(2000), [`${ROOT}/small.md`]: 'x' })

    expect((await scanTextFiles(fs, ROOT, LIMITS)).map(file => file.path)).toEqual([`${ROOT}/small.md`])
  })

  it('drops a file the backend reported no size for once its content proves too large', async () => {
    const fs = fsWith({ [`${ROOT}/huge.md`]: '铜'.repeat(400), [`${ROOT}/small.md`]: 'x' })
    fs.reportSizes = false

    expect((await scanTextFiles(fs, ROOT, LIMITS)).map(file => file.path)).toEqual([`${ROOT}/small.md`])
  })

  it('honours a caller’s own extension, depth, and skip overrides', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: '[a]', [`${ROOT}/b.tex`]: '[a]', [`${ROOT}/keep/c.md`]: '[a]' })

    const files = await scanTextFiles(fs, ROOT, {
      maxBytes: 1000,
      extensions: ['.md'],
      maxDepth: 1,
      skipDirs: ['keep'],
    })

    expect(files.map(file => file.path)).toEqual([`${ROOT}/a.md`])
  })

  it('does not swallow a listing failure: an unreadable manuscript would read as uncited', async () => {
    const fs = fsWith({ [`${ROOT}/sub/a.md`]: '[a]' })
    fs.unreadable.add(`${ROOT}/sub`)

    await expect(scanTextFiles(fs, ROOT, LIMITS)).rejects.toThrow('cannot list')
  })

  it('ignores an entry that is neither a file nor a directory', async () => {
    const fs = fsWith({ [`${ROOT}/a.md`]: '[a]' })
    const listDir = fs.listDir.bind(fs)
    fs.listDir = async target => (await listDir(target)).map(entry => ({ ...entry, type: 'other' as const }))

    expect(await scanTextFiles(fs, ROOT, LIMITS)).toEqual([])
  })
})
