/**
 * The Viewer's own chunk paths, exercised through the real {@link WebServer}:
 * what a browser asking for `/assets/<name>` receives, which names exist at
 * all, and how those exact routes sit beside the harness web app's `/assets/`
 * prefix. The fixtures are a temporary directory rather than the fetched
 * `artifacts/viewer/assets`, so the same assertions hold in a checkout that
 * never ran `pnpm run fetch-artifacts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { RequestTrustCheck } from '../src/host/webServer/gateway-proxy.ts'
import {
  assetContentType,
  createViewerAssetRoutes,
  registerViewerAssets,
  VIEWER_ASSET_CACHE_CONTROL,
  VIEWER_ASSET_PREFIX,
} from '../src/host/webServer/viewer-assets.ts'

/** Files a Viewer build leaves in `assets/`, one per content type this package answers. */
const FIXTURES: Record<string, string> = {
  'index-xe_OYCFu.js': 'export const entry = 1',
  'en-US-CcPImG2f.js': 'export const EN_US_MESSAGES = {}',
  'index-DjwVBixc.css': '.univer{color:red}',
  'inter-BdQr8kZm.woff2': 'not really a font',
  'index-xe_OYCFu.js.map': '{"version":3}',
  'sprite-Cn2Fk1lp.bin': 'opaque bytes',
}

/** Names the fixture directory does NOT hold at its top level. */
const NESTED_NAME = 'nested-DeEpFile.js'

let root: string
const contexts: Context[] = []

beforeEach(() => {
  root = join(mkdtempSync(join(tmpdir(), 'dsh-univer-assets-')), 'assets')
  mkdirSync(root)
  for (const [name, body] of Object.entries(FIXTURES)) writeFileSync(join(root, name), body)
  // A directory entry is not a file, and the file inside it is not a top-level
  // name: neither may become a route.
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', NESTED_NAME), 'export const deep = 1')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  rmSync(root, { recursive: true, force: true })
})

/** The mounted asset routes as their own fiber, so disposal can be observed. */
function assetsPlugin(assetsRoot: string, isTrusted: RequestTrustCheck): {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
} {
  return {
    name: 'univer-viewer-assets-test',
    inject: ['webServer'],
    apply: (ctx: Context): void => { registerViewerAssets(ctx, assetsRoot, isTrusted) },
  }
}

/** Boot the real WebServer, mount the asset routes, and return the live port. */
async function serve(options: {
  assetsRoot?: string
  isTrusted?: RequestTrustCheck
  webApp?: boolean
} = {}): Promise<{ ctx: Context; port: number }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const server = ctx.get('webServer')
  if (server === undefined) throw new Error('webServer service did not activate')
  if (options.webApp === true) {
    // What the harness web app registers: one prefix owning every `/assets/*`
    // path it serves out of its own dist.
    server.register({
      kind: 'prefix',
      path: VIEWER_ASSET_PREFIX,
      handler: (_request: IncomingMessage, response: ServerResponse) => {
        response.writeHead(200, { 'content-type': 'text/javascript' })
        response.end('web-app-dist')
      },
    })
  }
  await ctx.plugin(assetsPlugin(options.assetsRoot ?? root, options.isTrusted ?? ((): boolean => true)))
  return { ctx, port: server.port }
}

/**
 * One GET carrying a chosen `Host`. `fetch` forbids the header, and it is the
 * only input the browser-trust fence reads.
 * @param port - the live web server port.
 * @param path - the request path.
 * @param host - the `Host` header value to send.
 * @returns the response status.
 */
function send(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers: { host } }, (response) => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode ?? 0) })
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

describe('viewer asset enumeration', () => {
  it('builds one exact route per file and skips directories', () => {
    const routes = createViewerAssetRoutes(root, () => true)
    expect(routes.map(route => route.path).sort()).toEqual(
      Object.keys(FIXTURES).map(name => `${VIEWER_ASSET_PREFIX}/${name}`).sort(),
    )
    expect(routes.map(route => route.path)).not.toContain(`${VIEWER_ASSET_PREFIX}/nested`)
  })

  it('resolves the content type a browser needs from the file name', () => {
    // A module served as anything but a JavaScript type is refused outright,
    // and a stylesheet without `text/css` is dropped in standards mode.
    expect(assetContentType('en-US-CcPImG2f.js')).toBe('text/javascript; charset=utf-8')
    expect(assetContentType('worker-a1.mjs')).toBe('text/javascript; charset=utf-8')
    expect(assetContentType('index-DjwVBixc.CSS')).toBe('text/css; charset=utf-8')
    expect(assetContentType('inter-BdQr8kZm.woff2')).toBe('font/woff2')
    expect(assetContentType('index-xe_OYCFu.js.map')).toBe('application/json; charset=utf-8')
    expect(assetContentType('logo-D8s.svg')).toBe('image/svg+xml')
    // An extension the table does not carry, and a name with no extension.
    expect(assetContentType('sprite-Cn2Fk1lp.bin')).toBe('application/octet-stream')
    expect(assetContentType('LICENSE')).toBe('application/octet-stream')
  })

  it('yields nothing when the artifacts directory was never fetched', () => {
    expect(createViewerAssetRoutes(join(root, 'absent'), () => true)).toEqual([])
  })
})

describe('serving one bundled asset', () => {
  it('answers each enumerated name with its bytes, type, and an immutable cache directive', async () => {
    const { port } = await serve()

    for (const [name, body] of Object.entries(FIXTURES)) {
      const response = await fetch(`http://127.0.0.1:${String(port)}${VIEWER_ASSET_PREFIX}/${name}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(body)
      expect(response.headers.get('content-type')).toBe(assetContentType(name))
      // The names are content-hashed by the Viewer's own build, so a changed
      // file arrives under a changed name and no cached response goes stale.
      expect(response.headers.get('cache-control')).toBe(VIEWER_ASSET_CACHE_CONTROL)
    }
  })

  it('claims no name the directory does not hold', async () => {
    const { port } = await serve()

    // The enumerated set is the whole allowlist: an unregistered name reaches
    // no route at all, and the web server answers it.
    for (const path of [
      `${VIEWER_ASSET_PREFIX}/not-a-chunk-D0.js`,
      // A file one level down is not a top-level name.
      `${VIEWER_ASSET_PREFIX}/${NESTED_NAME}`,
      `${VIEWER_ASSET_PREFIX}/nested/${NESTED_NAME}`,
      // Traversal spellings: an exact route matches one parsed pathname, and
      // none of these is one of the registered strings.
      `${VIEWER_ASSET_PREFIX}/../package.json`,
      `${VIEWER_ASSET_PREFIX}/..%2fpackage.json`,
    ]) {
      expect((await fetch(`http://127.0.0.1:${String(port)}${path}`)).status).toBe(404)
    }
  })

  it('answers 500 when an enumerated file disappears under the running host', async () => {
    const { port } = await serve()
    rmSync(join(root, 'index-DjwVBixc.css'))

    const response = await fetch(`http://127.0.0.1:${String(port)}${VIEWER_ASSET_PREFIX}/index-DjwVBixc.css`)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'viewer-asset-unreadable' })
  })

})

describe('browser-trust fence over the asset routes', () => {
  it('refuses a request the fence rejects, without reading the file', async () => {
    const { port } = await serve({ isTrusted: () => false })

    const response = await fetch(`http://127.0.0.1:${String(port)}${VIEWER_ASSET_PREFIX}/index-xe_OYCFu.js`)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'forbidden' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a DNS-rebound Host through the deployment Connection service', async () => {
    // The same decision `/api` and the Gateway proxy make, read through the
    // service rather than restated here.
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection, { trustedHosts: ['studio.internal'] })
    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')
    await ctx.plugin(assetsPlugin(root, headers => ctx.connection.isTrustedRequest(headers)))
    const path = `${VIEWER_ASSET_PREFIX}/index-xe_OYCFu.js`

    // The socket lands here either way; `Host` is the header rebinding cannot
    // forge, so it is the one the fence binds every request with.
    expect(await send(server.port, path, 'evil.example:3080')).toBe(403)
    expect(await send(server.port, path, 'studio.internal')).toBe(200)
  })
})

describe('sitting beside the harness web app', () => {
  it('answers a Viewer chunk name while every other /assets path stays the web app\'s', async () => {
    const { port } = await serve({ webApp: true })

    // The web server resolves its exact table before the prefix table, so a
    // bundled name reaches the bundled file...
    const chunk = await fetch(`http://127.0.0.1:${String(port)}${VIEWER_ASSET_PREFIX}/en-US-CcPImG2f.js`)
    expect(await chunk.text()).toBe(FIXTURES['en-US-CcPImG2f.js'])
    expect(chunk.headers.get('cache-control')).toBe(VIEWER_ASSET_CACHE_CONTROL)

    // ...and every name this package did not enumerate still falls to the app.
    const app = await fetch(`http://127.0.0.1:${String(port)}${VIEWER_ASSET_PREFIX}/index-DeadBeef.js`)
    expect(await app.text()).toBe('web-app-dist')
    expect(app.headers.get('cache-control')).toBeNull()
  })

  it('registers nothing and says so once when the Viewer was never fetched', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')
    const reported: string[] = []
    ctx.logger.info = ((message: unknown) => { reported.push(String(message)) }) as typeof ctx.logger.info
    const absent = join(root, 'absent')

    await ctx.plugin(assetsPlugin(absent, () => true))

    expect(reported).toHaveLength(1)
    expect(reported[0]).toContain(absent)
    // The seat is left open rather than claimed with nothing behind it.
    expect(() => server.register({
      kind: 'exact',
      path: `${VIEWER_ASSET_PREFIX}/index-xe_OYCFu.js`,
      handler: () => {},
    })).not.toThrow()
  })

  it('releases every claimed name when its fiber is disposed', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')
    const mounted = await ctx.plugin(assetsPlugin(root, () => true))
    for (const name of Object.keys(FIXTURES)) {
      expect(() => server.register({ kind: 'exact', path: `${VIEWER_ASSET_PREFIX}/${name}`, handler: () => {} }))
        .toThrow(/duplicate exact route/)
    }

    await mounted.dispose()

    // Gone from the live dispatch table, not merely from the registry's view.
    expect((await fetch(`http://127.0.0.1:${String(server.port)}${VIEWER_ASSET_PREFIX}/index-DjwVBixc.css`)).status)
      .toBe(404)
    for (const name of Object.keys(FIXTURES)) {
      expect(() => server.register({ kind: 'exact', path: `${VIEWER_ASSET_PREFIX}/${name}`, handler: () => {} }))
        .not.toThrow()
    }
  })
})
