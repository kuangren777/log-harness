/**
 * OpenAlex adapter.
 *
 * OpenAlex is the only source that ships an abstract as an inverted index
 * (`{term: [positions]}`) rather than as text, because its licence covers the
 * index but not the prose; {@link rebuildAbstract} puts the words back in
 * position order, which is lossless for the whitespace-joined form and is what
 * the record's plain-text `abstract` field means.
 * @module @deepseek-ai/dsh-sci-literature/src/adapters/openalex
 */

import { fetchJson } from '../http.ts'
import { clampAbstract, clampAuthors, cleanTitle, identify, normalizeArxivId, normalizeDoi, optionalFields } from '../merge.ts'
import type { LiteratureAdapterOptions, LiteratureRecord, LiteratureSearchRequest } from '../types.ts'
import { asArray, asCount, asRecord, asString, asYear, buildUrl } from '../wire.ts'

/** OpenAlex works endpoint. */
export const OPENALEX_ENDPOINT = 'https://api.openalex.org/works'

/** Fields requested from OpenAlex; anything outside this list is never read. */
export const OPENALEX_SELECT = 'id,doi,title,authorships,publication_year,primary_location,cited_by_count,abstract_inverted_index,open_access,ids'

/**
 * Rebuild abstract text from OpenAlex's inverted index.
 * @param inverted - the `{term: [positions]}` map, untrusted.
 * @returns the reconstructed text, or `undefined` when the map is absent or holds no usable position.
 */
export function rebuildAbstract(inverted: unknown): string | undefined {
  const map = asRecord(inverted)
  if (map === undefined) return undefined
  const words = new Map<number, string>()
  for (const [term, positions] of Object.entries(map)) {
    for (const position of asArray(positions) ?? []) {
      const index = asCount(position)
      if (index !== undefined) words.set(index, term)
    }
  }
  const text = [...words.entries()].sort(([left], [right]) => left - right).map(([, term]) => term).join(' ')
  return text === '' ? undefined : text
}

/**
 * Map one OpenAlex works reply into records.
 * @param payload - the parsed reply, untrusted.
 * @returns one record per usable work, in reply order.
 */
export function mapOpenAlex(payload: unknown): readonly LiteratureRecord[] {
  const records: LiteratureRecord[] = []
  for (const entry of asArray(asRecord(payload)?.results) ?? []) {
    const work = asRecord(entry)
    if (work === undefined) continue
    const title = cleanTitle(asString(work.title) ?? '')
    if (title === undefined) continue
    const doi = normalizeDoi(asString(work.doi) ?? asString(asRecord(work.ids)?.doi) ?? '')
    const location = asRecord(work.primary_location)
    const landing = asString(location?.landing_page_url)
    const url = doi !== undefined ? `https://doi.org/${doi}` : landing ?? asString(work.id) ?? OPENALEX_ENDPOINT
    const abstract = rebuildAbstract(work.abstract_inverted_index)
    const clamped = abstract === undefined ? undefined : clampAbstract(abstract)
    const openAccess = asRecord(work.open_access)
    const pdfUrl = openAccess?.is_oa === true
      ? asString(openAccess.oa_url) ?? asString(location?.pdf_url)
      : undefined
    const arxivId = normalizeArxivId(asString(asRecord(work.ids)?.arxiv) ?? '')
    const venue = asString(asRecord(location?.source)?.display_name)
    const year = asYear(work.publication_year)
    const citedBy = asCount(work.cited_by_count)
    records.push(identify({
      title,
      authors: clampAuthors((asArray(work.authorships) ?? []).map(item =>
        asString(asRecord(asRecord(item)?.author)?.display_name) ?? asString(asRecord(item)?.raw_author_name) ?? '')),
      ...optionalFields({ year, venue, abstract: clamped, doi, arxivId, pdfUrl, citedBy }),
      url,
      source: 'openalex',
      sources: ['openalex'],
    }))
  }
  return records
}

/**
 * Build the OpenAlex request URL for one search.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @returns the absolute URL.
 */
export function openAlexUrl(request: LiteratureSearchRequest, options: LiteratureAdapterOptions): string {
  const from = request.yearFrom
  const to = request.yearTo
  return buildUrl(OPENALEX_ENDPOINT, {
    search: request.query,
    'per-page': String(options.maxPerSource),
    select: OPENALEX_SELECT,
    ...from === undefined && to === undefined ? {} : { filter: `publication_year:${from ?? 1000}-${to ?? 9999}` },
    mailto: options.mailto,
  })
}

/**
 * Search OpenAlex.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @param signal - cancellation already merged with this source's timeout.
 * @returns the mapped records, in OpenAlex rank order.
 */
export async function search(
  request: LiteratureSearchRequest,
  options: LiteratureAdapterOptions,
  signal: AbortSignal,
): Promise<readonly LiteratureRecord[]> {
  const payload = await fetchJson(openAlexUrl(request, options), {
    source: 'openalex',
    headers: { 'user-agent': options.userAgent, accept: 'application/json' },
    signal,
  })
  return mapOpenAlex(payload)
}
