/**
 * Viewer target assembly for the in-panel office frame.
 *
 * The host emits its Viewer target as a same-origin path (`/univer-gw/?file=…`)
 * because the Gateway binds loopback and is reachable only through this
 * origin's reverse proxy. `new URL` rejects an origin-less path, so the edit
 * runs against a placeholder base that is dropped on the way out and the
 * result stays exactly as relative as the target the host emitted.
 */

/** Placeholder origin for parsing a path-only target; never reaches a result. */
const RELATIVE_BASE = 'http://sci-files-viewer.invalid'

/**
 * Path prefix every Viewer target carries: the reverse proxy in front of the
 * loopback-bound Gateway. A target outside it is not a Viewer target, whoever
 * produced it.
 */
export const VIEWER_PATH_PREFIX = '/univer-gw/'

/**
 * The Viewer target for one document in the details column.
 *
 * `mode=embedded` drops the standalone Viewer's own chrome, `scope=trunk`
 * points the session at the live document rather than a model draft worktree,
 * and `editable` is granted only while the collaboration Gateway is up —
 * every edit is a collaboration write, so a frame with no Gateway behind it
 * must not offer one.
 *
 * The result is an `<iframe src>`, so this refuses anything that is not a
 * relative path under {@link VIEWER_PATH_PREFIX}: an absolute or
 * protocol-relative target names a foreign origin, a `javascript:` or `data:`
 * reference parses to an opaque one, and `/univer-gw/../x` normalizes out of
 * the prefix. The wire adapter already rejects all of them
 * (`trustedViewerUrl`); this is the second line, because the two callers are
 * independent and the sink is script execution in this origin.
 * @param viewerUrl - a validated same-origin relative Viewer target.
 * @param editable - whether the Gateway is running and edits can be saved.
 * @returns the framed target, relative as the input was.
 * @throws when `viewerUrl` is not a relative path under the Viewer prefix.
 */
export function embeddedViewerUrl(viewerUrl: string, editable: boolean): string {
  const target = new URL(viewerUrl, RELATIVE_BASE)
  if (target.origin !== RELATIVE_BASE || !target.pathname.startsWith(VIEWER_PATH_PREFIX)) {
    throw new Error(`refusing to frame ${JSON.stringify(viewerUrl)}: not a relative ${VIEWER_PATH_PREFIX} path`)
  }
  target.searchParams.set('mode', 'embedded')
  target.searchParams.set('scope', 'trunk')
  target.searchParams.set('editable', String(editable))
  return `${target.pathname}${target.search}`
}
