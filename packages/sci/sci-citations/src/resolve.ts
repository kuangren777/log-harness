/**
 * Turning an identifier into a work, without depending on who can resolve it.
 *
 * The knowledge base (`ctx.sciLibrary`) and the literature search
 * (`ctx.sciLiterature`) are both OPTIONAL here, and both are reached through
 * `ctx.get` behind a structural type rather than an import. That is deliberate:
 * a composition may mount the citation pool without either of them, and this
 * package must not decide their load order or fail to build when one of them is
 * not in the tree. What it costs is that a lookup which is simply not mounted
 * reads the same as one that found nothing — which is the honest answer for the
 * caller either way, since neither produced a work.
 * @module @deepseek-ai/dsh-sci-citations/src/resolve
 */

import type { Context } from '@deepseek-ai/cordis'
import { CitationsError, CITATIONS_UNRESOLVED } from './error.ts'
import { normalizeDoi } from './pool.ts'
import type { CitationRecordInput } from './types.ts'

/** Cordis key of the optional knowledge base. */
export const LIBRARY_SERVICE = 'sciLibrary'

/** Cordis key of the optional literature search. */
export const LITERATURE_SERVICE = 'sciLiterature'

/** Records one literature lookup asks for before giving up on a match. */
export const LOOKUP_LIMIT = 5

/** The bibliographic fields both optional services happen to agree on. */
export interface WorkLike {
  /** Stable id of the work in whichever service returned it. */
  id: string
  /** Work title. */
  title: string
  /** Author names. */
  authors: readonly string[]
  /** Publication year. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** DOI in whatever spelling the service uses. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page. */
  url?: string
  /** Citation count. */
  citedBy?: number
  /** Every source that vouched for the work. */
  sources: readonly string[]
}

/** One knowledge-base entry, which is a {@link WorkLike} plus the user's verdict. */
export interface LibraryEntryLike extends WorkLike {
  /** The user's or model's status for the entry; `verified` and `low-confidence` clamp confidence. */
  status?: string
}

/** The one capability this package needs from `ctx.sciLibrary`. */
export interface CitationLibraryLookup {
  /**
   * Read one entry by id.
   * @param request - the entry id.
   * @returns the entry, or an envelope carrying none.
   */
  get: (request: { id: string }) => Promise<{ entry?: LibraryEntryLike }>
}

/** The one capability this package needs from `ctx.sciLiterature`. */
export interface CitationLiteratureLookup {
  /**
   * Search the bibliographic indexes.
   * @param request - the query and how many records to return.
   * @returns the merged records.
   */
  search: (request: { query: string; limit?: number }) => Promise<{ records: readonly WorkLike[] }>
}

/**
 * A record whose provenance is settled.
 *
 * `sources` is optional on the way in, because a caller handing in a record
 * need not know where it came from, and required here: every path through
 * {@link resolveWork} fills it, so nothing downstream defaults it a second time.
 */
export interface ResolvedRecord extends CitationRecordInput {
  /** Every source that vouched for the work; `['manual']` for a handed-in record. */
  sources: readonly string[]
}

/** One work resolved from somewhere, with the provenance the pool records. */
export interface ResolvedWork {
  /** The bibliographic half, ready to become a citation. */
  record: ResolvedRecord
  /** Knowledge-base id when the library resolved it. */
  libraryId?: string
  /** Library status when the library resolved it; clamps the confidence score. */
  libraryStatus?: string
}

/**
 * Read an optional service without declaring it as a dependency.
 *
 * `ctx.get` rather than `ctx.<name>`: the property proxy is topology-sensitive
 * and answers only for declared injections, while the strict lookup reads the
 * global service store, which is where an optionally-mounted layer is.
 * @param ctx - the plugin context.
 * @param name - the Cordis service key.
 * @returns the service, or `undefined` when this composition has none; the
 *   caller narrows it to the structural type it needs.
 */
export function optionalService(ctx: Context, name: string): unknown {
  return ctx.get(name)
}

/**
 * Project any resolved work onto the record a citation is built from.
 * @param work - the work as one of the optional services returned it.
 * @returns the record, with absent fields left out.
 */
export function recordOf(work: WorkLike): ResolvedRecord {
  const doi = normalizeDoi(work.doi)
  return {
    title: work.title,
    authors: [...work.authors],
    ...work.year === undefined ? {} : { year: work.year },
    ...work.venue === undefined ? {} : { venue: work.venue },
    ...doi === undefined ? {} : { doi },
    ...work.arxivId === undefined ? {} : { arxivId: work.arxivId },
    ...work.url === undefined ? {} : { url: work.url },
    ...work.citedBy === undefined ? {} : { citedBy: work.citedBy },
    sources: [...work.sources],
  }
}

/**
 * Pick the one record a DOI or arXiv id actually named.
 *
 * A search is a ranked guess; an identifier is not. So the match is exact on
 * the identifier the caller gave and the top hit is never taken as a
 * consolation prize — inventing a citation for a DOI the index did not hold is
 * the failure this whole layer exists to prevent.
 * @param records - what the search returned.
 * @param doi - the DOI the caller asked for, already normalized.
 * @param arxivId - the arXiv id the caller asked for.
 * @returns the matching record, or `undefined` when none matched exactly.
 */
export function pickWork(
  records: readonly WorkLike[],
  doi: string | undefined,
  arxivId: string | undefined,
): WorkLike | undefined {
  return records.find((record) => {
    if (doi !== undefined && normalizeDoi(record.doi) === doi) return true
    return arxivId !== undefined && record.arxivId === arxivId
  })
}

/**
 * Resolve whatever the caller named into one work.
 *
 * The order is the order of decreasing doubt: a knowledge-base id names a work
 * the user already vouched for, a handed-in record is the caller's own fact,
 * and a bare DOI or arXiv id has to be looked up before anything can be
 * written into a bibliography.
 * @param ctx - the plugin context the optional services are read from.
 * @param request - what the caller named.
 * @returns the resolved work with its provenance.
 * @throws CitationsError `CITATIONS_UNRESOLVED` when nothing was named, or when
 *   the named identifier resolved to no record.
 */
export async function resolveWork(
  ctx: Context,
  request: { libraryId?: string; record?: CitationRecordInput; doi?: string; arxivId?: string },
): Promise<ResolvedWork> {
  if (request.libraryId !== undefined) {
    const library = optionalService(ctx, LIBRARY_SERVICE) as CitationLibraryLookup | undefined
    const entry = library === undefined ? undefined : (await library.get({ id: request.libraryId })).entry
    if (entry === undefined) {
      throw new CitationsError(`知识库里没有条目 ${request.libraryId}`, CITATIONS_UNRESOLVED)
    }
    return {
      record: recordOf(entry),
      libraryId: entry.id,
      ...entry.status === undefined ? {} : { libraryStatus: entry.status },
    }
  }

  if (request.record !== undefined) {
    const doi = normalizeDoi(request.record.doi)
    return {
      record: {
        ...request.record,
        ...doi === undefined ? {} : { doi },
        sources: [...(request.record.sources ?? ['manual'])],
      },
    }
  }

  const doi = normalizeDoi(request.doi)
  const arxivId = request.arxivId
  const query = doi ?? arxivId
  if (query === undefined) {
    throw new CitationsError('add 需要 library_id、doi、arxiv_id 或一条 record', CITATIONS_UNRESOLVED)
  }
  const literature = optionalService(ctx, LITERATURE_SERVICE) as CitationLiteratureLookup | undefined
  const records = literature === undefined ? [] : (await literature.search({ query, limit: LOOKUP_LIMIT })).records
  const work = pickWork(records, doi, arxivId)
  if (work === undefined) throw new CitationsError(`没有检索到 ${query} 对应的文献`, CITATIONS_UNRESOLVED)
  return { record: recordOf(work) }
}
