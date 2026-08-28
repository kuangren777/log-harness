/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the transport hygiene the provider enforces
 * before any network access: http(s) only, no embedded credentials, bounded
 * length, and no host that names the local machine or a private network
 * ({@link isPrivateHost}). Returns the parsed `URL`. Throws {@link WebError}
 * otherwise.
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @param allowPrivateHosts - skip the private-host check; only tests and local
 *   development against a loopback server set this.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number, allowPrivateHosts = false): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  if (!allowPrivateHosts && isPrivateHost(url.hostname)) {
    throw new WebError(`host "${url.hostname}" is local or on a private network and cannot be fetched`, 'WEB_BLOCKED_URL')
  }
  return url
}

/** Dotted-quad IPv4 literal. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Whether a URL hostname names the fetching machine or a private network.
 *
 * The harness process shares a network namespace with loopback-only services
 * (its own gateway, the skill vault, the sandbox daemon, the model relay), and
 * the model chooses the fetch target, so a request to one of those addresses
 * is server-side request forgery. Blocked: `localhost` and `*.localhost`,
 * `*.internal`, IPv4 loopback (127/8), unspecified (0/8), RFC 1918 (10/8,
 * 172.16/12, 192.168/16), link-local (169.254/16), shared address space
 * (100.64/10), and their IPv6 counterparts (`::`, `::1`, `fc00::/7`,
 * `fe80::/10`, IPv4-mapped forms). Public names that resolve to a private
 * address at connect time are not caught here — the check is on the literal
 * host, before DNS (Known Limitations).
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
  // `URL` renders an IPv4-mapped address in hex groups (`::ffff:7f00:1`), never
  // dotted; both forms are accepted so a hand-built hostname cannot slip past.
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)
  if (mappedDotted !== null) return isPrivateHost(mappedDotted[1] as string)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (mappedHex !== null) {
    const high = parseInt(mappedHex[1] as string, 16)
    const low = parseInt(mappedHex[2] as string, 16)
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff])
  }
  const head = address.split(':')[0] ?? ''
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return true
  return false
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}
