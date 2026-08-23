/**
 * The browser credential: how the login session is written into a cookie, read
 * back out, and cleared.
 *
 * The cookie carries `<authSessionId>.<token>` rather than the token alone.
 * The auth seam resolves a token to a principal but offers no token-to-session
 * lookup, so without the id half a sign-out could only revoke every session
 * the account has. The id is an opaque identifier, not a credential: presenting
 * it authenticates nothing, and the only operation it can name is the
 * revocation of a session whose id the caller already holds.
 * @module @deepseek-ai/dsh-auth-gate/cookie
 */

import { AuthSessionId } from '@deepseek-ai/dsh-auth'
import type { RequestHeaders } from '@deepseek-ai/dsh-host-apiproxy'

/** The separator between the credential's two halves; neither half can contain it. */
const CREDENTIAL_SEPARATOR = '.'

/**
 * Attributes every cookie this module writes carries.
 *
 * `HttpOnly` keeps the credential out of scripts, so an injected script cannot
 * read it. `SameSite=Strict` is the cross-site fence: the browser attaches the
 * cookie only to requests this origin's own pages made, which is what makes
 * the gateway's state-changing methods safe without a CSRF token. `Path=/`
 * covers `/api`, `/auth`, and the WebSocket upgrades with one cookie.
 */
const FIXED_ATTRIBUTES = 'HttpOnly; SameSite=Strict; Path=/'

/**
 * The credential value for one issued session.
 * @param authSessionId - the issued session's id.
 * @param token - the issued bearer token.
 * @returns the cookie value to send.
 */
export function joinCredential(authSessionId: string, token: string): string {
  return `${authSessionId}${CREDENTIAL_SEPARATOR}${token}`
}

/**
 * Split a presented credential back into its two halves.
 *
 * The split is at the FIRST separator: the id half is minted by the provider
 * and the token half is base64url, so neither contains one, but a value from a
 * request is whatever the caller sent.
 * @param value - the presented cookie value.
 * @returns both halves, or `undefined` when the value is not a credential.
 */
export function splitCredential(value: string): { authSessionId: AuthSessionId; token: string } | undefined {
  const separator = value.indexOf(CREDENTIAL_SEPARATOR)
  if (separator <= 0 || separator === value.length - 1) return undefined
  return {
    authSessionId: AuthSessionId(value.slice(0, separator)),
    token: value.slice(separator + 1),
  }
}

/**
 * The `Set-Cookie` value that installs one credential.
 * @param name - the configured cookie name.
 * @param value - the credential to install.
 * @param secure - whether to add `Secure`, restricting the cookie to HTTPS.
 * @param maxAgeSeconds - how long the browser keeps the cookie; clamped at zero so a past expiry never becomes a negative age.
 * @returns the header value to send.
 */
export function sessionCookie(
  name: string,
  value: string,
  secure: boolean,
  maxAgeSeconds: number,
): string {
  const attributes = [
    `${name}=${value}`,
    FIXED_ATTRIBUTES,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSeconds)))}`,
    ...secure ? ['Secure'] : [],
  ]
  return attributes.join('; ')
}

/**
 * The `Set-Cookie` value that removes the credential. An empty value with a
 * zero age is the removal every browser honours; the attributes must match the
 * ones the cookie was set with or the browser keeps a second copy.
 * @param name - the configured cookie name.
 * @param secure - whether the cookie was set with `Secure`.
 * @returns the header value to send.
 */
export function clearedCookie(name: string, secure: boolean): string {
  return sessionCookie(name, '', secure, 0)
}

/**
 * Read one cookie out of a request's headers.
 *
 * The parse is deliberately small: split on `;`, take the first pair whose
 * name matches exactly. A duplicate name loses to the first, which is what
 * every browser sends first for the most specific path.
 * @param headers - the request's headers, in either HTTP representation.
 * @param name - the cookie to read.
 * @returns the cookie's value, or `undefined` when the request carries none.
 */
export function readCookie(headers: RequestHeaders, name: string): string | undefined {
  const raw = headers instanceof Headers ? headers.get('cookie') : headers.cookie
  if (typeof raw !== 'string') return undefined
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    if (pair.slice(0, separator).trim() !== name) continue
    return pair.slice(separator + 1).trim()
  }
  return undefined
}
