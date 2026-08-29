/**
 * The one outbound path of the literature layer.
 *
 * Every adapter reaches its index through here, so the transport rules hold for
 * all four at once: `https:` only, a fixed four-host allowlist, no redirect
 * following, and a hard cap on how many bytes a reply may spend. The model
 * chooses the query but never the host, and the allowlist keeps it that way —
 * an index that started answering with a redirect to somewhere else would be
 * refused rather than followed, and a reply that keeps streaming is cut at the
 * cap instead of being buffered whole.
 * @module @deepseek-ai/dsh-sci-literature/src/http
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { LiteratureSource } from './types.ts'

/**
 * Typed literature failure with a machine-routable `code`.
 *
 * Codes: `LITERATURE_INVALID_REQUEST` (a query or year bound the layer refuses),
 * `LITERATURE_URL_REFUSED` (scheme or host outside the allowlist),
 * `LITERATURE_SOURCE_HTTP` (non-2xx or a redirect from an index),
 * `LITERATURE_SOURCE_TOO_LARGE` (reply exceeded {@link MAX_RESPONSE_BYTES}),
 * `LITERATURE_SOURCE_MALFORMED` (reply was not the documented JSON or Atom),
 * `LITERATURE_ABORTED` (caller signal or per-source timeout), and
 * `LITERATURE_ALL_SOURCES_FAILED` (no source answered).
 */
export class LiteratureError extends HarnessError {}

/** The four bibliographic indexes this package is allowed to reach. */
export const LITERATURE_HOSTS: readonly string[] = [
  'api.openalex.org',
  'api.semanticscholar.org',
  'export.arxiv.org',
  'api.crossref.org',
]

/**
 * Largest reply one index may spend, in bytes. A search of at most 20 records
 * is far below this even with full abstracts; a reply that passes it is a
 * paging or format accident, not a result the merge could use.
 */
export const MAX_RESPONSE_BYTES = 2_000_000

/** Options one adapter passes for a single outbound call. */
export interface LiteratureFetchOptions {
  /** The source the call belongs to; it labels every failure this call raises. */
  source: LiteratureSource
  /** Request headers; the caller always sets `user-agent`. */
  headers: Readonly<Record<string, string>>
  /** Cancellation of the whole call, already merged with the per-source timeout. */
  signal: AbortSignal
}

/**
 * Whether a caught value is an abort rather than a transport or format failure.
 * @param error - the caught value.
 * @returns true for a `DOMException` named `AbortError` or `TimeoutError`.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/**
 * Check one outbound URL against the transport rules before it is dispatched.
 * @param url - the absolute URL an adapter built.
 * @param source - the source the call belongs to, for the raised failure.
 * @throws LiteratureError `LITERATURE_URL_REFUSED` when the scheme is not `https:` or the host is not allowlisted.
 */
export function assertAllowedUrl(url: string, source: LiteratureSource): void {
  const parsed = URL.parse(url)
  if (parsed === null || parsed.protocol !== 'https:' || !LITERATURE_HOSTS.includes(parsed.hostname)) {
    throw new LiteratureError(
      `${source}: refused to request ${JSON.stringify(url)}; only https on ${LITERATURE_HOSTS.join(', ')} is allowed`,
      'LITERATURE_URL_REFUSED',
    )
  }
}

/**
 * Read one response body, refusing at the byte cap instead of buffering past it.
 * @param response - the dispatched response.
 * @param source - the source the call belongs to, for the raised failure.
 * @returns the decoded body text.
 * @throws LiteratureError `LITERATURE_SOURCE_TOO_LARGE` once the cap is passed.
 */
async function readCapped(response: Response, source: LiteratureSource): Promise<string> {
  const body = response.body
  // A source that answered 2xx with no body at all produces an empty document,
  // which the caller's parser then refuses as malformed.
  if (body === null) return ''
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let size = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        throw new LiteratureError(
          `${source}: reply exceeded ${MAX_RESPONSE_BYTES} bytes`,
          'LITERATURE_SOURCE_TOO_LARGE',
        )
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    // Releasing the lock lets the runtime discard the rest of an oversized
    // reply; without it the connection stays pinned until the socket times out.
    reader.releaseLock()
  }
  return text + decoder.decode()
}

/**
 * Fetch one index's reply as text under every transport rule of this module.
 * @param url - the absolute URL to request.
 * @param options - the source label, headers, and merged cancellation signal.
 * @returns the decoded reply body.
 * @throws LiteratureError for a refused URL, a non-2xx or redirect reply, an oversized body, or cancellation.
 */
export async function fetchText(url: string, options: LiteratureFetchOptions): Promise<string> {
  assertAllowedUrl(url, options.source)
  let response: Response
  try {
    response = await fetch(url, {
      headers: { ...options.headers },
      signal: options.signal,
      // An index that redirects is answering from somewhere the allowlist never
      // cleared, so the call fails instead of following it.
      redirect: 'error',
    })
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw new LiteratureError(`${options.source}: search was cancelled`, 'LITERATURE_ABORTED', { cause: error })
    }
    throw new LiteratureError(`${options.source}: request failed`, 'LITERATURE_SOURCE_HTTP', { cause: error })
  }
  if (!response.ok) {
    throw new LiteratureError(
      `${options.source}: replied HTTP ${response.status}`,
      'LITERATURE_SOURCE_HTTP',
    )
  }
  return readCapped(response, options.source)
}

/**
 * Fetch one index's reply and parse it as JSON.
 * @param url - the absolute URL to request.
 * @param options - the source label, headers, and merged cancellation signal.
 * @returns the parsed reply, still untyped; the adapter narrows it.
 * @throws LiteratureError `LITERATURE_SOURCE_MALFORMED` when the reply is not JSON, plus every failure of {@link fetchText}.
 */
export async function fetchJson(url: string, options: LiteratureFetchOptions): Promise<unknown> {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw new LiteratureError(`${options.source}: reply was not JSON`, 'LITERATURE_SOURCE_MALFORMED', { cause: error })
  }
}
