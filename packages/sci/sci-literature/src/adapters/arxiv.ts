/**
 * arXiv adapter and the minimal Atom reader it needs.
 *
 * arXiv publishes no JSON, and the harness runs on Node, where there is no
 * `DOMParser` and no bundled XML parser. The reader below therefore covers
 * exactly the seven elements the record type needs — `id`, `title`, `summary`,
 * `author/name`, `published`, the `title="pdf"` link, and the `arxiv:doi` and
 * `arxiv:journal_ref` extensions — and nothing else. It is a reader for this
 * one feed, not an XML parser: it assumes the well-formed, namespace-prefixed,
 * CDATA-free output the arXiv API actually produces, and a feed shaped
 * differently yields fewer records rather than a wrong one.
 * @module @deepseek-ai/dsh-sci-literature/src/adapters/arxiv
 */

import { fetchText } from '../http.ts'
import { clampAbstract, clampAuthors, cleanTitle, identify, normalizeArxivId, normalizeDoi, optionalFields } from '../merge.ts'
import type { LiteratureAdapterOptions, LiteratureRecord, LiteratureSearchRequest } from '../types.ts'
import { buildUrl } from '../wire.ts'

/** arXiv Atom query endpoint. */
export const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query'

/** The five XML entities an Atom feed may use, plus numeric references. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * The first capture group of one match.
 *
 * Every pattern in this reader has exactly one non-optional group, so the group
 * is present whenever the match is. The empty answer exists because an index
 * signature cannot state that, and this is the module's one place to say it.
 * @param match - one regular-expression match.
 * @returns the captured text, empty for a match with no group.
 */
export function captured(match: { readonly [index: number]: string | undefined }): string {
  return match[1] ?? ''
}

/**
 * Decode the XML entities an Atom text node may carry.
 * @param text - the raw element text.
 * @returns the decoded text; an unrecognized entity is left as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match: string, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * Read the text of the first `<name>` element in a fragment.
 * @param fragment - the XML fragment to search.
 * @param name - the element name, including any namespace prefix.
 * @returns the decoded text, or `undefined` when the element is absent or empty.
 */
export function elementText(fragment: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(fragment)
  if (match === null) return undefined
  const text = decodeEntities(captured(match)).trim()
  return text === '' ? undefined : text
}

/**
 * Read every occurrence of one element's text in a fragment.
 * @param fragment - the XML fragment to search.
 * @param name - the element name, including any namespace prefix.
 * @returns the decoded texts, in document order.
 */
export function elementTexts(fragment: string, name: string): readonly string[] {
  const texts: string[] = []
  for (const match of fragment.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))) {
    const text = decodeEntities(captured(match)).trim()
    if (text !== '') texts.push(text)
  }
  return texts
}

/**
 * Read the `href` of the entry's PDF link.
 * @param entry - one `<entry>` fragment.
 * @returns the decoded URL, or `undefined` when the entry offers no PDF link.
 */
export function pdfLink(entry: string): string | undefined {
  for (const match of entry.matchAll(/<link\b([^>]*)\/?>/g)) {
    const attributes = captured(match)
    if (!/\btitle\s*=\s*"pdf"/.test(attributes)) continue
    const href = /\bhref\s*=\s*"([^"]*)"/.exec(attributes)
    if (href !== null) return decodeEntities(captured(href))
  }
  return undefined
}

/**
 * Map one arXiv Atom feed into records.
 * @param xml - the feed document, untrusted.
 * @returns one record per usable entry, in feed order.
 */
export function mapArxiv(xml: string): readonly LiteratureRecord[] {
  const records: LiteratureRecord[] = []
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const entry = captured(match)
    const title = cleanTitle(elementText(entry, 'title') ?? '')
    const arxivId = normalizeArxivId(elementText(entry, 'id') ?? '')
    if (title === undefined || arxivId === undefined) continue
    const abstract = clampAbstract(elementText(entry, 'summary') ?? '')
    const doi = normalizeDoi(elementText(entry, 'arxiv:doi') ?? '')
    const venue = elementText(entry, 'arxiv:journal_ref')
    const published = elementText(entry, 'published')
    const year = published === undefined ? undefined : Number.parseInt(published.slice(0, 4), 10)
    const pdfUrl = pdfLink(entry)
    records.push(identify({
      title,
      authors: clampAuthors(elementTexts(entry, 'name')),
      ...optionalFields({
        year: year !== undefined && Number.isInteger(year) ? year : undefined,
        venue,
        abstract,
        doi,
        pdfUrl,
      }),
      arxivId,
      url: `https://arxiv.org/abs/${arxivId}`,
      source: 'arxiv',
      sources: ['arxiv'],
    }))
  }
  return records
}

/**
 * Build the arXiv `search_query` expression for one query.
 *
 * arXiv's parser reads bare whitespace between terms as `OR`, so the four-word
 * query that a user means as one topic would otherwise return anything matching
 * any single word. Each term is ANDed against the `all:` field instead; a
 * quoted phrase is not used because arXiv matches it literally and a phrase
 * search for a normal topic returns nothing.
 * @param query - the validated query text.
 * @returns the `search_query` value.
 */
export function arxivSearchQuery(query: string): string {
  const terms = query.split(/\s+/).filter(term => term !== '')
  return terms.map(term => `all:${term}`).join(' AND ')
}

/**
 * Build the arXiv request URL for one search.
 *
 * arXiv has no year filter, so a bounded request asks for more entries and the
 * adapter drops the ones outside the range.
 * @param request - the validated search request.
 * @param options - the resolved adapter options.
 * @returns the absolute URL.
 */
export function arxivUrl(request: LiteratureSearchRequest, options: LiteratureAdapterOptions): string {
  return buildUrl(ARXIV_ENDPOINT, {
    search_query: arxivSearchQuery(request.query),
    max_results: String(options.maxPerSource),
    sortBy: 'relevance',
  })
}

/**
 * Search arXiv.
 * @param request - the validated search request; its year bounds are applied after mapping.
 * @param options - the resolved adapter options.
 * @param signal - cancellation already merged with this source's timeout.
 * @returns the mapped records, in arXiv relevance order.
 */
export async function search(
  request: LiteratureSearchRequest,
  options: LiteratureAdapterOptions,
  signal: AbortSignal,
): Promise<readonly LiteratureRecord[]> {
  const xml = await fetchText(arxivUrl(request, options), {
    source: 'arxiv',
    headers: { 'user-agent': options.userAgent, accept: 'application/atom+xml' },
    signal,
  })
  return mapArxiv(xml).filter(record =>
    (request.yearFrom === undefined || (record.year ?? 0) >= request.yearFrom)
    && (request.yearTo === undefined || (record.year ?? 9999) <= request.yearTo))
}
