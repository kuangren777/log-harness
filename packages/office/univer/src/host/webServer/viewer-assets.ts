/**
 * Same-origin serving of the prebuilt Viewer's own chunk files at the absolute
 * `/assets/<name>` paths its loader builds.
 *
 * The reverse proxy re-roots the `/assets/` references it finds in the Viewer's
 * HTML and CSS under `/univer-gw/assets/`, so the document and its stylesheets
 * return through the proxy. Its JavaScript is never rewritten, and the bundle
 * reaches for chunks the markup does not name: the module-preload helper holds
 * its dependencies as a RELATIVE list (`"assets/en-US-CcPImG2f.js"`), turns each
 * one into `"/" + dep`, and resolves that against the module URL. A leading
 * slash discards the module's own directory, so the request leaves as an
 * absolute `/assets/<name>` on the harness origin however the importing chunk
 * was addressed. Those requests land on the harness web app's `/assets/` prefix
 * route, which has no such file.
 *
 * This module answers them at the source. The bundled `artifacts/viewer/assets`
 * directory is enumerated once at plugin load, and every file in it registers as
 * an EXACT `/assets/<name>` route. The webserver resolves its exact table before
 * the prefix table, so each of those names reaches the bundled file while every
 * other `/assets/*` path stays the web app's.
 *
 * The enumerated set is the entire allowlist, and a request selects rather than
 * names: an exact route matches one parsed pathname verbatim and carries the
 * file path it was built from, so nothing a client sends can address a file
 * outside the enumerated directory or reach it by traversal.
 *
 * These routes carry the same browser-trust fence as the rest of this package's
 * browser surface — same host process, same origin, same rebinding exposure.
 */

import { createReadStream, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { GATEWAY_FORBIDDEN_BODY, type RequestTrustCheck } from './gateway-proxy.ts'
import { sendJson } from './router.ts'

/** Path the Viewer's own chunk URLs resolve to on the harness origin. */
export const VIEWER_ASSET_PREFIX = '/assets'

/**
 * Cache directive for one bundled chunk. Every name in the directory is
 * content-hashed by the Viewer's own build, so a changed file arrives under a
 * changed name and no cached response can go stale.
 */
export const VIEWER_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** Response body sent when an enumerated asset can no longer be read. */
export const VIEWER_ASSET_UNREADABLE_BODY = { error: 'viewer-asset-unreadable' } as const

/**
 * Content type per file extension found in a Viewer build. A browser refuses a
 * module served as anything but a JavaScript type, and a stylesheet that
 * arrives without `text/css` is dropped in standards mode, so these are
 * correctness rather than presentation.
 */
const CONTENT_TYPES = new Map<string, string>([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.eot', 'application/vnd.ms-fontobject'],
  ['.wasm', 'application/wasm'],
])

/** Content type for a name whose extension the table does not carry. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Resolve the content type one bundled asset is served with.
 * @param name - the file name as the artifacts directory spells it.
 * @returns the `content-type` value, `application/octet-stream` for an
 * extension the table does not carry.
 */
export function assetContentType(name: string): string {
  return CONTENT_TYPES.get(extname(name).toLowerCase()) ?? DEFAULT_CONTENT_TYPE
}

/** One bundled Viewer asset, as the exact webserver route serving it. */
export interface ViewerAssetRoute {
  /** The exact pathname this file answers, `/assets/<name>`. */
  readonly path: string
  /** Owns the full response lifecycle of a request for this one file. */
  readonly handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
}

/**
 * Enumerate the bundled Viewer assets and build one exact route per file.
 *
 * The directory is read once, at plugin load: the artifacts are fetched bytes
 * that no running host writes, and re-reading per request would make every
 * chunk load a directory scan.
 * @param root - the bundled Viewer's `assets` directory.
 * @param isTrusted - the deployment's browser-trust fence, applied per request.
 * @returns one route per file directly in the directory, empty when there is no
 * such directory to read.
 */
export function createViewerAssetRoutes(root: string, isTrusted: RequestTrustCheck): ViewerAssetRoute[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    // A checkout that never ran `pnpm run fetch-artifacts` has no `artifacts/`
    // at all, which is the reachable case and reports ENOENT. Any other reason
    // this directory cannot be listed leaves the same deployment fact — there
    // are no Viewer assets to serve — and the caller states it once.
    return []
  }
  return entries
    .filter(entry => entry.isFile())
    .map(entry => ({
      path: `${VIEWER_ASSET_PREFIX}/${entry.name}`,
      handler: createAssetHandler(join(root, entry.name), assetContentType(entry.name), isTrusted),
    }))
}

/**
 * Serve one bundled file, streamed rather than buffered: the largest Viewer
 * chunk is over 13 MB, and holding one per concurrent request would put the
 * host's memory at the mercy of a reloading tab.
 * @param file - absolute path of the enumerated file.
 * @param contentType - the `content-type` this file is served with.
 * @param isTrusted - the deployment's browser-trust fence.
 * @returns the request handler owning the response.
 */
function createAssetHandler(
  file: string,
  contentType: string,
  isTrusted: RequestTrustCheck,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!isTrusted(request.headers)) {
      sendJson(response, 403, GATEWAY_FORBIDDEN_BODY)
      return
    }
    await new Promise<void>((settle) => {
      const bytes = createReadStream(file)
      bytes.once('error', () => {
        // The name came from a directory listing, so a failure here means the
        // artifacts directory changed under a running host.
        /* v8 ignore next -- committed arm: the stream reports `open` before any
        byte is written, so reaching this past writeHead needs the file to break
        between two reads of an artifact nothing else writes. */
        if (response.headersSent) { response.destroy(); settle(); return }
        sendJson(response, 500, VIEWER_ASSET_UNREADABLE_BODY)
        settle()
      })
      bytes.once('open', () => {
        response.writeHead(200, { 'content-type': contentType, 'cache-control': VIEWER_ASSET_CACHE_CONTROL })
        bytes.pipe(response)
      })
      // A browser that navigates away must not leave a read running, and
      // settling here is also what lets `webServer` disposal reach quiescence.
      // Destroying a stream that already ended is a no-op, so the finished case
      // needs no separate arm.
      response.once('close', () => { bytes.destroy(); settle() })
    })
  }
}

/**
 * Claim the exact `/assets/<name>` path of every bundled Viewer asset.
 *
 * One effect owns the whole set, so an HMR reload releases the names together
 * rather than leaving part of a Viewer build registered.
 * @param ctx - Cordis context carrying `webServer` and the logger.
 * @param root - the bundled Viewer's `assets` directory.
 * @param isTrusted - the deployment's browser-trust fence.
 */
export function registerViewerAssets(ctx: Context, root: string, isTrusted: RequestTrustCheck): void {
  const routes = createViewerAssetRoutes(root, isTrusted)
  if (routes.length === 0) {
    ctx.logger.info(`univer: no Viewer assets under ${root}; the Viewer's own chunk paths stay unclaimed`)
    return
  }
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register({
      kind: 'exact',
      path: route.path,
      handler: route.handler,
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'univer: viewer assets')
}
