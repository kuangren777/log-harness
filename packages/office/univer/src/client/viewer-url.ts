/**
 * Query-string edits over a Host-owned Viewer target.
 *
 * The Host emits Viewer targets as same-origin paths (`/univer-gw/?file=…`)
 * because the Gateway is reachable only through this harness origin's reverse
 * proxy. `new URL(path)` rejects a path without an origin, so every edit goes
 * through a placeholder base that is dropped again on the way out — the result
 * stays exactly as absolute or as relative as the target the Host emitted.
 */

/** Placeholder origin for parsing a path-only target; never reaches a result. */
const RELATIVE_BASE = 'http://univer-viewer.invalid'

/**
 * Apply one query-string edit to a Viewer target.
 * @param url - the Host-owned target, absolute or same-origin relative.
 * @param edit - mutates the parsed query parameters in place.
 * @returns the edited target, relative when the input was relative.
 */
export function editViewerUrl(url: string, edit: (params: URLSearchParams) => void): string {
  const target = new URL(url, RELATIVE_BASE)
  edit(target.searchParams)
  return target.origin === RELATIVE_BASE ? `${target.pathname}${target.search}` : target.toString()
}
