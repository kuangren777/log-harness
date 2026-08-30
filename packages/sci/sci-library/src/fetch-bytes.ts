/**
 * The one place this package reaches the network: downloading an entry's
 * open-access PDF into the sandbox.
 *
 * `ctx.web` cannot serve this. Its providers classify a response by content
 * type and decode it as text, so `application/pdf` is refused outright — the
 * text-only contract is the right one for the model-facing `web_search` path
 * and is not widened here. What replaces it is deliberately narrower than a
 * general fetch: `https:` only, no host that names the local machine or a
 * private network, at most three redirects with the same checks at every hop,
 * a hard byte cap enforced while reading, and a document that must actually be
 * a PDF. The model chooses neither the URL nor the host — the URL comes from a
 * bibliographic index that already returned it as this work's open-access copy.
 * @module @deepseek-ai/dsh-sci-library/src/fetch-bytes
 */

import { LibraryError } from './error.ts'

/** Redirects one download follows before giving up. */
export const MAX_REDIRECTS = 3

/** The magic prefix every PDF document starts with. */
export const PDF_MAGIC = '%PDF'

/** Dotted-quad IPv4 literal. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * @param octets - the four IPv4 octets.
 * @returns true for loopback, unspecified, RFC 1918, link-local, or shared address space.
 */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets as [number, number, number, number]
  if (a === 127 || a === 0 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * @param host - an IPv6 literal without brackets, possibly zone-scoped or IPv4-mapped.
 * @returns true for unspecified, loopback, unique-local, link-local, or a mapped private IPv4.
 */
function isPrivateIpv6(host: string): boolean {
  const address = host.replace(/%.*$/, '')
  if (address === '::' || address === '::1') return true
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)
  if (mappedDotted !== null) return isPrivateHost(mappedDotted[1] as string)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (mappedHex !== null) {
    const high = parseInt(mappedHex[1] as string, 16)
    const low = parseInt(mappedHex[2] as string, 16)
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff])
  }
  // `split` always yields at least one element, so the head is never absent.
  const head = address.split(':')[0] as string
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return true
  return false
}

/**
 * Whether a URL hostname names the fetching machine or a private network.
 *
 * The rules are `web-fetch-http`'s, restated rather than imported: that package
 * is a `ctx.web` provider this one does not otherwise depend on, and its policy
 * module is not part of its published surface. Blocked: `localhost` and
 * `*.localhost`, `*.internal`, IPv4 loopback (127/8), unspecified (0/8),
 * RFC 1918, link-local (169.254/16), shared address space (100.64/10), and
 * their IPv6 counterparts. A public name that resolves to a private address at
 * connect time is not caught — the check is on the literal host, before DNS.
 * @param hostname - the URL's hostname, as `URL` normalises it (IPv6 without brackets).
 * @returns true when the host must not be fetched.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  const v4 = IPV4.exec(host)
  if (v4 !== null) return isPrivateIpv4(v4.slice(1, 5).map(Number))
  if (host.includes(':')) return isPrivateIpv6(host.replace(/^\[|\]$/g, ''))
  return false
}

/**
 * Check one download URL, at the first request and again at every redirect.
 * @param input - the URL as an entry's `pdfUrl` carries it, or as a hop returned it.
 * @param base - the URL the hop was returned by, for a relative `Location`.
 * @returns the parsed URL.
 * @throws LibraryError `LIBRARY_BLOCKED_URL` for a non-https scheme, embedded
 *   credentials, an unparsable URL, or a local/private host.
 */
export function checkDownloadUrl(input: string, base?: URL): URL {
  let url: URL
  try {
    url = new URL(input, base)
  } catch (error: unknown) {
    throw new LibraryError('the PDF link is not a usable URL', 'LIBRARY_BLOCKED_URL', { cause: error })
  }
  if (url.protocol !== 'https:') {
    throw new LibraryError(`PDF links must be https, got ${url.protocol.replace(':', '')}`, 'LIBRARY_BLOCKED_URL')
  }
  if (url.username !== '' || url.password !== '') {
    throw new LibraryError('credentials in PDF links are not allowed', 'LIBRARY_BLOCKED_URL')
  }
  if (isPrivateHost(url.hostname)) {
    throw new LibraryError('the PDF link points at a local or private address', 'LIBRARY_BLOCKED_URL')
  }
  return url
}

/** What one download is bounded by. */
export interface FetchBytesOptions {
  /** Inclusive byte cap on the downloaded document. */
  maxBytes: number
  /** Budget for the whole download including its redirects, in milliseconds. */
  timeoutMs: number
  /** Caller cancellation, merged with the budget. */
  signal?: AbortSignal
}

/**
 * Read one response body under a hard byte cap.
 * @param response - the answering response.
 * @param maxBytes - inclusive byte cap.
 * @returns the body's bytes.
 * @throws LibraryError `LIBRARY_TOO_LARGE` as soon as the cap is passed, before the rest arrives.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new LibraryError(`the file is ${declared} bytes; at most ${maxBytes} are accepted`, 'LIBRARY_TOO_LARGE')
  }
  const body = response.body
  if (body === null) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = body.getReader()
  for (;;) {
    const step = await reader.read()
    if (step.done === true) break
    const chunk = step.value
    total += chunk.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new LibraryError(`the file exceeds the ${maxBytes} byte limit`, 'LIBRARY_TOO_LARGE')
    }
    chunks.push(chunk)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Whether a downloaded document is a PDF.
 * @param contentType - the response's `Content-Type`, or null.
 * @param bytes - the downloaded body.
 * @returns true when the type says PDF or the bytes start with `%PDF`.
 */
export function looksLikePdf(contentType: string | null, bytes: Uint8Array): boolean {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'application/pdf') return true
  return new TextDecoder('latin1').decode(bytes.slice(0, PDF_MAGIC.length)) === PDF_MAGIC
}

/**
 * Download one open-access PDF.
 *
 * Redirects are followed by hand rather than by `fetch`, because a hop is
 * exactly where a public URL can turn into a private one: every `Location` is
 * re-checked by {@link checkDownloadUrl} before it is requested.
 * @param input - the entry's `pdfUrl`.
 * @param options - the byte cap, the time budget, and optional caller cancellation.
 * @returns the PDF's bytes.
 * @throws LibraryError for a refused URL, a failed request, a body past the cap,
 *   a redirect chain past {@link MAX_REDIRECTS}, or a document that is not a PDF.
 */
export async function fetchPdfBytes(input: string, options: FetchBytesOptions): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
  let url = checkDownloadUrl(input)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response
    try {
      response = await fetch(url, { redirect: 'manual', signal, headers: { accept: 'application/pdf,*/*' } })
    } catch (error: unknown) {
      throw new LibraryError('the PDF link did not answer', 'LIBRARY_FETCH_FAILED', { cause: error })
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null) {
        throw new LibraryError(`the PDF link answered ${response.status} with no destination`, 'LIBRARY_FETCH_FAILED')
      }
      url = checkDownloadUrl(location, url)
      continue
    }
    if (!response.ok) {
      throw new LibraryError(`the PDF link answered ${response.status}`, 'LIBRARY_FETCH_FAILED')
    }
    const bytes = await readCapped(response, options.maxBytes)
    if (!looksLikePdf(response.headers.get('content-type'), bytes)) {
      throw new LibraryError('the link did not answer a PDF; it is probably a login or landing page', 'LIBRARY_NOT_PDF')
    }
    return bytes
  }
  throw new LibraryError(`the PDF link redirected more than ${MAX_REDIRECTS} times`, 'LIBRARY_TOO_MANY_REDIRECTS')
}
