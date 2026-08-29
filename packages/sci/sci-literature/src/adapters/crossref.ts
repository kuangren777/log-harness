/**
 * Crossref adapter.
 *
 * Crossref indexes every registered DOI, including review reports, errata, and
 * supplementary-material stubs that carry a DOI and a title but are not works a
 * model can cite. The query is therefore filtered to `journal-article`, which
 * is the same restriction the recorded fixture was captured under.
 *
 * Abstracts arrive as JATS XML rather than text; `clampAbstract` strips the
 * markup, which is why no XML parser is needed on this path.
 * @module @deepseek-ai/dsh-sci-literature/src/adapters/crossref
 */

import { fetchJson } from '../http.ts'
import { clampAbstract, clampAuthors, cleanTitle, identify, normalizeDoi, optionalFields } from '../merge.ts'
import type { LiteratureAdapterOptions, LiteratureRecord, LiteratureSearchRequest } from '../types.ts'
import { asArray, asCount, asRecord, asString, asYear, buildUrl } from '../wire.ts'

/** Crossref works endpoint. */
export const CROSSREF_ENDPOINT = 'https://api.crossref.org/works'

/** Fields requested from Crossref; anything outside this list is never read. */
export const CROSSREF_SELECT = 'DOI,title,author,issued,container-title,is-referenced-by-count,URL,link,abstract'

/** Record type the adapter accepts; every other registered type is not citable literature. */
export const CROSSREF_TYPE = 'journal-article'

/**
 * Name one Crossref contributor as `Family, Given`.
 * @param entry - one `author` element, untrusted.
 * @returns the name, or an empty string when the entry names nobody.
 */
export function crossrefAuthorName(entry: unknown): string {
  const author = asRecord(entry)
  if (author === undefined) return ''
  const family = asString(author.family)
  const given = asString(author.given)
  if (family === undefined) return asString(author.name) ?? given ?? ''
  return given === undefined ? family : `${family}, ${given}`
}

/**
 * Read the publication year out of a Crossref `issued.date-parts` node.
 * @param issued - the `issued` node, untrusted; its first part may be `[null]`.
 * @returns the year, or `undefined` when the work carries no usable date.
 */
export function crossrefYear(issued: unknown): number | undefined {
  return asYear(asArray(asArray(asRecord(issued)?.['date-parts'])?.[0])?.[0])
}

/**
 * The open-access PDF a Crossref `link` list offers, when it offers one.
 * @param links - the `link` node, untrusted.
 * @returns the first `application/pdf` URL, or `undefined`.
 */
export function crossrefPdfUrl(links: unknown): string | undefined {
  for (const entry of asArray(links) ?? []) {
    const link = asRecord(entry)
    if (asString(link?.['content-type']) === 'application/pdf') {
      const url = asString(link?.URL)
      if (url !== undefined) return url
    }
  }
  return undefined
}

/**
 * Map one Crossref works reply into records.
 * @param payload - the parsed reply, untrusted.
 * @returns one record per usable work, in reply order.
 */
export function mapCrossref(payload: unknown): readonly LiteratureRecord[] {
  const records: LiteratureRecord[] = []
  for (const entry of asArray(asRecord(asRecord(payload)?.message)?.items) ?? []) {
    const work = asRecord(entry)
    if (work === undefined) continue
    const title = cleanTitle(asString(asArray(work.title)?.[0]) ?? '')
    const doi = normalizeDoi(asString(work.DOI) ?? '')
    if (title === undefined || doi === undefined) continue
    const abstract = clampAbstract(asString(work.abstract) ?? '')
    const venue = asString(asArray(work['container-title'])?.[0])
    const year = crossrefYear(work.issued)
    const citedBy = asCount(work['is-referenced-by-count'])
    const pdfUrl = crossrefPdfUrl(work.link)
    records.push(identify({
      title,
      authors: clampAuthors((asArray(work.author) ?? []).map(crossrefAuthorName)),
      ...optionalFields({ year, venue, abstract, pdfUrl, citedBy }),
      doi,
      url: asString(work.URL) ?? `https://doi.org/${doi}`,
      source: 'crossref',
      sources: ['crossref'],
    }))
  }
  return records
}

/**
 * Build the Crossref request URL for one search.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @returns the absolute URL.
 */
export function crossrefUrl(request: LiteratureSearchRequest, options: LiteratureAdapterOptions): string {
  const filters = [`type:${CROSSREF_TYPE}`]
  if (request.yearFrom !== undefined) filters.push(`from-pub-date:${request.yearFrom}-01-01`)
  if (request.yearTo !== undefined) filters.push(`until-pub-date:${request.yearTo}-12-31`)
  return buildUrl(CROSSREF_ENDPOINT, {
    'query.bibliographic': request.query,
    rows: String(options.maxPerSource),
    filter: filters.join(','),
    select: CROSSREF_SELECT,
    mailto: options.mailto,
  })
}

/**
 * Search Crossref.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @param signal - cancellation already merged with this source's timeout.
 * @returns the mapped records, in Crossref rank order.
 */
export async function search(
  request: LiteratureSearchRequest,
  options: LiteratureAdapterOptions,
  signal: AbortSignal,
): Promise<readonly LiteratureRecord[]> {
  const payload = await fetchJson(crossrefUrl(request, options), {
    source: 'crossref',
    headers: { 'user-agent': options.userAgent, accept: 'application/json' },
    signal,
  })
  return mapCrossref(payload)
}
