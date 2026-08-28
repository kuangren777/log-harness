// 07-T2 and the planSync table: changing one file in one skill publishes that
// one file and nothing else, and every plan case (new skill, edited file,
// dropped file, dropped skill, unchanged tree) is pinned against a mocked
// filesystem so the reconciliation never needs a sandbox to be checked.
import { resolve as resolvePosix } from 'node:path/posix'
import { describe, expect, it, vi } from 'vitest'
import {
  MANIFEST_PATH,
  SKILL_ROOT_VARIABLE,
  compareManifestKeys,
  computeSkillHash,
  createSyncFileSystem,
  expandSkillRoot,
  hashFiles,
  nextManifest,
  parseManifest,
  planSync,
  syncSkills,
  type SkillSourceReader,
  type SkillSyncFileSystem,
  type SkillTreeManifest,
} from '@deepseek-ai/dsh-sci-skills'

const SKILL_ROOT = '/host/skills'
const SANDBOX_ROOT = '/home/user/sci/skills'

/**
 * Build a reader over an in-memory tree.
 * @param tree - file content keyed by `<skill>/<relative path>`.
 * @returns the reader.
 */
function reader(tree: Record<string, string>): SkillSourceReader {
  const names = [...new Set(Object.keys(tree).map(path => path.slice(0, path.indexOf('/'))))]
  return {
    listSkillNames: () => Promise.resolve(names),
    listFiles: (directory) => {
      const skill = directory.slice(directory.lastIndexOf('/') + 1)
      return Promise.resolve(Object.keys(tree)
        .filter(path => path.startsWith(`${skill}/`))
        .map(path => path.slice(skill.length + 1)))
    },
    readFile: (directory, relativePath) => {
      const skill = directory.slice(directory.lastIndexOf('/') + 1)
      return Promise.resolve(tree[`${skill}/${relativePath}`]!)
    },
  }
}

/**
 * Build a sandbox double seeded with a manifest.
 * @param files - sandbox file content keyed by absolute path.
 * @returns the double plus its recorded writes and removals.
 */
function sandbox(files = new Map<string, string>()) {
  const writes: string[] = []
  const removals: string[] = []
  const target: SkillSyncFileSystem = {
    read: path => Promise.resolve(files.get(path)),
    exists: path => Promise.resolve(files.has(path)),
    write: (path, content) => {
      writes.push(path)
      files.set(path, content)
      return Promise.resolve()
    },
    remove: (paths) => {
      removals.push(...paths)
      for (const path of paths) files.delete(path)
      return Promise.resolve(paths)
    },
  }
  return { target, files, writes, removals }
}

const TREE = {
  'sci-plot/SKILL.md': '---\nname: sci-plot\n---\nbody',
  'sci-plot/render.py': 'print(1)',
  'pdf/SKILL.md': 'pdf body',
}

describe('computeSkillHash', () => {
  it('folds the per-file digests and changes when one byte changes', async () => {
    const before = await computeSkillHash(`${SKILL_ROOT}/sci-plot`, reader(TREE))
    const after = await computeSkillHash(`${SKILL_ROOT}/sci-plot`, reader({ ...TREE, 'sci-plot/render.py': 'print(2)' }))

    expect(Object.keys(before.files)).toEqual(['SKILL.md', 'render.py'])
    expect(before.hash).toBe(hashFiles(before.files))
    expect(after.files['SKILL.md']).toBe(before.files['SKILL.md'])
    expect(after.files['render.py']).not.toBe(before.files['render.py'])
    expect(after.hash).not.toBe(before.hash)
  })

})

describe('compareManifestKeys', () => {
  it('orders keys by UTF-16 code unit', () => {
    expect(['b', 'A', 'a', 'B'].sort(compareManifestKeys)).toEqual(['A', 'B', 'a', 'b'])
    expect(compareManifestKeys('a', 'a')).toBe(0)
  })

  it('makes a folded digest independent of the order the keys arrived in', () => {
    expect(hashFiles({ 'b.py': '2', 'a.py': '1' })).toBe(hashFiles({ 'a.py': '1', 'b.py': '2' }))
  })
})

describe('planSync', () => {
  const local: SkillTreeManifest = {
    a: { hash: 'ha', files: { 'SKILL.md': '1', 'x.py': '2' } },
    b: { hash: 'hb', files: { 'SKILL.md': '3' } },
  }

  /**
   * Probe reporting every planned no-op as still present in the sandbox.
   * @returns always true.
   */
  const allPublished = () => Promise.resolve(true)

  it.each([
    ['an empty sandbox writes everything', {}, ['a/SKILL.md', 'a/x.py', 'b/SKILL.md'], []],
    ['an identical sandbox writes nothing', local, [], []],
    [
      'one edited file is the only write',
      { ...local, a: { hash: 'ha2', files: { 'SKILL.md': '1', 'x.py': 'OLD' } } },
      ['a/x.py'],
      [],
    ],
    [
      'a file the tree dropped is retracted',
      { ...local, a: { hash: 'ha3', files: { 'SKILL.md': '1', 'x.py': '2', 'gone.py': '9' } } },
      [],
      ['a/gone.py'],
    ],
    [
      'a whole skill the tree dropped is retracted',
      { ...local, c: { hash: 'hc', files: { 'SKILL.md': '7', 'r.py': '8' } } },
      [],
      ['c/SKILL.md', 'c/r.py'],
    ],
  ])('%s', async (_case, remote, write, remove) => {
    await expect(planSync(local, remote as SkillTreeManifest, allPublished)).resolves.toEqual({ write, remove })
  })

  it('re-publishes a file whose digest matches but whose sandbox copy is gone', async () => {
    const absent = vi.fn((path: string) => Promise.resolve(path !== 'a/x.py'))

    await expect(planSync(local, local, absent)).resolves.toEqual({ write: ['a/x.py'], remove: [] })
    expect(absent.mock.calls.map(call => call[0])).toEqual(['a/SKILL.md', 'a/x.py', 'b/SKILL.md'])
  })

  it('probes nothing when every planned entry is already a write', async () => {
    const probe = vi.fn(() => Promise.resolve(true))

    await expect(planSync(local, {}, probe)).resolves.toMatchObject({ write: ['a/SKILL.md', 'a/x.py', 'b/SKILL.md'] })
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('parseManifest', () => {
  it.each([
    ['an absent manifest', undefined],
    ['unparseable JSON', '{not json'],
    ['a JSON array', '[]'],
    ['a null document', 'null'],
  ])('treats %s as empty, forcing a full re-publish', (_case, raw) => {
    expect(parseManifest(raw, () => {})).toEqual({})
  })

  it('drops entries and digests it cannot use', () => {
    expect(parseManifest('{"a":{"files":{"x":"1","y":2}},"b":{},"c":{"files":[]}}', () => {}))
      .toEqual({ a: { hash: hashFiles({ x: '1' }), files: { x: '1' } } })
  })

  // B2: the manifest is a durable file the sandbox side writes, and every key
  // it carries becomes an `rm -f` argument on the next round.
  it('drops the crafted escape keys of a sandbox-written manifest and warns about each', () => {
    const warn = vi.fn<(message: string) => void>()
    const crafted = '{"sci-paper":{"hash":"x","files":{'
      + '"../../../projects/thesis/versions/v1/main.pdf":"deadbeef",'
      + '"../../.ssh/id_ed25519":"deadbeef",'
      + '"../../../../../../etc/hosts":"deadbeef",'
      + '"SKILL.md":"safe"}}}'

    expect(parseManifest(crafted, warn))
      .toEqual({ 'sci-paper': { hash: hashFiles({ 'SKILL.md': 'safe' }), files: { 'SKILL.md': 'safe' } } })
    expect(warn.mock.calls.map(call => call[0])).toEqual([
      'sci-skills ignored sandbox manifest entry "sci-paper/../../../projects/thesis/versions/v1/main.pdf": the file key contains a ".." segment',
      'sci-skills ignored sandbox manifest entry "sci-paper/../../.ssh/id_ed25519": the file key contains a ".." segment',
      'sci-skills ignored sandbox manifest entry "sci-paper/../../../../../../etc/hosts": the file key contains a ".." segment',
    ])
  })

  it.each([
    ['a POSIX-absolute file key', '/etc/hosts', 'is absolute'],
    ['a Windows-absolute file key', '\\windows\\system32', 'is absolute'],
    ['a drive-qualified file key', 'C:/windows/system32', 'is drive-qualified'],
    ['a backslash-separated parent segment', 'a\\..\\..\\secret', 'contains a ".." segment'],
    ['an empty file key', '', 'is empty'],
  ])('drops %s', (_case, key, reason) => {
    const warn = vi.fn<(message: string) => void>()

    expect(parseManifest(`{"a":{"files":{${JSON.stringify(key)}:"1"}}}`, warn))
      .toEqual({ a: { hash: hashFiles({}), files: {} } })
    expect(warn).toHaveBeenCalledWith(`sci-skills ignored sandbox manifest entry "a/${key}": the file key ${reason}`)
  })

  it.each([
    ['a parent-segment skill key', '..', 'contains a ".." segment'],
    ['an absolute skill key', '/etc', 'is absolute'],
    ['a drive-qualified skill key', 'C:', 'is drive-qualified'],
    ['an empty skill key', '', 'is empty'],
    ['a nested skill key', 'a/b', 'contains a path separator'],
  ])('drops the whole entry for %s', (_case, key, reason) => {
    const warn = vi.fn<(message: string) => void>()

    expect(parseManifest(`{${JSON.stringify(key)}:{"files":{"x":"1"}}}`, warn)).toEqual({})
    expect(warn).toHaveBeenCalledWith(`sci-skills ignored sandbox manifest entry "${key}": the skill key ${reason}`)
  })
})

describe('nextManifest', () => {
  it('keeps a planned retraction that did not happen so the next round retries it', () => {
    const local: SkillTreeManifest = { a: { hash: 'ha', files: { 'SKILL.md': '1' } } }
    const remote: SkillTreeManifest = { a: { hash: 'hb', files: { 'SKILL.md': '1', 'gone.py': '9' } } }

    expect(nextManifest(local, remote, ['a/gone.py']).a!.files).toEqual({ 'SKILL.md': '1', 'gone.py': '9' })
  })

  it('re-creates an entry for a retained file whose whole skill left the tree', () => {
    const remote: SkillTreeManifest = { c: { hash: 'hc', files: { 'r.py': '8' } } }

    expect(nextManifest({}, remote, ['c/r.py'])).toEqual({ c: { hash: hashFiles({ 'r.py': '8' }), files: { 'r.py': '8' } } })
  })

  it('ignores a retained path the sandbox never claimed', () => {
    expect(nextManifest({}, {}, ['ghost/x.py'])).toEqual({})
  })
})

describe('expandSkillRoot', () => {
  it('rewrites the skill-root variable to the sandbox path', () => {
    expect(expandSkillRoot(`python3 ${SKILL_ROOT_VARIABLE}/sci-read-image/ocr.py`, SANDBOX_ROOT))
      .toBe(`python3 ${SANDBOX_ROOT}/sci-read-image/ocr.py`)
  })
})

describe('syncSkills', () => {
  /**
   * Publish the whole tree into an empty sandbox.
   * @returns the seeded sandbox double.
   */
  async function publishAll() {
    const target = sandbox()
    await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot', 'pdf'],
      source: reader(TREE),
      target: target.target,
      warn: () => {},
    })
    target.writes.length = 0
    return target
  }

  it('writes every file plus the manifest on a first round', async () => {
    const target = sandbox()

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot', 'pdf'],
      source: reader(TREE),
      target: target.target,
      warn: () => {},
    })

    expect(result).toEqual({ changed: ['pdf/SKILL.md', 'sci-plot/SKILL.md', 'sci-plot/render.py'], removed: [] })
    expect(target.writes).toEqual([
      `${SANDBOX_ROOT}/pdf/SKILL.md`,
      `${SANDBOX_ROOT}/sci-plot/SKILL.md`,
      `${SANDBOX_ROOT}/sci-plot/render.py`,
      `${SANDBOX_ROOT}/${MANIFEST_PATH}`,
    ])
  })

  it('writes only the changed file on a second round', async () => {
    const target = await publishAll()

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot', 'pdf'],
      source: reader({ ...TREE, 'sci-plot/render.py': 'print(2)' }),
      target: target.target,
      warn: () => {},
    })

    expect(result.changed).toEqual(['sci-plot/render.py'])
    expect(target.writes).toEqual([`${SANDBOX_ROOT}/sci-plot/render.py`, `${SANDBOX_ROOT}/${MANIFEST_PATH}`])
    expect(target.files.get(`${SANDBOX_ROOT}/sci-plot/render.py`)).toBe('print(2)')
  })

  it('writes nothing but the manifest when the tree is unchanged', async () => {
    const target = await publishAll()

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot', 'pdf'],
      source: reader(TREE),
      target: target.target,
      warn: () => {},
    })

    expect(result).toEqual({ changed: [], removed: [] })
    expect(target.writes).toEqual([`${SANDBOX_ROOT}/${MANIFEST_PATH}`])
  })

  it('retracts the files of a skill the tree dropped', async () => {
    const target = await publishAll()

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot'],
      source: reader(TREE),
      target: target.target,
      warn: () => {},
    })

    expect(result.removed).toEqual(['pdf/SKILL.md'])
    expect(target.removals).toEqual([`${SANDBOX_ROOT}/pdf/SKILL.md`])
    expect(JSON.parse(target.files.get(`${SANDBOX_ROOT}/${MANIFEST_PATH}`) ?? '')).not.toHaveProperty('pdf')
  })

  it('keeps a file it could not retract in the manifest and out of the result', async () => {
    const target = await publishAll()
    const unableToRemove: SkillSyncFileSystem = { ...target.target, remove: () => Promise.resolve([]) }

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot'],
      source: reader(TREE),
      target: unableToRemove,
      warn: () => {},
    })

    expect(result.removed).toEqual([])
    expect(JSON.parse(target.files.get(`${SANDBOX_ROOT}/${MANIFEST_PATH}`) ?? '')).toHaveProperty('pdf')
  })

  it('re-publishes a file the sandbox lost out of band', async () => {
    const target = await publishAll()
    target.files.delete(`${SANDBOX_ROOT}/sci-plot/render.py`)

    const result = await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['sci-plot', 'pdf'],
      source: reader(TREE),
      target: target.target,
      warn: () => {},
    })

    expect(result.changed).toEqual(['sci-plot/render.py'])
    expect(target.files.get(`${SANDBOX_ROOT}/sci-plot/render.py`)).toBe('print(1)')
  })

  it('expands the skill-root variable while writing', async () => {
    const target = sandbox()

    await syncSkills({
      skillRoot: SKILL_ROOT,
      sandboxRoot: SANDBOX_ROOT,
      names: ['pdf'],
      source: reader({ 'pdf/SKILL.md': `run ${SKILL_ROOT_VARIABLE}/pdf/x.py` }),
      target: target.target,
      warn: () => {},
    })

    expect(target.files.get(`${SANDBOX_ROOT}/pdf/SKILL.md`)).toBe(`run ${SANDBOX_ROOT}/pdf/x.py`)
  })
})

describe('createSyncFileSystem', () => {
  const SANDBOX = '/sandbox'

  /**
   * Build a context double exposing a minimal `fs` and an optional `subprocess`.
   * `resolve` normalizes like the local backend, so a `..` that survived every
   * earlier check still collapses before containment is tested.
   * @param subprocess - the subprocess service double, when one is mounted.
   * @returns the context double plus its recorded filesystem state.
   */
  function context(subprocess?: unknown) {
    const files = new Map<string, string>([['/sandbox/present.txt', 'hello']])
    const fs = {
      resolve: (path: string) => {
        const targetKey = resolvePosix(path)
        return Promise.resolve({ targetKey, displayPath: targetKey })
      },
      stat: (target: { targetKey: string }) =>
        Promise.resolve(files.has(target.targetKey) ? { type: 'file' } : undefined),
      readText: (target: { targetKey: string }) => Promise.resolve(files.get(target.targetKey)!),
      writeText: (target: { targetKey: string }, content: string) => {
        files.set(target.targetKey, content)
        return Promise.resolve({ operation: 'create' })
      },
      processPath: (target: { targetKey: string }) => target.targetKey,
      contains: (parent: { targetKey: string }, child: { targetKey: string }) =>
        child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`),
    }
    const ctx = { fs, get: (name: string) => (name === 'subprocess' ? subprocess : undefined) }
    return { ctx: ctx as never, files }
  }

  it('reads a present file and reports an absent one as undefined', async () => {
    const { ctx } = context()
    const target = createSyncFileSystem(ctx, SANDBOX)

    await expect(target.read('/sandbox/present.txt')).resolves.toBe('hello')
    await expect(target.read('/sandbox/absent.txt')).resolves.toBeUndefined()
  })

  it('probes existence without reading content', async () => {
    const { ctx } = context()
    const target = createSyncFileSystem(ctx, SANDBOX)

    await expect(target.exists('/sandbox/present.txt')).resolves.toBe(true)
    await expect(target.exists('/sandbox/absent.txt')).resolves.toBe(false)
  })

  it('writes through the filesystem', async () => {
    const { ctx, files } = context()

    await createSyncFileSystem(ctx, SANDBOX).write('/sandbox/new.txt', 'body')

    expect(files.get('/sandbox/new.txt')).toBe('body')
  })

  it.each([
    ['no subprocess provider is mounted', undefined, [] as readonly string[]],
    ['there is nothing to retract', { spawn: vi.fn() }, [] as readonly string[]],
  ])('removes nothing when %s', async (_case, subprocess, paths) => {
    const { ctx } = context(subprocess)

    await expect(createSyncFileSystem(ctx, SANDBOX).remove(paths)).resolves.toEqual([])
  })

  it('retracts through rm in the filesystem execution world', async () => {
    const spawn = vi.fn((_spec: { argv: readonly string[]; cwd: string }) => ({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {},
    }))
    const { ctx } = context({ spawn })

    await expect(createSyncFileSystem(ctx, SANDBOX).remove(['/sandbox/a', '/sandbox/b']))
      .resolves.toEqual(['/sandbox/a', '/sandbox/b'])
    expect(spawn.mock.calls[0]![0])
      .toMatchObject({ argv: ['rm', '-f', '--', '/sandbox/a', '/sandbox/b'], cwd: SANDBOX })
  })

  // B2's second lock: even if a traversing path reached this far, `rm` must
  // never be spawned for a target that resolves outside the skill root.
  it('refuses to spawn rm for a target that resolves outside the sandbox skill root', async () => {
    const spawn = vi.fn()
    const { ctx } = context({ spawn })

    await expect(createSyncFileSystem(ctx, SANDBOX).remove(['/sandbox/a', '/sandbox/../etc/hosts']))
      .rejects.toThrow('sci-skills refused to retract "/sandbox/../etc/hosts": it resolves to /etc/hosts, outside the sandbox skill root /sandbox')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('fails loud with the command diagnostics when rm exits non-zero', async () => {
    const spawn = vi.fn(() => ({
      done: Promise.resolve({ exitCode: 1, signal: null }),
      collected: { stderr: { readFrom: () => ({ text: 'permission denied', nextOffset: 17, lossy: false }) } },
    }))
    const { ctx } = context({ spawn })

    await expect(createSyncFileSystem(ctx, SANDBOX).remove(['/sandbox/a']))
      .rejects.toThrow(/could not retract 1 stale skill file\(s\): rm exited 1 permission denied/)
  })

  it('fails loud without diagnostics when rm collected no stderr', async () => {
    const spawn = vi.fn(() => ({ done: Promise.resolve({ exitCode: null, signal: 'SIGKILL' }), collected: {} }))
    const { ctx } = context({ spawn })

    await expect(createSyncFileSystem(ctx, SANDBOX).remove(['/sandbox/a'])).rejects.toThrow(/rm exited null/)
  })
})
