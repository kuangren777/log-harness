// The service itself, over a real JSON storage medium: what a second add does
// to a row the user already edited, what the size cap drops, what an upload
// keyed by content lands on, and what a failed PDF download costs the entry.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature/types'
import LibraryRuntime, { draftId, pdfFileName } from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { LIBRARY_ROUTE_PREFIX } from '../src/upload-route.ts'
import { FakeFsService } from './fake-fs.ts'
import { setStubbedRecords, StubLiterature, stubbedQueries } from './stub-literature.ts'

const PDF = new TextEncoder().encode('%PDF-1.7 body')

const RECORD: LiteratureRecord = {
  id: 'doi:10.1103/physrevb.91.205201',
  title: 'Thermoelectric transport in n-type SnSe',
  authors: ['Zhao, Li-Dong'],
  year: 2015,
  doi: '10.1103/physrevb.91.205201',
  url: 'https://doi.org/10.1103/physrevb.91.205201',
  pdfUrl: 'https://arxiv.org/pdf/1501.00001',
  source: 'openalex',
  sources: ['openalex'],
}

let root: string | undefined
let context: Context | undefined

/**
 * Boot the runtime over a temporary JSON storage medium and an in-memory filesystem.
 * @param config - the configuration fields this case cares about.
 * @param withLiterature - whether the soft literature dependency is present.
 * @returns the booted context and its filesystem stub.
 */
async function boot(config: Partial<Config> = {}, withLiterature = true): Promise<{ ctx: Context; fs: FakeFsService }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-library-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Connection)
  await ctx.plugin(FakeFsService)
  const fs = ctx.fs as unknown as FakeFsService
  if (withLiterature) await ctx.plugin(StubLiterature)
  await ctx.plugin(LibraryRuntime, { libraryRoot: '/lib', ...config } as Config)
  return { ctx, fs }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  setStubbedRecords([])
  stubbedQueries.length = 0
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('draftId', () => {
  it('prefers an explicit id, then a DOI, then an arXiv id', () => {
    expect(draftId({ id: 'given' })).toBe('given')
    expect(draftId({ doi: '10.1/X' })).toBe('doi:10.1/x')
    expect(draftId({ arxivId: '2607.09182' })).toBe('arxiv:2607.09182')
  })

  it('mints a note id when nothing identifies the work', () => {
    expect(draftId({ title: 'x' })).toMatch(/^note:[0-9a-f-]{36}$/)
  })

  it('ignores empty identifier strings', () => {
    expect(draftId({ id: '', doi: '', arxivId: '' })).toMatch(/^note:/)
  })
})

describe('pdfFileName', () => {
  it('is the entry directory name with a pdf extension', () => {
    expect(pdfFileName('doi:10.1/x')).toBe('doi-10.1-x.pdf')
  })
})

describe('add', () => {
  it('stores a literature record and reports it as new', async () => {
    const { ctx } = await boot()

    const result = await ctx.sciLibrary.add({ record: RECORD, tags: ['ZT'] })

    expect(result.created).toBe(true)
    expect(result.entry).toMatchObject({ id: RECORD.id, kind: 'paper', tags: ['zt'], doi: RECORD.doi })
  })

  it('stores a hand-written draft under a derived id', async () => {
    const { ctx } = await boot()

    const result = await ctx.sciLibrary.add({ entry: { title: 'My note', kind: 'note' } })

    expect(result.entry.id).toMatch(/^note:/)
    expect(result.entry.sources).toEqual(['manual'])
  })

  it('merges a second add of the same id and says it was not created', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD, tags: ['first'] })
    await ctx.sciLibrary.update({ id: RECORD.id, patch: { status: 'read', title: 'Title I edited' } })

    const again = await ctx.sciLibrary.add({ record: RECORD, tags: ['second'] })

    expect(again.created).toBe(false)
    expect(again.entry).toMatchObject({ title: 'Title I edited', status: 'read', tags: ['first', 'second'] })
  })

  it('refuses a request naming neither a record nor a draft', async () => {
    const { ctx } = await boot()

    await expect(ctx.sciLibrary.add({})).rejects.toMatchObject({ code: 'LIBRARY_INVALID_REQUEST' })
  })

  it('downloads the open-access PDF when asked and attaches it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PDF, { headers: { 'content-type': 'application/pdf' } }))))
    const { ctx, fs } = await boot()

    const result = await ctx.sciLibrary.add({ record: RECORD, withPdf: true })

    expect(result.entry.files).toHaveLength(1)
    expect(result.entry.files[0]?.path).toBe(`doi-10.1103-physrevb.91.205201/${pdfFileName(RECORD.id)}`)
    expect(fs.store.written.get(`/lib/doi-10.1103-physrevb.91.205201/${pdfFileName(RECORD.id)}`)).toEqual(PDF)
  })

  it('keeps the entry and reports the failure class when the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>sign in', { headers: { 'content-type': 'text/html' } }))))
    const { ctx } = await boot()

    const result = await ctx.sciLibrary.add({ record: RECORD, withPdf: true })

    expect(result.fetchError).toBe('LIBRARY_NOT_PDF')
    expect(result.entry.files).toEqual([])
    expect(await ctx.sciLibrary.get({ id: RECORD.id })).toMatchObject({ entry: { id: RECORD.id } })
  })

  it('reports the failure when the entry has no PDF link at all', async () => {
    const { ctx } = await boot()

    const result = await ctx.sciLibrary.add({ entry: { title: 'no pdf' }, withPdf: true })

    expect(result.fetchError).toBe('LIBRARY_NOT_FOUND')
  })

  it('trims the oldest file-less rows once the cap is passed', async () => {
    const { ctx } = await boot({ maxEntries: 2 })

    for (const title of ['one', 'two', 'three']) {
      await ctx.sciLibrary.add({ entry: { title, id: `note:${title}` } })
    }

    const page = await ctx.sciLibrary.list({})
    expect(page.entries.map(row => row.title).sort()).toEqual(['three', 'two'])
  })
})

describe('list', () => {
  /**
   * Fill the library with three entries this suite reads back.
   * @param ctx - the booted context.
   */
  async function seed(ctx: Context): Promise<void> {
    await ctx.sciLibrary.add({ entry: { id: 'a', title: 'SnSe thermoelectric', kind: 'paper', abstract: 'record ZT' }, tags: ['zt'] })
    await ctx.sciLibrary.add({ entry: { id: 'b', title: 'Measurement data', kind: 'dataset' }, tags: ['zt', 'raw'] })
    await ctx.sciLibrary.add({ entry: { id: 'c', title: 'Reading note', kind: 'note', status: 'low-confidence' } })
  }

  it('returns everything newest-first with the facets and the whole-library counts', async () => {
    const { ctx } = await boot()
    await seed(ctx)

    const page = await ctx.sciLibrary.list({})

    expect(page.entries.map(row => row.id)).toEqual(['c', 'b', 'a'])
    expect(page.total).toBe(3)
    expect(page.tags).toEqual([{ tag: 'zt', count: 2 }, { tag: 'raw', count: 1 }])
    expect(page.counts).toEqual({ all: 3, paper: 1, dataset: 1, note: 1, lowConfidence: 1 })
  })

  it('scores a query and drops what it did not match', async () => {
    const { ctx } = await boot()
    await seed(ctx)

    const page = await ctx.sciLibrary.list({ query: 'snse' })

    expect(page.entries.map(row => row.id)).toEqual(['a'])
    expect(page.total).toBe(1)
  })

  it('filters by kind, status, and tag', async () => {
    const { ctx } = await boot()
    await seed(ctx)

    expect((await ctx.sciLibrary.list({ kind: 'dataset' })).entries.map(row => row.id)).toEqual(['b'])
    expect((await ctx.sciLibrary.list({ status: 'low-confidence' })).entries.map(row => row.id)).toEqual(['c'])
    expect((await ctx.sciLibrary.list({ tag: 'raw' })).entries.map(row => row.id)).toEqual(['b'])
  })

  it('pages, and reports the pre-page total', async () => {
    const { ctx } = await boot()
    await seed(ctx)

    const page = await ctx.sciLibrary.list({ limit: 1, offset: 1 })

    expect(page.entries.map(row => row.id)).toEqual(['b'])
    expect(page.total).toBe(3)
  })

  it('keeps the chip counts whole-library even under a filter', async () => {
    const { ctx } = await boot()
    await seed(ctx)

    expect((await ctx.sciLibrary.list({ kind: 'note' })).counts.paper).toBe(1)
  })
})

describe('get, update, remove, related', () => {
  it('reads one entry and reports a missing id rather than throwing', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })

    expect(await ctx.sciLibrary.get({ id: RECORD.id })).toMatchObject({ entry: { title: RECORD.title } })
    expect(await ctx.sciLibrary.get({ id: 'ghost' })).toEqual({ error: 'not-found' })
  })

  it('changes only the fields the patch names', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD, tags: ['zt'] })

    const updated = await ctx.sciLibrary.update({ id: RECORD.id, patch: { status: 'reading', note: 'read section 3' } })

    expect(updated).toMatchObject({ entry: expect.objectContaining({ status: 'reading', note: 'read section 3', tags: ['zt'] }) })
  })

  it('reports a missing id from update rather than creating a row', async () => {
    const { ctx } = await boot()

    expect(await ctx.sciLibrary.update({ id: 'ghost', patch: { status: 'read' } })).toEqual({ error: 'not-found' })
    expect((await ctx.sciLibrary.list({})).total).toBe(0)
  })

  it('drops a row and reports whether one existed', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })

    expect(await ctx.sciLibrary.remove({ id: RECORD.id })).toEqual({ removed: true, filesCleared: 0 })
    expect(await ctx.sciLibrary.remove({ id: RECORD.id })).toEqual({ removed: false, filesCleared: 0 })
  })

  it('empties the files when asked, because the filesystem seam has no removal', async () => {
    const { ctx, fs } = await boot()
    await ctx.sciLibrary.upload('new', 'dataset', { name: 'x.csv', mediaType: 'text/csv', bytes: new Uint8Array([1, 2, 3]) })
    const [stored] = (await ctx.sciLibrary.list({})).entries

    const result = await ctx.sciLibrary.remove({ id: stored?.id ?? '', deleteFiles: true })

    expect(result).toEqual({ removed: true, filesCleared: 1 })
    expect(fs.store.written.get(`/lib/${stored?.files[0]?.path ?? ''}`)).toEqual(new Uint8Array(0))
  })

  it('answers neighbours by the same lexical score, and nothing for an unknown id', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ entry: { id: 'a', title: 'SnSe thermoelectric transport' } })
    await ctx.sciLibrary.add({ entry: { id: 'b', title: 'SnSe crystals' } })
    await ctx.sciLibrary.add({ entry: { id: 'c', title: 'Graphene' } })

    expect((await ctx.sciLibrary.related({ id: 'a' })).entries.map(row => row.id)).toEqual(['b'])
    expect((await ctx.sciLibrary.related({ id: 'ghost' })).entries).toEqual([])
  })

  it('honours the related limit', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ entry: { id: 'a', title: 'snse' } })
    await ctx.sciLibrary.add({ entry: { id: 'b', title: 'snse' } })
    await ctx.sciLibrary.add({ entry: { id: 'c', title: 'snse' } })

    expect((await ctx.sciLibrary.related({ id: 'a', limit: 1 })).entries).toHaveLength(1)
  })
})

describe('fetchPdf', () => {
  it('downloads and attaches the PDF of a stored entry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(PDF, { headers: { 'content-type': 'application/pdf' } }))))
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })

    const result = await ctx.sciLibrary.fetchPdf({ id: RECORD.id })

    expect('entry' in result && result.entry.files).toHaveLength(1)
  })

  it('refuses to resurrect an entry the user removed while the download was in flight', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await ctx.sciLibrary.remove({ id: RECORD.id })
      return new Response(PDF, { headers: { 'content-type': 'application/pdf' } })
    }))

    expect(await ctx.sciLibrary.fetchPdf({ id: RECORD.id })).toEqual({ error: 'LIBRARY_NOT_FOUND' })
    expect((await ctx.sciLibrary.list({})).total).toBe(0)
  })

  it('reports an unknown id and a refused link as codes rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))))
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })

    expect(await ctx.sciLibrary.fetchPdf({ id: 'ghost' })).toEqual({ error: 'LIBRARY_NOT_FOUND' })
    expect(await ctx.sciLibrary.fetchPdf({ id: RECORD.id })).toEqual({ error: 'LIBRARY_FETCH_FAILED' })
  })
})

describe('upload and download', () => {
  const csv = { name: 'data.csv', mediaType: 'text/csv', bytes: new Uint8Array([120, 44, 121]) }

  it('creates an entry keyed by content and attaches the file', async () => {
    const { ctx, fs } = await boot()

    const created = await ctx.sciLibrary.upload('new', undefined, csv)

    expect(created.id).toMatch(/^file:[0-9a-f]{64}$/)
    expect(created.kind).toBe('dataset')
    expect(created.title).toBe('data.csv')
    expect(fs.store.written.get(`/lib/${created.files[0]?.path ?? ''}`)).toEqual(csv.bytes)
  })

  it('takes the kind the caller named, and calls a PDF a paper by default', async () => {
    const { ctx } = await boot()

    const asPaper = await ctx.sciLibrary.upload('new', 'paper', csv)
    const pdf = await ctx.sciLibrary.upload('new', undefined, { name: 'a.pdf', mediaType: 'application/pdf', bytes: PDF })

    expect(asPaper.kind).toBe('paper')
    expect(pdf.kind).toBe('paper')
  })

  it('lands the same bytes on the row that already describes them', async () => {
    const { ctx } = await boot()

    const first = await ctx.sciLibrary.upload('new', undefined, csv)
    const second = await ctx.sciLibrary.upload('new', undefined, csv)

    expect(second.id).toBe(first.id)
    expect((await ctx.sciLibrary.list({})).total).toBe(1)
  })

  it('attaches to a named entry', async () => {
    const { ctx } = await boot()
    await ctx.sciLibrary.add({ record: RECORD })

    const attached = await ctx.sciLibrary.upload(RECORD.id, undefined, csv)

    expect(attached.id).toBe(RECORD.id)
    expect(attached.files.map(stored => stored.name)).toEqual(['data.csv'])
  })

  it('refuses an entry the library does not hold', async () => {
    const { ctx } = await boot()

    await expect(ctx.sciLibrary.upload('ghost', undefined, csv)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('reads a stored file back and refuses one that is not there', async () => {
    const { ctx } = await boot()
    const created = await ctx.sciLibrary.upload('new', undefined, csv)

    expect((await ctx.sciLibrary.download(created.id, 'data.csv')).bytes).toEqual(csv.bytes)
    await expect(ctx.sciLibrary.download(created.id, 'ghost.csv')).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(ctx.sciLibrary.download('ghost', 'data.csv')).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })
})

describe('lookup', () => {
  it('matches a record by DOI, by arXiv id, and by record id', async () => {
    const { ctx } = await boot()
    setStubbedRecords([RECORD])

    expect((await ctx.sciLibrary.lookup('10.1103/PhysRevB.91.205201'))?.id).toBe(RECORD.id)
    expect(stubbedQueries).toEqual(['10.1103/PhysRevB.91.205201'])
  })

  it('answers undefined when nothing in the reply matches the identifier', async () => {
    const { ctx } = await boot()
    setStubbedRecords([{ ...RECORD, doi: '10.9/other', id: 'doi:10.9/other' }])

    expect(await ctx.sciLibrary.lookup('10.1/x')).toBeUndefined()
  })

  it('answers undefined when the literature layer is not composed in', async () => {
    const { ctx } = await boot({}, false)

    expect(await ctx.sciLibrary.lookup('10.1/x')).toBeUndefined()
  })

  it('matches on the arXiv id and on the record id form', async () => {
    const { ctx } = await boot()
    { const { doi: _doi, ...noDoi } = RECORD; setStubbedRecords([{ ...noDoi, arxivId: '2607.09182', id: 'arxiv:2607.09182' }]) }

    expect((await ctx.sciLibrary.lookup('2607.09182'))?.arxivId).toBe('2607.09182')
  })
})

describe('registration', () => {
  it('publishes the two tools, the prompt section, and the route prefix', async () => {
    const { ctx } = await boot()

    expect(ctx.tools.get('library_search')).toBeDefined()
    expect(ctx.tools.get('library_add')).toBeDefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('用户的知识库用 library_search 查')
    expect(() => ctx.webServer.register({ kind: 'prefix', path: LIBRARY_ROUTE_PREFIX, handler: () => {} }))
      .toThrow(/duplicate prefix route/)
  })

  it('exposes the configured file cap the route enforces', async () => {
    const { ctx } = await boot({ maxFileBytes: 99 })

    expect(ctx.sciLibrary.maxFileBytes).toBe(99)
  })

  it('unregisters everything when the composition is disposed', async () => {
    const { ctx } = await boot()
    const tools = ctx.tools

    await ctx.fiber.dispose()
    context = undefined

    expect(tools.get('library_search')).toBeUndefined()
    expect(tools.get('library_add')).toBeUndefined()
  })
})
