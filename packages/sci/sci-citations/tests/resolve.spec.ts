// Turning an identifier into a work. The two lookups are optional services, so
// every case here is run twice in spirit: once with the service mounted and
// once without, because a composition may carry the citation pool alone.
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { CITATIONS_UNRESOLVED, CitationsError } from '../src/error.ts'
import {
  LIBRARY_SERVICE,
  LITERATURE_SERVICE,
  LOOKUP_LIMIT,
  optionalService,
  pickWork,
  recordOf,
  resolveWork,
} from '../src/resolve.ts'
import type { CitationLiteratureLookup, LibraryEntryLike, WorkLike } from '../src/resolve.ts'

const WORK: WorkLike = {
  id: 'doi:10.1038/nature13184',
  title: 'Ultralow thermal conductivity in SnSe crystals',
  authors: ['Zhao, Li-Dong'],
  year: 2015,
  venue: 'Nature',
  doi: 'https://doi.org/10.1038/NATURE13184',
  arxivId: '1501.00001',
  url: 'https://example.org/p',
  citedBy: 3000,
  sources: ['openalex', 'crossref'],
}

/** The knowledge base, standing in for `ctx.sciLibrary`. */
class StubLibrary extends Service {
  /** The entry every lookup answers with, or `undefined` for a miss. */
  static entry: LibraryEntryLike | undefined

  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, LIBRARY_SERVICE)
  }

  /**
   * @returns the configured entry, in the envelope the real service uses.
   */
  get(): Promise<{ entry?: LibraryEntryLike }> {
    return Promise.resolve(StubLibrary.entry === undefined ? {} : { entry: StubLibrary.entry })
  }
}

/** The literature search, standing in for `ctx.sciLiterature`. */
class StubLiterature extends Service {
  /** The records every search answers with. */
  static records: readonly WorkLike[] = []

  /** Every request the suite sent. */
  static readonly requests: { query: string; limit?: number }[] = []

  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, LITERATURE_SERVICE)
  }

  /**
   * @param request - the query and the record budget.
   * @returns the configured records.
   */
  search(request: { query: string; limit?: number }): Promise<{ records: readonly WorkLike[] }> {
    StubLiterature.requests.push(request)
    return Promise.resolve({ records: StubLiterature.records })
  }
}

/**
 * A context carrying whichever optional services a case needs.
 * @param services - the stubs to mount.
 * @returns the context.
 */
async function contextWith(...services: (typeof StubLibrary | typeof StubLiterature)[]): Promise<Context> {
  const ctx = new Context()
  for (const service of services) await ctx.plugin(service)
  return ctx
}

describe('optionalService', () => {
  it('reads a mounted service and answers undefined for one nothing published', async () => {
    const ctx = await contextWith(StubLibrary)

    expect(optionalService(ctx, LIBRARY_SERVICE)).toBeDefined()
    expect(optionalService(ctx, LITERATURE_SERVICE)).toBeUndefined()

    await ctx.fiber.dispose()
  })
})

describe('recordOf', () => {
  it('normalizes the DOI and copies every field the work carried', () => {
    expect(recordOf(WORK)).toEqual({
      title: WORK.title,
      authors: ['Zhao, Li-Dong'],
      year: 2015,
      venue: 'Nature',
      doi: '10.1038/nature13184',
      arxivId: '1501.00001',
      url: 'https://example.org/p',
      citedBy: 3000,
      sources: ['openalex', 'crossref'],
    })
  })

  it('leaves out every field the work did not carry', () => {
    expect(recordOf({ id: 'x', title: 'T', authors: [], sources: ['manual'] }))
      .toEqual({ title: 'T', authors: [], sources: ['manual'] })
  })
})

describe('pickWork', () => {
  it('matches a DOI however either side spelled it', () => {
    expect(pickWork([WORK], '10.1038/nature13184', undefined)).toBe(WORK)
  })

  it('matches an arXiv id when no DOI was asked for', () => {
    expect(pickWork([WORK], undefined, '1501.00001')).toBe(WORK)
  })

  it('takes no consolation prize when nothing matched exactly', () => {
    expect(pickWork([WORK], '10.1/other', undefined)).toBeUndefined()
    expect(pickWork([], undefined, '1501.00001')).toBeUndefined()
  })
})

describe('resolveWork', () => {
  it('prefers a knowledge-base id and carries the status that clamps confidence', async () => {
    StubLibrary.entry = { ...WORK, status: 'verified' }
    const ctx = await contextWith(StubLibrary)

    const resolved = await resolveWork(ctx, { libraryId: 'doi:10.1038/nature13184' })

    expect(resolved.libraryId).toBe(WORK.id)
    expect(resolved.libraryStatus).toBe('verified')
    expect(resolved.record.doi).toBe('10.1038/nature13184')

    await ctx.fiber.dispose()
  })

  it('leaves the status out for an entry the user has not judged', async () => {
    StubLibrary.entry = { ...WORK }
    const ctx = await contextWith(StubLibrary)

    const resolved = await resolveWork(ctx, { libraryId: 'doi:10.1038/nature13184' })

    expect(Object.hasOwn(resolved, 'libraryStatus')).toBe(false)

    await ctx.fiber.dispose()
  })

  it.each([
    ['the entry is absent', true],
    ['the knowledge base is not mounted at all', false],
  ])('refuses a library id when %s', async (_case, mounted) => {
    StubLibrary.entry = undefined
    const ctx = mounted ? await contextWith(StubLibrary) : new Context()

    await expect(resolveWork(ctx, { libraryId: 'note:1' })).rejects.toThrow(
      expect.objectContaining({ code: CITATIONS_UNRESOLVED }),
    )

    await ctx.fiber.dispose()
  })

  it('takes a handed-in record as the caller’s own fact, normalizing the DOI', async () => {
    const ctx = new Context()

    const resolved = await resolveWork(ctx, { record: { title: 'T', doi: 'DOI: 10.1/X' } })

    expect(resolved.record).toEqual({ title: 'T', doi: '10.1/x', sources: ['manual'] })
    expect(Object.hasOwn(resolved, 'libraryId')).toBe(false)

    await ctx.fiber.dispose()
  })

  it('keeps the sources a handed-in record named', async () => {
    const ctx = new Context()

    const resolved = await resolveWork(ctx, { record: { title: 'T', sources: ['openalex'] } })

    expect(resolved.record.sources).toEqual(['openalex'])

    await ctx.fiber.dispose()
  })

  it('looks a DOI up through the literature layer, asking for the documented budget', async () => {
    StubLiterature.records = [WORK]
    StubLiterature.requests.length = 0
    const ctx = await contextWith(StubLiterature)

    const resolved = await resolveWork(ctx, { doi: 'https://doi.org/10.1038/nature13184' })

    expect(resolved.record.title).toBe(WORK.title)
    expect(StubLiterature.requests).toEqual([{ query: '10.1038/nature13184', limit: LOOKUP_LIMIT }])

    await ctx.fiber.dispose()
  })

  it('looks an arXiv id up when no DOI was given', async () => {
    StubLiterature.records = [WORK]
    StubLiterature.requests.length = 0
    const ctx = await contextWith(StubLiterature)

    await resolveWork(ctx, { arxivId: '1501.00001' })

    expect(StubLiterature.requests).toEqual([{ query: '1501.00001', limit: LOOKUP_LIMIT }])

    await ctx.fiber.dispose()
  })

  it.each([
    ['the index held nothing matching', true],
    ['the literature layer is not mounted at all', false],
  ])('refuses rather than inventing a citation when %s', async (_case, mounted) => {
    StubLiterature.records = []
    const ctx = mounted ? await contextWith(StubLiterature) : new Context()

    await expect(resolveWork(ctx, { doi: '10.1/missing' })).rejects.toThrow(
      expect.objectContaining({ code: CITATIONS_UNRESOLVED }),
    )

    await ctx.fiber.dispose()
  })

  it('refuses a request that named nothing to resolve', async () => {
    const ctx = new Context()

    await expect(resolveWork(ctx, {})).rejects.toThrow(CitationsError)

    await ctx.fiber.dispose()
  })

  it('treats an empty DOI string as no DOI at all', async () => {
    const ctx = new Context()

    await expect(resolveWork(ctx, { doi: '  ' })).rejects.toThrow(
      expect.objectContaining({ code: CITATIONS_UNRESOLVED }),
    )

    await ctx.fiber.dispose()
  })
})

describe('the literature capability this package declares', () => {
  it('is satisfied by a plain service, which is what keeps the dependency structural', async () => {
    StubLiterature.records = [WORK]
    const lookup: CitationLiteratureLookup = new StubLiterature(new Context())

    expect((await lookup.search({ query: '10.1/x' })).records).toEqual([WORK])
  })
})
