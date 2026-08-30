/**
 * The library's own browser routes.
 *
 * The host serves stored bytes at `/library-api/file` and takes uploads at
 * `/library-api/upload`; both are same-origin paths the session cookie
 * already authorizes, so a preview `<embed>`, a download anchor, and the
 * upload `fetch` all address them by building the query here rather than each
 * spelling it themselves.
 */

import type { UploadErrorCode } from './contract.ts'

/** Prefix the host registers for the library's routes. */
const LIBRARY_API = '/library-api'

/**
 * The address of one stored file: a plain GET the browser can put straight
 * into an `<embed>`, an `<img>`, or a download anchor.
 * @param entryId - the entry owning the file.
 * @param name - the file's name within that entry.
 * @returns the same-origin url of the file's bytes.
 */
export function fileUrl(entryId: string, name: string): string {
  return `${LIBRARY_API}/file?entryId=${encodeURIComponent(entryId)}&name=${encodeURIComponent(name)}`
}

/**
 * The address one upload posts to.
 * @param entryId - target entry id, or `new` to mint one around the file.
 * @param kind - which kind a newly minted entry gets.
 * @returns the same-origin url of the upload route.
 */
export function uploadUrl(entryId: string, kind: 'paper' | 'dataset'): string {
  return `${LIBRARY_API}/upload?entryId=${encodeURIComponent(entryId)}&kind=${kind}`
}

/**
 * The upload code one refused response carries. The route's three refusals are
 * the ones the picker has copy for; anything else is a plain failure.
 * @param status - the HTTP status the route answered with.
 * @returns the stated upload code.
 */
export function uploadCodeOf(status: number): UploadErrorCode {
  if (status === 413) return 'too-large'
  if (status === 415) return 'unsupported-type'
  if (status === 403) return 'forbidden'
  return 'failed'
}
