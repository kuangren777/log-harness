/**
 * Semantic Scholar adapter.
 *
 * The only source with an optional credential: the graph API answers keyless at
 * a low shared-IP rate limit, so a missing key is not a failure — it is the
 * ordinary case, and a `429` from the shared pool lands in `sourceErrors` while
 * the other three sources still answer.
 * @module @deepseek-ai/dsh-sci-literature/src/adapters/semanticscholar
 */

import { fetchJson } from '../http.ts'
import { clampAbstract, clampAuthors, cleanTitle, identify, normalizeArxivId, normalizeDoi, optionalFields } from '../merge.ts'
import type { LiteratureAdapterOptions, LiteratureRecord, LiteratureSearchRequest } from '../types.ts'
import { asArray, asCount, asRecord, asString, asYear, buildUrl, yearRange } from '../wire.ts'

/** Semantic Scholar paper-search endpoint. */
export const SEMANTIC_SCHOLAR_ENDPOINT = 'https://api.semanticscholar.org/graph/v1/paper/search'

/** Fields requested from Semantic Scholar; anything outside this list is never read. */
export const SEMANTIC_SCHOLAR_FIELDS = 'title,authors,year,venue,abstract,externalIds,citationCount,openAccessPdf,url'

/**
 * Map one Semantic Scholar search reply into records.
 * @param payload - the parsed reply, untrusted.
 * @returns one record per usable paper, in reply order.
 */
export function mapSemanticScholar(payload: unknown): readonly LiteratureRecord[] {
  const records: LiteratureRecord[] = []
  for (const entry of asArray(asRecord(payload)?.data) ?? []) {
    const paper = asRecord(entry)
    if (paper === undefined) continue
    const title = cleanTitle(asString(paper.title) ?? '')
    if (title === undefined) continue
    const external = asRecord(paper.externalIds)
    const doi = normalizeDoi(asString(external?.DOI) ?? '')
    const arxivId = normalizeArxivId(asString(external?.ArXiv) ?? '')
    const url = doi !== undefined
      ? `https://doi.org/${doi}`
      : asString(paper.url) ?? (arxivId === undefined ? SEMANTIC_SCHOLAR_ENDPOINT : `https://arxiv.org/abs/${arxivId}`)
    const abstract = clampAbstract(asString(paper.abstract) ?? '')
    const venue = asString(paper.venue)
    const year = asYear(paper.year)
    const citedBy = asCount(paper.citationCount)
    const pdfUrl = asString(asRecord(paper.openAccessPdf)?.url)
    records.push(identify({
      title,
      authors: clampAuthors((asArray(paper.authors) ?? []).map(item => asString(asRecord(item)?.name) ?? '')),
      ...optionalFields({ year, venue, abstract, doi, arxivId, pdfUrl, citedBy }),
      url,
      source: 'semanticscholar',
      sources: ['semanticscholar'],
    }))
  }
  return records
}

/**
 * Build the Semantic Scholar request URL for one search.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @returns the absolute URL.
 */
export function semanticScholarUrl(request: LiteratureSearchRequest, options: LiteratureAdapterOptions): string {
  return buildUrl(SEMANTIC_SCHOLAR_ENDPOINT, {
    query: request.query,
    limit: String(options.maxPerSource),
    fields: SEMANTIC_SCHOLAR_FIELDS,
    year: yearRange(request.yearFrom, request.yearTo),
  })
}

/**
 * Search Semantic Scholar.
 * @param request - the validated search request.
 * @param options - the resolved adapter options; `apiKey` raises the rate limit when present.
 * @param signal - cancellation already merged with this source's timeout.
 * @returns the mapped records, in Semantic Scholar rank order.
 */
export async function search(
  request: LiteratureSearchRequest,
  options: LiteratureAdapterOptions,
  signal: AbortSignal,
): Promise<readonly LiteratureRecord[]> {
  const payload = await fetchJson(semanticScholarUrl(request, options), {
    source: 'semanticscholar',
    headers: {
      'user-agent': options.userAgent,
      accept: 'application/json',
      ...options.apiKey === undefined ? {} : { 'x-api-key': options.apiKey },
    },
    signal,
  })
  return mapSemanticScholar(payload)
}
