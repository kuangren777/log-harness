// The service itself, over a real JSON storage medium and an in-memory project
// tree: what `add` writes into `refs.bib`, what `rescan` merges back out of it,
// and — the case the whole layer exists for — what a rescan does NOT overwrite.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CitationsRuntime, {
  CITATIONS_NAMESPACE,
  CITATIONS_POOL_FULL,
  CITATIONS_UNKNOWN_CITEKEY,
  CITATIONS_UNKNOWN_GROUP,
  CITATIONS_UNKNOWN_PROJECT,
  CITATIONS_UNRESOLVED,
  QUARANTINE,
  RESERVED_GROUPS,
  SERVICE_KEY,
  UNGROUPED,
} from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { LIBRARY_SERVICE, LITERATURE_SERVICE } from '../src/resolve.ts'
import type { WorkLike } from '../src/resolve.ts'
import { FakeFsService } from './fake-fs.ts'

const ROOT = '/home/user/sci/projects'
const PROJECT = 'snse'
const PAPER = 'p1'
const REFS = `${ROOT}/${PROJECT}/papers/${PAPER}/src/refs.bib`

const WORK: WorkLike = {
  id: 'doi:10.1038/nature13184',
  title: 'Ultralow thermal conductivity in SnSe crystals',
  authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
  year: 2015,
  venue: 'Nature',
  doi: '10.1038/nature13184',
  citedBy: 3000,
  sources: ['openalex', 'crossref'],
}

/** The knowledge base, standing in for `ctx.sciLibrary`. */
class StubLibrary extends Service {
  /** The entry every lookup answers with, or `undefined` for a miss. */
  static entry: (WorkLike & { status?: string }) | undefined

  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, LIBRARY_SERVICE)
  }

  /**
   * @returns the configured entry, in the envelope the real service uses.
   */
  get(): Promise<{ entry?: WorkLike & { status?: string } }> {
    return Promise.resolve(StubLibrary.entry === undefined ? {} : { entry: StubLibrary.entry })
  }
}

/** The literature search, standing in for `ctx.sciLiterature`. */
class StubLiterature extends Service {
  /** The records every search answers with. */
  static records: readonly WorkLike[] = []

  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, LITERATURE_SERVICE)
  }

  /**
   * @returns the configured records.
   */
  search(): Promise<{ records: readonly WorkLike[] }> {
    return Promise.resolve({ records: StubLiterature.records })
  }
}

let root: string | undefined
let context: Context | undefined

/**
 * Boot the runtime over a temporary storage medium and an in-memory project tree.
 * @param config - the configuration fields this case cares about.
 * @param tree - the files the project starts with, by absolute path.
 * @returns the booted context, the service, and the filesystem store.
 */
async function boot(
  config: Partial<Config> = {},
  tree: Readonly<Record<string, string>> = {},
): Promise<{ ctx: Context; citations: CitationsRuntime; fs: FakeFsService }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-citations-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(FakeFsService)
  await ctx.plugin(StubLiterature)
  await ctx.plugin(StubLibrary)
  const fs = ctx.fs as unknown as FakeFsService
  // A project directory the walk can find, plus whatever the case seeded.
  fs.store.dirs.add(`${ROOT}/${PROJECT}`)
  fs.store.dirs.add(`${ROOT}/${PROJECT}/papers/${PAPER}`)
  for (const [path, text] of Object.entries(tree)) fs.store.files.set(path, text)
  await ctx.plugin(CitationsRuntime, { projectRoot: ROOT, ...config } as Config)
  return { ctx, citations: ctx.sciCitations, fs }
}

afterEach(async () => {
  StubLiterature.records = []
  StubLibrary.entry = undefined
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('the published service', () => {
  it('publishes a working service under the documented key, with the documented namespace', async () => {
    const { ctx } = await boot()

    expect(SERVICE_KEY).toBe('sciCitations')
    expect(CITATIONS_NAMESPACE).toBe('sci.citations')
    const published: unknown = ctx.get(SERVICE_KEY)
    expect(await (published as CitationsRuntime).pool({ project: PROJECT })).toMatchObject({ project: PROJECT })
  })

  it('registers both tools, and takes them away when the fiber is disposed', async () => {
    const { ctx } = await boot()
    const tools = ctx.tools
    expect(tools.get('citations_add')).toBeDefined()

    await ctx.fiber.dispose()
    context = undefined

    expect(tools.get('citations_add')).toBeUndefined()
  })
})

describe('projects', () => {
  it('lists each project directory with the paper bundles inside it', async () => {
    const { citations, fs } = await boot()
    fs.store.dirs.add(`${ROOT}/other`)
    fs.store.files.set(`${ROOT}/loose.txt`, 'not a project')

    expect(await citations.projects()).toEqual({
      projects: [
        { slug: 'other', papers: [] },
        { slug: PROJECT, papers: [PAPER] },
      ],
    })
  })

  it('answers nothing when the configured root is not there', async () => {
    const { citations } = await boot({ projectRoot: '/nowhere' })

    expect(await citations.projects()).toEqual({ projects: [] })
  })
})

describe('add', () => {
  it('resolves a DOI, stores the row, and writes the bibliography entry', async () => {
    StubLiterature.records = [WORK]
    const { citations, fs } = await boot()

    const added = await citations.add({ project: PROJECT, doi: '10.1038/nature13184' })

    expect(added.created).toBe(true)
    expect(added.citation).toMatchObject({
      id: `${PROJECT}:zhao2015`,
      citekey: 'zhao2015',
      title: WORK.title,
      confidence: 90,
      quarantined: false,
      group: UNGROUPED,
      uses: 0,
    })
    expect(fs.store.files.get(REFS)).toContain('@article{zhao2015,')
    expect(fs.store.files.get(REFS)).toContain('journal = {Nature}')
  })

  it('converges a repeat add of the same work onto one row, however the DOI is spelled', async () => {
    StubLiterature.records = [WORK]
    const { citations } = await boot()
    const first = await citations.add({ project: PROJECT, doi: '10.1038/nature13184' })

    // The doi:-prefixed spelling of the very same work must not mint a
    // suffixed twin — the duplicate-pool bug a production benchmark run
    // surfaced when the model repeated its adds with record-id spellings.
    const again = await citations.add({ project: PROJECT, doi: 'doi:10.1038/NATURE13184' })

    expect(again.created).toBe(false)
    expect(again.citation.citekey).toBe(first.citation.citekey)
    const pool = await citations.pool({ project: PROJECT })
    expect(pool.citations).toHaveLength(1)
  })

  it('takes a handed-in record without any lookup and mints a de-duplicated citekey', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, record: { title: 'First', authors: ['Zhao'], year: 2015 } })

    const second = await citations.add({ project: PROJECT, record: { title: 'Second', authors: ['Zhao'], year: 2015 } })

    expect(second.citation.citekey).toBe('zhao2015a')
  })

  it('takes the citekey the caller named, folded to what BibTeX accepts', async () => {
    const { citations } = await boot()

    const added = await citations.add({ project: PROJECT, citekey: ' my key ', record: { title: 'T' } })

    expect(added.citation.citekey).toBe('mykey')
  })

  it('refuses a citekey that folds away to nothing', async () => {
    const { citations } = await boot()

    await expect(citations.add({ project: PROJECT, citekey: ' {} ', record: { title: 'T' } })).rejects.toThrow()
  })

  it('merges into an existing citekey, keeping the group and the use count', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'First' } })
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.move({ project: PROJECT, citekey: 'k', group: 'method' })

    const again = await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'Second' }, group: UNGROUPED })

    expect(again.created).toBe(false)
    expect(again.citation).toMatchObject({ title: 'Second', group: 'method' })
  })

  it('files a new citation into the group the caller named', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })

    const added = await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' }, group: 'method' })

    expect(added.citation.group).toBe('method')
  })

  it('refuses a project with no directory rather than writing into nothing', async () => {
    const { citations } = await boot()

    await expect(citations.add({ project: 'absent', record: { title: 'T' } }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNKNOWN_PROJECT }))
  })

  it('refuses a DOI no index holds rather than minting a key that points at nothing', async () => {
    const { citations, fs } = await boot()

    await expect(citations.add({ project: PROJECT, doi: '10.1/missing' }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNRESOLVED }))
    expect(fs.store.files.has(REFS)).toBe(false)
  })

  it('refuses a group that does not exist', async () => {
    const { citations } = await boot()

    await expect(citations.add({ project: PROJECT, record: { title: 'T' }, group: 'nope' }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNKNOWN_GROUP }))
  })

  it('refuses a new citation once the pool is at its configured limit', async () => {
    const { citations } = await boot({ maxCitations: 1 })
    await citations.add({ project: PROJECT, citekey: 'a', record: { title: 'A' } })

    await expect(citations.add({ project: PROJECT, citekey: 'b', record: { title: 'B' } }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_POOL_FULL }))
    await expect(citations.add({ project: PROJECT, citekey: 'a', record: { title: 'A again' } })).resolves.toBeDefined()
  })

  it('stores the row even when the project has no paper bundle to write a bibliography into', async () => {
    const { citations, fs } = await boot()
    fs.store.dirs.delete(`${ROOT}/${PROJECT}/papers/${PAPER}`)

    const added = await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    expect(added.citation.citekey).toBe('k')
    expect(fs.store.files.has(REFS)).toBe(false)
  })

  it('appends into a bibliography that already holds another entry', async () => {
    const { citations, fs } = await boot({}, { [REFS]: '@misc{other, title = {Keep me}}\n' })

    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    expect(fs.store.files.get(REFS)).toContain('@misc{other, title = {Keep me}}')
    expect(fs.store.files.get(REFS)).toContain('@misc{k,')
  })

  it('resolves a knowledge-base id and lets the user’s verdict clamp the score', async () => {
    StubLibrary.entry = { ...WORK, id: 'doi:10.1/x', sources: ['bib'], status: 'verified' }
    const { citations } = await boot()

    const added = await citations.add({ project: PROJECT, libraryId: 'doi:10.1/x' })

    expect(added.citation).toMatchObject({ libraryId: 'doi:10.1/x', confidence: 100, quarantined: false })
  })

  it('resolves an arXiv id through the literature layer', async () => {
    StubLiterature.records = [{ ...WORK, arxivId: '1501.00001' }]
    const { citations } = await boot()

    const added = await citations.add({ project: PROJECT, arxivId: '1501.00001' })

    expect(added.citation.arxivId).toBe('1501.00001')
  })

  it('carries a re-added citation’s note and last scan forward', async () => {
    const { citations } = await boot({}, {
      [`${ROOT}/${PROJECT}/papers/${PAPER}/src/main.tex`]: '\\cite{k}',
    })
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'First' } })
    await citations.update({ project: PROJECT, citekey: 'k', patch: { note: 'keep me' } })
    const scanned = await citations.rescan({ project: PROJECT })
    const before = scanned.pool.citations[0]

    const again = await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'Second' } })

    expect(again.citation).toMatchObject({
      note: 'keep me',
      uses: before?.uses,
      lastScanAt: before?.lastScanAt,
      addedAt: before?.addedAt,
    })
  })

  it('quarantines a weak record without anyone saying so', async () => {
    const { citations } = await boot()

    const added = await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['arxiv'] } })

    expect(added.citation).toMatchObject({ confidence: 15, quarantined: true })
  })
})

describe('groups', () => {
  it('creates a group with a derived key, a palette color, and the next position', async () => {
    const { citations } = await boot()

    const first = await citations.upsertGroup({ project: PROJECT, label: ' Method papers ' })
    const second = await citations.upsertGroup({ project: PROJECT, label: 'Data' })

    expect(first).toEqual({ project: PROJECT, key: 'method-papers', label: 'Method papers', color: '#3b82f6', order: 0 })
    expect(second).toMatchObject({ key: 'data', order: 1, color: '#10b981' })
  })

  it('renames and recolors an existing key, keeping its position', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.upsertGroup({ project: PROJECT, label: 'Data' })

    const renamed = await citations.upsertGroup({ project: PROJECT, key: 'method', label: 'Methods', color: '#000' })

    expect(renamed).toMatchObject({ key: 'method', label: 'Methods', color: '#000', order: 0 })
  })

  it('refuses a blank label and every reserved key', async () => {
    const { citations } = await boot()

    await expect(citations.upsertGroup({ project: PROJECT, label: '  ' })).rejects.toThrow()
    for (const key of RESERVED_GROUPS) {
      await expect(citations.upsertGroup({ project: PROJECT, key, label: 'x' })).rejects.toThrow()
      await expect(citations.removeGroup({ project: PROJECT, key })).rejects.toThrow()
    }
  })

  it('returns the citations of a removed group to ungrouped and leaves the others alone', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.add({ project: PROJECT, citekey: 'a', record: { title: 'A' }, group: 'method' })
    await citations.add({ project: PROJECT, citekey: 'b', record: { title: 'B' } })

    await citations.removeGroup({ project: PROJECT, key: 'method' })

    const after = await citations.pool({ project: PROJECT })
    expect(after.groups).toEqual([])
    expect(after.citations.map(row => row.group)).toEqual([UNGROUPED, UNGROUPED])
  })
})

describe('move and update', () => {
  it('raises the flag on the way into quarantine and lowers it on the way out', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['a', 'b', 'c'], year: 2015, venue: 'Nature' } })

    await citations.move({ project: PROJECT, citekey: 'k', group: QUARANTINE })
    const held = await citations.pool({ project: PROJECT })
    await citations.move({ project: PROJECT, citekey: 'k', group: UNGROUPED })
    const released = await citations.pool({ project: PROJECT })

    expect(held.citations[0]).toMatchObject({ group: QUARANTINE, quarantined: true })
    expect(released.citations[0]).toMatchObject({ group: UNGROUPED, quarantined: false })
  })

  it('keeps a weak citation held back even when moved out of quarantine', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['arxiv'] } })
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })

    await citations.move({ project: PROJECT, citekey: 'k', group: QUARANTINE })
    await citations.move({ project: PROJECT, citekey: 'k', group: 'method' })

    expect((await citations.pool({ project: PROJECT })).citations[0]).toMatchObject({ group: 'method', quarantined: true })
  })

  it('leaves the flag alone when a citation moves between two ordinary groups', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['a', 'b', 'c'], year: 2015, venue: 'Nature' } })

    await citations.move({ project: PROJECT, citekey: 'k', group: 'method' })

    expect((await citations.pool({ project: PROJECT })).citations[0]?.quarantined).toBe(false)
  })

  it('refuses to move an unknown citekey or into an unknown group', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    await expect(citations.move({ project: PROJECT, citekey: 'absent', group: UNGROUPED }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNKNOWN_CITEKEY }))
    await expect(citations.move({ project: PROJECT, citekey: 'k', group: 'nope' }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNKNOWN_GROUP }))
  })

  it('changes the note, the group, and the flag a person owns', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['a', 'b', 'c'], year: 2015, venue: 'Nature' } })

    const updated = await citations.update({
      project: PROJECT,
      citekey: 'k',
      patch: { note: 'read this first', group: 'method', quarantined: true },
    })

    expect(updated).toMatchObject({ note: 'read this first', group: 'method', quarantined: true })
  })

  it('changes nothing the patch did not name', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    const updated = await citations.update({ project: PROJECT, citekey: 'k', patch: {} })

    expect(updated).toMatchObject({ group: UNGROUPED, title: 'T' })
    expect(Object.hasOwn(updated, 'note')).toBe(false)
  })

  it('will not release a weak citation a patch asks it to release', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T', sources: ['arxiv'] } })

    const updated = await citations.update({ project: PROJECT, citekey: 'k', patch: { quarantined: false } })

    expect(updated.quarantined).toBe(true)
  })

  it('refuses an unknown citekey and an unknown group', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    await expect(citations.update({ project: PROJECT, citekey: 'absent', patch: {} })).rejects.toThrow()
    await expect(citations.update({ project: PROJECT, citekey: 'k', patch: { group: 'nope' } })).rejects.toThrow()
  })
})

describe('remove', () => {
  it('drops the row and leaves the bibliography alone by default', async () => {
    const { citations, fs } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    await citations.removeCitation({ project: PROJECT, citekey: 'k' })

    expect((await citations.pool({ project: PROJECT })).citations).toEqual([])
    expect(fs.store.files.get(REFS)).toContain('@misc{k,')
  })

  it('drops the entry from every bibliography, skipping a bundle with none and one without the key', async () => {
    const other = `${ROOT}/${PROJECT}/papers/p3/src/refs.bib`
    const { citations, fs } = await boot({}, { [other]: '@misc{elsewhere}\n' })
    fs.store.dirs.add(`${ROOT}/${PROJECT}/papers/p2`)
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    await citations.removeCitation({ project: PROJECT, citekey: 'k', alsoBib: true })

    expect(fs.store.files.get(REFS)).not.toContain('@misc{k,')
    expect(fs.store.files.get(other)).toBe('@misc{elsewhere}\n')
  })

  it('leaves a bibliography that never held the citekey byte-identical', async () => {
    const { citations, fs } = await boot({}, { [REFS]: '@misc{other}\n' })
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })
    await citations.removeCitation({ project: PROJECT, citekey: 'k', alsoBib: true })
    const once = fs.store.files.get(REFS)

    await citations.add({ project: PROJECT, citekey: 'j', record: { title: 'T' } })
    await citations.removeCitation({ project: PROJECT, citekey: 'j', alsoBib: true })

    expect(fs.store.files.get(REFS)).toBe(once)
  })

  it('refuses an unknown citekey', async () => {
    const { citations } = await boot()

    await expect(citations.removeCitation({ project: PROJECT, citekey: 'absent' })).rejects.toThrow()
  })
})

describe('rescan', () => {
  const HAND_WRITTEN = `@article{hand2020,
  title = {A hand-written entry},
  author = {Someone, A.},
  year = {2020},
  journal = {Some Journal},
}
`

  it('takes in a citekey only the file knew about, and counts what the manuscript cites', async () => {
    const { citations } = await boot({}, {
      [REFS]: HAND_WRITTEN,
      [`${ROOT}/${PROJECT}/papers/${PAPER}/src/main.tex`]: 'as shown \\cite{hand2020} and again \\citep{hand2020}',
      [`${ROOT}/${PROJECT}/workspace/notes.md`]: 'see `[hand2020]`',
    })

    const rescanned = await citations.rescan({ project: PROJECT })

    expect(rescanned.parseErrors).toEqual([])
    expect(rescanned.pool.citations[0]).toMatchObject({
      citekey: 'hand2020',
      title: 'A hand-written entry',
      year: 2020,
      venue: 'Some Journal',
      sources: ['bib'],
      uses: 3,
    })
    expect(rescanned.pool.stats.scannedFiles).toBe(2)
    expect(rescanned.pool.stats.lastScanAt).toBeGreaterThan(0)
  })

  it('reports an unreadable block with the file it was in, instead of dropping it silently', async () => {
    const { citations } = await boot({}, { [REFS]: `${HAND_WRITTEN}\n@article{broken, title = {open` })

    const rescanned = await citations.rescan({ project: PROJECT })

    expect(rescanned.parseErrors).toEqual([
      { path: REFS, line: 8, message: 'braced value is never closed' },
    ])
    expect(rescanned.pool.citations.map(row => row.citekey)).toEqual(['hand2020'])
  })

  it('does not overwrite the half a person decided', async () => {
    const { citations, fs } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.add({ project: PROJECT, citekey: 'hand2020', record: { title: 'Resolved title', sources: ['openalex', 'crossref'], year: 2015, venue: 'Nature', citedBy: 3000 } })
    await citations.update({ project: PROJECT, citekey: 'hand2020', patch: { note: 'keep me', group: 'method' } })
    fs.store.files.set(REFS, HAND_WRITTEN)

    const rescanned = await citations.rescan({ project: PROJECT })

    expect(rescanned.pool.citations[0]).toMatchObject({
      title: 'A hand-written entry',
      year: 2020,
      note: 'keep me',
      group: 'method',
      confidence: 90,
    })
  })

  it('skips an entry whose citekey is empty, which names no work', async () => {
    const { citations } = await boot({}, { [REFS]: '@misc{, title = {Nameless}}\n' })

    expect((await citations.rescan({ project: PROJECT })).pool.citations).toEqual([])
  })

  it('reads a project with no bibliography and no manuscript without failing', async () => {
    const { citations } = await boot()

    const rescanned = await citations.rescan({ project: PROJECT })

    expect(rescanned.pool).toMatchObject({ project: PROJECT, citations: [], groups: [] })
    expect(rescanned.pool.stats.scannedFiles).toBe(0)
  })

  it('refuses a project with no directory', async () => {
    const { citations } = await boot()

    await expect(citations.rescan({ project: 'absent' }))
      .rejects.toThrow(expect.objectContaining({ code: CITATIONS_UNKNOWN_PROJECT }))
  })
})

describe('pool and exportBibtex', () => {
  it('scopes every read to the project asked about', async () => {
    const { citations, fs } = await boot()
    fs.store.dirs.add(`${ROOT}/other`)
    await citations.add({ project: PROJECT, citekey: 'mine', record: { title: 'Mine' } })
    await citations.add({ project: 'other', citekey: 'theirs', record: { title: 'Theirs' } })
    await citations.upsertGroup({ project: 'other', label: 'Theirs' })

    const mine = await citations.pool({ project: PROJECT })

    expect(mine.citations.map(row => row.citekey)).toEqual(['mine'])
    expect(mine.groups).toEqual([])
  })

  it('reports zero scanned files until a scan has run in this process', async () => {
    const { citations } = await boot()
    await citations.add({ project: PROJECT, citekey: 'k', record: { title: 'T' } })

    const before = await citations.pool({ project: PROJECT })

    expect(before.stats).toMatchObject({ total: 1, scannedFiles: 0 })
    expect(Object.hasOwn(before.stats, 'lastScanAt')).toBe(false)
  })

  it('exports the whole pool by citekey, and one group when asked', async () => {
    const { citations } = await boot()
    await citations.upsertGroup({ project: PROJECT, label: 'Method' })
    await citations.add({ project: PROJECT, citekey: 'zeta', record: { title: 'Zeta' } })
    await citations.add({ project: PROJECT, citekey: 'alpha', record: { title: 'Alpha' }, group: 'method' })

    const all = await citations.exportBibtex({ project: PROJECT })
    const one = await citations.exportBibtex({ project: PROJECT, group: 'method' })

    expect(all.bibtex.indexOf('@misc{alpha,')).toBeLessThan(all.bibtex.indexOf('@misc{zeta,'))
    expect(one.bibtex).toBe('@misc{alpha,\n  title = {Alpha},\n}\n')
  })

  it('exports an empty file for a project with nothing in it', async () => {
    const { citations } = await boot()

    expect((await citations.exportBibtex({ project: PROJECT })).bibtex).toBe('')
  })
})
