// The fan-out itself: request validation, per-source isolation, the failure
// report, and the history the browser view reads back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LiteratureRuntime, {
  LiteratureError,
  MAX_QUERY_LENGTH,
  sourceErrorOf,
  validateRequest,
} from '@deepseek-ai/dsh-sci-literature'
import type { Config } from '@deepseek-ai/dsh-sci-literature'
import { headersOf, stubFetch } from './fetch-stub.ts'
import { fixture, jsonFixture } from './fixtures.ts'

const OPENALEX = JSON.stringify(jsonFixture('openalex.json'))
const CROSSREF = JSON.stringify(jsonFixture('crossref.json'))
const SEMANTIC_SCHOLAR = JSON.stringify(jsonFixture('semanticscholar.json'))
const ARXIV = fixture('arxiv.xml')

/** Reply the recorded fixture of whichever index a request names. */
function recordedReply(url: string): Response {
  if (url.includes('openalex')) return new Response(OPENALEX)
  if (url.includes('semanticscholar')) return new Response(SEMANTIC_SCHOLAR)
  if (url.includes('arxiv')) return new Response(ARXIV)
  return new Response(CROSSREF)
}

let root: string | undefined
let context: Context | undefined

/**
 * Boot the runtime over a temporary JSON storage medium.
 * @param config - the configuration fields this case cares about.
 * @returns the booted context.
 */
async function boot(config: Partial<Config> = {}): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-literature-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LiteratureRuntime, config)
  return ctx
}

beforeEach(() => {
  stubFetch(url => Promise.resolve(recordedReply(url)))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('validateRequest', () => {
  it('trims the query and resolves the default limit', () => {
    expect(validateRequest({ query: '  n-type SnSe ' })).toEqual({ query: 'n-type SnSe', limit: 10 })
  })

  it.each([
    ['a blank query', { query: '   ' }],
    ['a query past the character cap', { query: 'a'.repeat(MAX_QUERY_LENGTH + 1) }],
    ['a limit of zero', { query: 'q', limit: 0 }],
    ['a limit past the cap', { query: 'q', limit: 21 }],
    ['a fractional limit', { query: 'q', limit: 1.5 }],
    ['an inverted year range', { query: 'q', yearFrom: 2024, yearTo: 2020 }],
  ])('refuses %s', (_case, request) => {
    expect(() => validateRequest(request)).toThrow(
      expect.objectContaining({ code: 'LITERATURE_INVALID_REQUEST' }),
    )
  })

  it.each([
    ['the lowest limit', 1],
    ['the highest limit', 20],
  ])('accepts %s', (_case, limit) => {
    expect(validateRequest({ query: 'q', limit }).limit).toBe(limit)
  })

  it('accepts a year range that bounds only one end', () => {
    expect(validateRequest({ query: 'q', yearFrom: 2020 })).toMatchObject({ yearFrom: 2020 })
    expect(validateRequest({ query: 'q', yearTo: 2020 })).toMatchObject({ yearTo: 2020 })
  })
})

describe('sourceErrorOf', () => {
  it.each([
    ['a literature failure', new LiteratureError('nope', 'LITERATURE_SOURCE_TOO_LARGE'), 'LITERATURE_SOURCE_TOO_LARGE'],
    ['a raw abort', new DOMException('stop', 'AbortError'), 'LITERATURE_ABORTED'],
    ['anything else', new Error('boom'), 'LITERATURE_SOURCE_HTTP'],
  ])('classifies %s', (_case, error, code) => {
    expect(sourceErrorOf('arxiv', error)).toMatchObject({ source: 'arxiv', code })
  })

  it('never carries the transport detail into the reported message', () => {
    expect(sourceErrorOf('arxiv', new Error('connect ECONNREFUSED 10.0.0.1:443')).message)
      .toBe('arxiv: request failed')
  })
})

describe('LiteratureRuntime construction', () => {
  it('refuses a composition that configured no sources', async () => {
    await expect(boot({ sources: [] })).rejects.toThrow(/at least one index/)
  })
})

describe('search', () => {
  it('merges the four recorded replies into one ranked list', async () => {
    const ctx = await boot()

    const result = await ctx.sciLiterature.search({ query: 'n-type SnSe thermoelectric' })

    expect(result.sourceErrors).toEqual([])
    expect(result.records).toHaveLength(10)
    expect(result.total).toBe(18)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    // The preprint and the published article are one record with both sources.
    const published = result.records.find(record => record.doi === '10.1103/physrevb.91.205201')
    expect(published?.sources).toEqual(['openalex', 'arxiv'])
    expect(new Set(result.records.map(record => record.id)).size).toBe(result.records.length)
  })

  it('truncates to the requested limit and still reports the merged total', async () => {
    const ctx = await boot()

    const result = await ctx.sciLiterature.search({ query: 'q', limit: 3 })

    expect(result.records).toHaveLength(3)
    expect(result.total).toBe(18)
  })

  it('isolates one failing source and returns the rest', async () => {
    const ctx = await boot()
    stubFetch(url => url.includes('semanticscholar')
      ? Promise.resolve(new Response('rate limited', { status: 429 }))
      : Promise.resolve(recordedReply(url)))

    const result = await ctx.sciLiterature.search({ query: 'q' })

    expect(result.sourceErrors).toEqual([
      { source: 'semanticscholar', code: 'LITERATURE_SOURCE_HTTP', message: 'semanticscholar: replied HTTP 429' },
    ])
    expect(result.records.length).toBeGreaterThan(0)
  })

  it('isolates a source that timed out', async () => {
    const ctx = await boot({ timeoutMs: 20 })
    stubFetch((url, init) => url.includes('arxiv')
      ? new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new DOMException('slow', 'TimeoutError')) })
      })
      : Promise.resolve(recordedReply(url)))

    const result = await ctx.sciLiterature.search({ query: 'q' })

    expect(result.sourceErrors).toEqual([expect.objectContaining({ source: 'arxiv', code: 'LITERATURE_ABORTED' })])
  })

  it('honors the caller signal by cancelling every source', async () => {
    const ctx = await boot()
    const controller = new AbortController()
    // A real fetch rejects an already-aborted signal rather than dispatching,
    // and the abort here lands while `search` is still resolving its options.
    stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      const stop = (): void => { reject(new DOMException('stop', 'AbortError')) }
      if (init?.signal?.aborted === true) stop()
      else init?.signal?.addEventListener('abort', stop)
    }))

    const pending = ctx.sciLiterature.search({ query: 'q' }, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'LITERATURE_ALL_SOURCES_FAILED' }))
  })

  it('fails only when no index answered', async () => {
    const ctx = await boot()
    stubFetch(() => Promise.resolve(new Response('down', { status: 503 })))

    await expect(ctx.sciLiterature.search({ query: 'q' })).rejects.toThrow(
      expect.objectContaining({ code: 'LITERATURE_ALL_SOURCES_FAILED' }),
    )
  })

  it('searches only the sources the deployment configured', async () => {
    const ctx = await boot({ sources: ['crossref'] })

    const result = await ctx.sciLiterature.search({ query: 'q' })

    expect(result.records.every(record => record.source === 'crossref')).toBe(true)
  })

  it('refuses an invalid request before contacting any index', async () => {
    const ctx = await boot()
    const fetchMock = stubFetch(() => Promise.resolve(new Response('{}')))

    await expect(ctx.sciLiterature.search({ query: '' })).rejects.toThrow(
      expect.objectContaining({ code: 'LITERATURE_INVALID_REQUEST' }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the Semantic Scholar key', () => {
  it('is read from the launch environment when no credential seam is mounted', async () => {
    const ctx = await boot()
    ctx.provide('launchEnvironment')
    ctx.launchEnvironment = { get: (name: string) => name === 'S2_API_KEY' ? { value: 's2-key', source: 'process' } : undefined } as never
    const fetchMock = stubFetch(url => Promise.resolve(recordedReply(url)))

    await ctx.sciLiterature.search({ query: 'q' })

    expect(headersOf(fetchMock, 'semanticscholar').get('x-api-key')).toBe('s2-key')
  })

  it('is absent when the environment holds an empty value', async () => {
    const ctx = await boot()
    ctx.provide('launchEnvironment')
    ctx.launchEnvironment = { get: () => ({ value: '', source: 'process' }) } as never
    const fetchMock = stubFetch(url => Promise.resolve(recordedReply(url)))

    await ctx.sciLiterature.search({ query: 'q' })

    expect(headersOf(fetchMock, 'semanticscholar').get('x-api-key')).toBeNull()
  })

  it('is read through the credential seam when one is mounted', async () => {
    const ctx = await boot()
    ctx.provide('credentials')
    ctx.credentials = { resolve: () => Promise.resolve({ value: 'sealed-key' }) } as never
    const fetchMock = stubFetch(url => Promise.resolve(recordedReply(url)))

    await ctx.sciLiterature.search({ query: 'q' })

    expect(headersOf(fetchMock, 'semanticscholar').get('x-api-key')).toBe('sealed-key')
  })

  it('is absent when the credential seam holds nothing', async () => {
    const ctx = await boot()
    ctx.provide('credentials')
    ctx.credentials = { resolve: () => Promise.resolve(undefined) } as never
    const fetchMock = stubFetch(url => Promise.resolve(recordedReply(url)))

    await ctx.sciLiterature.search({ query: 'q' })

    expect(headersOf(fetchMock, 'semanticscholar').get('x-api-key')).toBeNull()
  })

  it('is not looked up at all when the configured name cannot be a credential', async () => {
    const ctx = await boot({ s2ApiKeyEnv: 'not a ref' })
    const resolve = vi.fn(() => Promise.resolve({ value: 'sealed-key' }))
    ctx.provide('credentials')
    ctx.credentials = { resolve } as never

    await ctx.sciLiterature.search({ query: 'q' })

    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('the query history', () => {
  it('records one row per search and serves it back newest first', async () => {
    const ctx = await boot()

    await ctx.sciLiterature.search({ query: 'first query' })
    await ctx.sciLiterature.search({ query: 'second query' })

    const recent = await ctx.sciLiterature.recent()
    expect(recent.entries.map(row => row.query)).toEqual(['second query', 'first query'])
    expect(recent.entries[0]).toMatchObject({ hits: 18 })
    expect(recent.entries[0]?.sourceErrors).toBeUndefined()
  })

  it('moves a repeated query instead of stacking a second chip', async () => {
    const ctx = await boot()

    await ctx.sciLiterature.search({ query: 'n-type SnSe' })
    await ctx.sciLiterature.search({ query: 'other' })
    await ctx.sciLiterature.search({ query: '  N-TYPE   SnSe  ' })

    const recent = await ctx.sciLiterature.recent()
    expect(recent.entries).toHaveLength(2)
    expect(recent.entries[0]?.query).toBe('N-TYPE   SnSe')
  })

  it('stores which sources failed', async () => {
    const ctx = await boot()
    stubFetch(url => url.includes('crossref')
      ? Promise.resolve(new Response('down', { status: 503 }))
      : Promise.resolve(recordedReply(url)))

    await ctx.sciLiterature.search({ query: 'q' })

    expect((await ctx.sciLiterature.recent()).entries[0]?.sourceErrors)
      .toBe('crossref:LITERATURE_SOURCE_HTTP')
  })

  it('drops the oldest rows past the retention limit', async () => {
    const ctx = await boot({ historyLimit: 2 })

    for (const query of ['one', 'two', 'three']) await ctx.sciLiterature.search({ query })

    expect((await ctx.sciLiterature.recent()).entries.map(row => row.query)).toEqual(['three', 'two'])
  })

  it('forgets one row and answers ok for an id it never held', async () => {
    const ctx = await boot()
    await ctx.sciLiterature.search({ query: 'n-type SnSe' })
    const [row] = (await ctx.sciLiterature.recent()).entries

    await expect(ctx.sciLiterature.forget({ id: row?.id ?? '' })).resolves.toEqual({ ok: true })
    expect((await ctx.sciLiterature.recent()).entries).toEqual([])
    await expect(ctx.sciLiterature.forget({ id: 'never-stored' })).resolves.toEqual({ ok: true })
  })
})

describe('the Remote search endpoint', () => {
  it('runs the same search the service method does', async () => {
    const ctx = await boot()

    await expect(ctx.sciLiterature.remoteSearch({ query: 'q', limit: 2 }))
      .resolves.toMatchObject({ total: 18 })
    expect((await ctx.sciLiterature.recent()).entries).toHaveLength(1)
  })
})
