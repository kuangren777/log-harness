/**
 * The reverse proxy is exercised end to end: a real `node:http` server stands
 * in for the Gateway, the real {@link WebServer} carries the routes, and every
 * assertion reads what a browser would see — the forwarded target, the headers
 * that survived each hop, the rewritten body, and the bytes echoed back over a
 * real WebSocket.
 */

import { once } from 'node:events'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { gzipSync } from 'node:zlib'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebSocketServer, WebSocket } from 'ws'
import type { RawData } from 'ws'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { EnsureGatewayResult, GatewayStatus } from '../src/shared/wire/status.ts'
import {
  createGatewayHttpProxy,
  createGatewayUpgradeBridge,
  GATEWAY_FILE_PREFIX,
  GATEWAY_PROXY_PREFIX,
  rewriteAssetReferences,
  upstreamTarget,
  type GatewayLocator,
  type RequestTrustCheck,
} from '../src/host/webServer/gateway-proxy.ts'

/**
 * Text of one WebSocket frame. `ws` hands a frame over as any of three binary
 * carriers, none of which stringifies usefully on its own.
 */
function messageText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8')
}

/** One request the stand-in Gateway received, as the proxy delivered it. */
interface SeenRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string | string[] | undefined>
}

interface Harness {
  readonly port: number
  readonly seen: SeenRequest[]
  readonly gateway: Server
}

/** node types an upgraded connection as `Duplex`; every one of them is a TCP socket. */
function asSocket(stream: Duplex): Socket {
  return stream as Socket
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
})

/** Start a stand-in Gateway answering from a fixed route table. */
async function startGateway(
  routes: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Harness> {
  const seen: SeenRequest[] = []
  const gateway = createServer((request, response) => {
    seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers })
    routes(request, response)
  })
  await new Promise<void>((resolve) => { gateway.listen(0, '127.0.0.1', resolve) })
  disposers.push(async () => {
    gateway.closeAllConnections()
    await new Promise<void>((resolve) => { gateway.close(() => { resolve() }) })
  })
  return { port: (gateway.address() as AddressInfo).port, seen, gateway }
}

/** A Gateway locator reporting one fixed origin, or none at all. */
function locator(origin: string | null, ensure?: () => Promise<EnsureGatewayResult>): GatewayLocator {
  return {
    gatewayStatus: (): Promise<GatewayStatus> => Promise.resolve(
      origin === null
        ? { phase: 'stopped', gateway: null, owned: false, reason: 'not started in this test' }
        : { phase: 'running', gateway: origin, owned: true },
    ),
    ensureGateway: ensure ?? ((): Promise<EnsureGatewayResult> =>
      Promise.resolve({ ok: false, reason: 'no gateway in this test' })),
  }
}

/** What one test varies about the mounted proxy; the rest are permissive defaults. */
interface ProxySetup {
  readonly autoStartGateway?: boolean
  /** The browser-trust fence; the default admits every request so other tests read one signal. */
  readonly isTrusted?: RequestTrustCheck
  readonly proxyTimeoutMs?: number
}

/** Boot the real WebServer and register the proxy routes over one locator. */
async function startProxy(service: GatewayLocator, setup: ProxySetup = {}): Promise<number> {
  const ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const server = ctx.get('webServer')
  if (server === undefined) throw new Error('webServer service did not activate')
  const options = {
    autoStartGateway: setup.autoStartGateway ?? true,
    isTrusted: setup.isTrusted ?? ((): boolean => true),
    proxyTimeoutMs: setup.proxyTimeoutMs ?? 30_000,
  }
  server.register({
    kind: 'prefix',
    path: GATEWAY_PROXY_PREFIX,
    handler: createGatewayHttpProxy(service, options, GATEWAY_PROXY_PREFIX, true),
  })
  server.register({
    kind: 'prefix',
    path: GATEWAY_FILE_PREFIX,
    handler: createGatewayHttpProxy(service, options, GATEWAY_FILE_PREFIX, false),
  })
  server.registerUpgrade({
    kind: 'prefix',
    path: GATEWAY_FILE_PREFIX,
    handler: createGatewayUpgradeBridge(service, options),
  })
  disposers.push(async () => { await ctx.fiber.dispose() })
  return server.port
}

describe('gateway reverse proxy', () => {
  it('strips /univer-gw, forwards method, headers and body, and re-roots asset references', async () => {
    const gateway = await startGateway((request, response) => {
      if (request.url?.startsWith('/?file=') === true) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-gateway': 'viewer' })
        response.end('<script type="module" src="/assets/index-abc.js"></script><link href="/assets/index.css">')
        return
      }
      if (request.url === '/assets/index-abc.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' })
        response.end('export const chunk = "/assets/not-rewritten"')
        return
      }
      if (request.url === '/style.css') {
        response.writeHead(200, { 'content-type': 'text/css' })
        response.end('@font-face{src:url(/assets/font.woff2)}')
        return
      }
      if (request.method === 'POST') {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.once('end', () => {
          response.writeHead(201, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ echoed: Buffer.concat(chunks).toString('utf8') }))
        })
        return
      }
      response.writeHead(404)
      response.end()
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    // The Viewer document: prefix stripped on the way up, asset references
    // re-rooted on the way back so they return through this proxy.
    const viewer = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/?file=KEY`)
    expect(viewer.status).toBe(200)
    expect(viewer.headers.get('x-gateway')).toBe('viewer')
    const html = await viewer.text()
    expect(html).toContain(`src="${GATEWAY_PROXY_PREFIX}/assets/index-abc.js"`)
    expect(html).toContain(`href="${GATEWAY_PROXY_PREFIX}/assets/index.css"`)
    expect(html).not.toMatch(/["']\/assets\//)
    expect(gateway.seen.at(-1)?.url).toBe('/?file=KEY')

    // A rewritten body's content-length is restated, not inherited.
    expect(viewer.headers.get('content-length')).toBe(String(Buffer.byteLength(html)))

    // CSS is rewritten too; JavaScript streams through untouched, so a string
    // that merely looks like an asset path inside code survives verbatim.
    const css = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/style.css`)
    expect(await css.text()).toBe(`@font-face{src:url(${GATEWAY_PROXY_PREFIX}/assets/font.woff2)}`)
    const chunk = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/assets/index-abc.js`)
    expect(await chunk.text()).toBe('export const chunk = "/assets/not-rewritten"')
    expect(gateway.seen.at(-1)?.url).toBe('/assets/index-abc.js')

    // Request headers survive the hop, except `host`, which is re-pointed at
    // the Gateway so its own URL building stays consistent.
    const posted = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/commit`, {
      method: 'POST',
      headers: { 'x-trace': 'abc123', 'content-type': 'application/json' },
      body: '{"unit":"u1"}',
    })
    expect(posted.status).toBe(201)
    expect(await posted.json()).toEqual({ echoed: '{"unit":"u1"}' })
    const commit = gateway.seen.at(-1)
    expect(commit?.method).toBe('POST')
    expect(commit?.url).toBe('/commit')
    expect(commit?.headers['x-trace']).toBe('abc123')
    expect(commit?.headers.host).toBe(`127.0.0.1:${String(gateway.port)}`)
  })

  it('passes /uf through without stripping, because the Viewer builds those paths itself', async () => {
    const gateway = await startGateway((request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(`served ${request.url ?? ''}`)
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const content = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/file-key-1?rev=7`)
    expect(await content.text()).toBe('served /uf/file-key-1?rev=7')
    expect(gateway.seen.at(-1)?.url).toBe('/uf/file-key-1?rev=7')
  })

  it('bridges a WebSocket through the /uf prefix upgrade route', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const sockets = new WebSocketServer({ server: gateway.gateway, path: '/uf/file-key-1' })
    sockets.on('connection', (socket, request) => {
      socket.send(`hello ${request.url ?? ''}`)
      socket.on('message', (data) => { socket.send(`echo:${messageText(data)}`) })
    })
    disposers.push(async () => { await new Promise<void>((resolve) => { sockets.close(() => { resolve() }) }) })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = new WebSocket(`ws://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/file-key-1`)
    const greeting = await new Promise<string>((resolve, reject) => {
      client.once('message', (data) => { resolve(messageText(data)) })
      client.once('error', reject)
    })
    expect(greeting).toBe('hello /uf/file-key-1')

    client.send('ping')
    const echoed = await new Promise<string>((resolve) => { client.once('message', (data) => { resolve(messageText(data)) }) })
    expect(echoed).toBe('echo:ping')

    // Closing the client tears the upstream socket down rather than leaking it.
    const upstreamClosed = new Promise<void>((resolve) => { sockets.clients.values().next().value?.once('close', () => { resolve() }) })
    client.close()
    await upstreamClosed
  })

  it('carries the bytes pipelined with each handshake, in both directions', async () => {
    // A peer may put its first payload in the same TCP segment as the
    // handshake. node hands those trailing bytes over separately as `head`,
    // and dropping either side would silently lose the first message.
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const fromClient: Buffer[] = []
    // node's server.close() ignores upgraded sockets, so the fixture owns them.
    const upgraded: Duplex[] = []
    disposers.push(async () => {
      for (const socket of upgraded) socket.destroy()
      await Promise.resolve()
    })
    gateway.gateway.on('upgrade', (_request, upstreamSocket) => {
      upgraded.push(upstreamSocket)
      upstreamSocket.on('data', (chunk: Buffer) => fromClient.push(chunk))
      // One write, so the payload arrives as the client's `head`.
      upstreamSocket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\nPIPELINED-DOWN',
      )
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = connect(port, '127.0.0.1')
    await once(client, 'connect')
    client.write(
      `GET ${GATEWAY_FILE_PREFIX}/file-key-1 HTTP/1.1\r\nHost: 127.0.0.1\r\n`
      + 'Connection: Upgrade\r\nUpgrade: dsh-test\r\n\r\nPIPELINED-UP',
    )
    const received: Buffer[] = []
    await new Promise<void>((resolve) => {
      client.on('data', (chunk: Buffer) => {
        received.push(chunk)
        if (Buffer.concat(received).includes('PIPELINED-DOWN')) resolve()
      })
    })
    expect(Buffer.concat(received).toString()).toContain('101 Switching Protocols')
    await vi.waitFor(() => { expect(Buffer.concat(fromClient).toString()).toContain('PIPELINED-UP') })
    client.destroy()
  })

  it('replays a repeated 101 header on its own line and withholds the Gateway cookies', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const upgraded: Duplex[] = []
    disposers.push(async () => {
      for (const socket of upgraded) socket.destroy()
      await Promise.resolve()
    })
    gateway.gateway.on('upgrade', (_request, upstreamSocket) => {
      upgraded.push(upstreamSocket)
      // Two headers of the same name: node's parser yields an array, and both
      // values have to reach the client or its cookie jar loses one.
      upstreamSocket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: dsh-test',
        'Set-Cookie: a=1',
        'Set-Cookie: b=2',
        'X-Relay: one',
        'X-Relay: two',
        '', '',
      ].join('\r\n'))
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const first = once(socket, 'data')
    socket.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n`,
    )
    const [data] = await first as [Buffer]
    const head = String(data)
    // Comma-folding is illegal for Set-Cookie and changes what any repeated
    // header means, so each value keeps its own line...
    expect(head).not.toContain('a=1, b=2')
    expect(head).toContain('X-Relay: one\r\n')
    expect(head).toContain('X-Relay: two\r\n')
    // ...and the Gateway's cookies do not reach the harness origin at all.
    expect(head.toLowerCase()).not.toContain('set-cookie')
    socket.destroy()
  })

  it('destroys both bridged sockets when the upstream end resets', async () => {
    // A reset raises `error`, not `close`, on the surviving peer. Without a
    // handler on each side node would take the whole host process down with an
    // unhandled socket error.
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const upgraded: Duplex[] = []
    disposers.push(async () => {
      for (const socket of upgraded) socket.destroy()
      await Promise.resolve()
    })
    gateway.gateway.on('upgrade', (_request, upstreamSocket) => {
      upgraded.push(upstreamSocket)
      upstreamSocket.on('error', () => { /* The fixture's own reset comes back here. */ })
      upstreamSocket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = connect(port, '127.0.0.1')
    client.on('error', () => { /* A reset in either direction surfaces here too. */ })
    await once(client, 'connect')
    const handshake = once(client, 'data')
    client.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n`,
    )
    await handshake

    const upstream = upgraded.at(-1)
    if (upstream === undefined) throw new Error('upstream socket was not captured')
    const bothClosed = Promise.all([once(client, 'close'), once(upstream, 'close')])
    asSocket(upstream).resetAndDestroy()
    await bothClosed
  })

  it('destroys both bridged sockets when the browser end resets', async () => {
    // The mirror of the case above. A browser that goes away abruptly resets
    // its half, and without the client-side handler the upstream Gateway socket
    // would survive the tab that opened it.
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const upgraded: Duplex[] = []
    disposers.push(async () => {
      for (const socket of upgraded) socket.destroy()
      await Promise.resolve()
    })
    gateway.gateway.on('upgrade', (_request, upstreamSocket) => {
      upgraded.push(upstreamSocket)
      upstreamSocket.on('error', () => { /* The teardown reaches this fixture socket too. */ })
      // A paused socket never notices the peer going away; the bridge is what
      // is under test, so the fixture end has to be reading.
      upstreamSocket.resume()
      upstreamSocket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = connect(port, '127.0.0.1')
    client.on('error', () => { /* The client's own reset comes back here. */ })
    await once(client, 'connect')
    const handshake = once(client, 'data')
    client.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n`,
    )
    await handshake

    const upstream = upgraded.at(-1)
    if (upstream === undefined) throw new Error('upstream socket was not captured')
    // The proxy's own upstream socket is the one torn down; the fixture end
    // observes that as end-of-stream. It keeps its write half — a bridged
    // socket is nobody's to close from the other side — so `close` would only
    // arrive with this test's own cleanup and says nothing about the bridge.
    const upstreamEnded = once(upstream, 'end')
    client.resetAndDestroy()
    await upstreamEnded
  })

  it('closes the client socket when the Gateway origin refuses the upgrade connection', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(200); response.end() })
    const origin = `http://127.0.0.1:${String(gateway.port)}`
    gateway.gateway.closeAllConnections()
    await new Promise<void>((resolve) => { gateway.gateway.close(() => { resolve() }) })
    const port = await startProxy(locator(origin))

    const client = new WebSocket(`ws://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/k`)
    await expect(new Promise((_resolve, reject) => { client.once('error', reject) })).rejects.toThrow()
  })

  it('closes the client socket when the Gateway refuses the handshake', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = new WebSocket(`ws://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/missing`)
    await expect(new Promise((_resolve, reject) => { client.once('error', reject) })).rejects.toThrow()
  })

  it('answers 503 gateway-unavailable when no Gateway runs and none may be started', async () => {
    const port = await startProxy(locator(null), { autoStartGateway: false })

    for (const path of [`${GATEWAY_PROXY_PREFIX}/?file=KEY`, `${GATEWAY_FILE_PREFIX}/file-key-1`]) {
      const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'gateway-unavailable' })
    }

    // The upgrade path has no JSON to send, so it states the status and closes.
    const client = new WebSocket(`ws://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/file-key-1`)
    await expect(new Promise((_resolve, reject) => { client.once('error', reject) })).rejects.toThrow(/503/)
  })

  it('streams a response that declares no content type', async () => {
    // No content-type means no claim about the body, so it must pass through
    // byte for byte rather than be parsed as markup and rewritten.
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200)
      response.end('/assets/untouched')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))
    expect(await (await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/raw`)).text())
      .toBe('/assets/untouched')
  })

  it('answers 503 when a stopped Gateway reports no reason', async () => {
    const service: GatewayLocator = {
      gatewayStatus: () => Promise.resolve({ phase: 'stopped', gateway: null, owned: false }),
      ensureGateway: () => Promise.resolve({ ok: false, reason: 'unused' }),
    }
    const port = await startProxy(service, { autoStartGateway: false })
    expect((await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)).status).toBe(503)
  })

  it('starts the Gateway on demand when autoStartGateway is set', async () => {
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('started')
    })
    let ensured = 0
    const service = locator(null, () => {
      ensured += 1
      return Promise.resolve({ ok: true, gateway: `http://127.0.0.1:${String(gateway.port)}`, reused: false })
    })
    const port = await startProxy(service, { autoStartGateway: true })

    expect(await (await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)).text()).toBe('started')
    expect(ensured).toBe(1)
  })

  it('answers 503 when the on-demand start itself fails', async () => {
    const port = await startProxy(locator(null, () => Promise.resolve({ ok: false, reason: 'port busy' })))
    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'gateway-unavailable' })
  })

  it('answers 502 when the Gateway origin stops accepting connections', async () => {
    // A reachable status followed by a dead socket is the window between the
    // Gateway exiting and its supervisor noticing.
    const gateway = await startGateway((_request, response) => { response.writeHead(200); response.end() })
    const origin = `http://127.0.0.1:${String(gateway.port)}`
    gateway.gateway.closeAllConnections()
    await new Promise<void>((resolve) => { gateway.gateway.close(() => { resolve() }) })
    const port = await startProxy(locator(origin))

    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'gateway-unavailable' })
  })

  it('destroys the response when the Gateway dies after the headers went out', async () => {
    // Past writeHead there is no status left to send, so the only honest
    // signal is a truncated body — a 502 here would look like a complete one.
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1024' })
      // Flushed first, so the proxy has already committed a 200 downstream by
      // the time the connection dies.
      response.write('partial', () => { response.socket?.destroy() })
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    await expect(
      fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/big`).then(r => r.arrayBuffer()),
    ).rejects.toThrow()
  })

  it('tears the client socket down when the upstream socket dies mid-stream', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const sockets = new WebSocketServer({ server: gateway.gateway, path: '/uf/file-key-1' })
    sockets.on('connection', (socket) => { socket.send('open') })
    disposers.push(async () => { await new Promise<void>((resolve) => { sockets.close(() => { resolve() }) }) })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const client = new WebSocket(`ws://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/file-key-1`)
    await once(client, 'message')
    const clientClosed = once(client, 'close')
    for (const upstream of sockets.clients) upstream.terminate()
    await clientClosed
  })
})

describe('proxy path and body rewriting', () => {
  it('rewrites a stripped prefix to a rooted target and leaves a passthrough target alone', () => {
    expect(upstreamTarget('/univer-gw/?file=KEY', '/univer-gw', true)).toBe('/?file=KEY')
    expect(upstreamTarget('/univer-gw/assets/x.js', '/univer-gw', true)).toBe('/assets/x.js')
    // The prefix on its own leaves nothing behind, which must still be a root.
    expect(upstreamTarget('/univer-gw', '/univer-gw', true)).toBe('/')
    expect(upstreamTarget('/uf/file-key?rev=7', '/uf', false)).toBe('/uf/file-key?rev=7')
  })

  it('ignores the authority of an absolute-form target instead of slicing into it', () => {
    // Slicing the RAW target by prefix length cut into the authority and
    // forwarded `/l.example/...`, a path the client chose. Parsing first
    // discards the authority, so absolute form resolves to the same target the
    // equivalent origin-form request produces.
    expect(upstreamTarget('http://evil.example/univer-gw/?file=K', '/univer-gw', true)).toBe('/?file=K')
    expect(upstreamTarget('http://evil.example/uf/k', '/uf', false)).toBe('/uf/k')
    expect(upstreamTarget('http://evil.example/', '/univer-gw', true)).toBeNull()
  })

  it('refuses a target that is not the prefix it was routed under', () => {
    // A dot segment that walks out of the prefix during normalization.
    expect(upstreamTarget('/univer-gw/../secret', '/univer-gw', true)).toBeNull()
    expect(upstreamTarget('/univer-gw/%2e%2e/secret', '/univer-gw', true)).toBeNull()
    // A prefix that only shares a leading substring.
    expect(upstreamTarget('/univer-gwild', '/univer-gw', true)).toBeNull()
  })

  it('refuses an encoded traversal the Gateway would decode itself', () => {
    // WHATWG leaves `..%2f` as one opaque segment, so normalization alone does
    // not remove it; whatever decodes next would read a traversal step.
    expect(upstreamTarget('/uf/..%2f..%2fetc/passwd', '/uf', false)).toBeNull()
    expect(upstreamTarget('/univer-gw/a/..%5cb', '/univer-gw', true)).toBeNull()
    // A segment that does not decode at all is refused for the same reason.
    expect(upstreamTarget('/uf/%zz', '/uf', false)).toBeNull()
    // A target that does not parse at all, even against a base.
    expect(upstreamTarget('http://[', '/uf', false)).toBeNull()
  })

  it('re-roots asset references only where a URL can start', () => {
    expect(rewriteAssetReferences('<img src="/assets/a.png">')).toBe('<img src="/univer-gw/assets/a.png">')
    expect(rewriteAssetReferences('url(/assets/f.woff2)')).toBe('url(/univer-gw/assets/f.woff2)')
    expect(rewriteAssetReferences('/assets/at-start')).toBe('/univer-gw/assets/at-start')
    // Already inside another path, so not a root-relative reference.
    expect(rewriteAssetReferences('https://cdn.example/assets/x')).toBe('https://cdn.example/assets/x')
  })
})

describe('browser-trust fence', () => {
  /** Read one response, whatever its status. */
  async function get(port: number, path: string): Promise<{ status: number; body: string }> {
    const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
    return { status: response.status, body: await response.text() }
  }

  it('refuses every proxied route the fence rejects, without reaching the Gateway', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(200); response.end('served') })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`), { isTrusted: () => false })

    for (const path of [`${GATEWAY_PROXY_PREFIX}/?file=KEY`, `${GATEWAY_FILE_PREFIX}/file-key-1`]) {
      const refused = await get(port, path)
      expect(refused.status).toBe(403)
      expect(JSON.parse(refused.body)).toEqual({ error: 'forbidden' })
    }
    // The decision is made before the hop, so the Gateway saw nothing at all.
    expect(gateway.seen).toEqual([])
  })

  it('refuses the WebSocket upgrade the fence rejects', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`), { isTrusted: () => false })

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const first = once(socket, 'data')
    socket.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    )
    const [data] = await first as [Buffer]
    expect(String(data)).toContain('403 Forbidden')
    expect(gateway.seen).toEqual([])
    socket.destroy()
  })

  it('refuses a target the proxy will not forward before resolving a Gateway', async () => {
    // `locator(null)` would answer 503 if the hop were attempted, so a 400 here
    // also proves the target is judged first.
    const port = await startProxy(locator(null), { autoStartGateway: false })
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const first = once(socket, 'data')
    socket.write(`GET ${GATEWAY_FILE_PREFIX}/..%2f..%2fetc/passwd HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`)
    const [data] = await first as [Buffer]
    expect(String(data)).toContain('400 Bad Request')
    expect(String(data)).toContain('invalid-target')
    socket.destroy()
  })
})

describe('header hygiene across the hop', () => {
  it('withholds the browser credentials and every client-stated forwarding header', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(200); response.end('ok') })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/k`, {
      headers: {
        'cookie': 'dsh_session=secret',
        'authorization': 'Bearer secret',
        'proxy-authorization': 'Basic secret',
        'forwarded': 'for=203.0.113.9',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        'x-real-ip': '203.0.113.9',
        'true-client-ip': '203.0.113.9',
        'x-client-ip': '203.0.113.9',
        'x-cluster-client-ip': '203.0.113.9',
        'cf-connecting-ip': '203.0.113.9',
        'fastly-client-ip': '203.0.113.9',
        'via': '1.1 evil-proxy',
        'x-keep-me': 'yes',
      },
    })
    const seen = gateway.seen.at(-1)
    if (seen === undefined) throw new Error('the Gateway received no request')
    // The Gateway is an unauthenticated loopback service: it must not be handed
    // the operator's ambient credentials for the harness origin, and it must not
    // be told a client-chosen client address.
    for (const withheld of [
      'cookie', 'authorization', 'proxy-authorization', 'forwarded',
      'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host',
      // Client-address and proxy-provenance names a caller must not assert.
      'x-real-ip', 'true-client-ip', 'x-client-ip', 'x-cluster-client-ip',
      'cf-connecting-ip', 'fastly-client-ip', 'via',
    ]) {
      expect(seen.headers[withheld]).toBeUndefined()
    }
    // An ordinary header still crosses, and host is re-pointed at the Gateway.
    expect(seen.headers['x-keep-me']).toBe('yes')
    expect(seen.headers.host).toBe(`127.0.0.1:${String(gateway.port)}`)
  })

  it('does not relay the Gateway cookies onto the harness origin', async () => {
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'set-cookie': ['gw=1', 'gw2=2'],
        'x-gateway': 'kept',
      })
      response.end('body')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/k`)
    // A Gateway cookie on the harness origin is indistinguishable from the
    // harness's own and would travel to every harness route afterwards.
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-gateway')).toBe('kept')
  })
})

describe('encoded and oversized bodies', () => {
  it('streams a compressed HTML body untouched instead of mangling it', async () => {
    const html = '<link href="/assets/index.css">'
    const packed = gzipSync(Buffer.from(html, 'utf8'))
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': String(packed.length),
      })
      response.end(packed)
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    // fetch decodes the gzip: a body the proxy had rewritten as text would no
    // longer inflate, and the surviving header would make that the browser's
    // problem rather than a visible proxy failure.
    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)
    expect(await response.text()).toBe(html)
  })

  it('rewrites an identity-encoded HTML body as before', async () => {
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'identity' })
      response.end('<link href="/assets/index.css">')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)
    expect(await response.text()).toBe(`<link href="${GATEWAY_PROXY_PREFIX}/assets/index.css">`)
  })

  it('stops buffering an oversized body and streams the remainder unrewritten', async () => {
    // Past the ceiling this is not the Viewer document the rewrite exists for,
    // and holding it would let one response own the host's memory.
    const filler = 'x'.repeat(1024 * 1024)
    const gateway = await startGateway((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      for (let written = 0; written < 9; written += 1) response.write(filler)
      response.end('<link href="/assets/tail.css">')
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const body = await (await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_PROXY_PREFIX}/`)).text()
    expect(body).toHaveLength(9 * filler.length + '<link href="/assets/tail.css">'.length)
    expect(body.endsWith('<link href="/assets/tail.css">')).toBe(true)
  })
})

describe('upstream deadline and client abandonment', () => {
  it('answers 504 when the Gateway accepts the request and then stalls', async () => {
    const hung: ServerResponse[] = []
    const gateway = await startGateway((_request, response) => { hung.push(response) })
    disposers.push(async () => {
      for (const response of hung) response.destroy()
      await Promise.resolve()
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`), { proxyTimeoutMs: 150 })

    const response = await fetch(`http://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/k`)
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: 'gateway-timeout' })
  })

  it('destroys the upstream hop when the browser goes away mid-response', async () => {
    const hung: ServerResponse[] = []
    let upstreamAborted = false
    const gateway = await startGateway((request, response) => {
      hung.push(response)
      request.once('aborted', () => { upstreamAborted = true })
      response.socket?.once('close', () => { upstreamAborted = true })
    })
    disposers.push(async () => {
      for (const response of hung) response.destroy()
      await Promise.resolve()
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const abort = new AbortController()
    const pending = fetch(`http://127.0.0.1:${String(port)}${GATEWAY_FILE_PREFIX}/k`, { signal: abort.signal })
    await vi.waitFor(() => { expect(hung).toHaveLength(1) })
    abort.abort()
    await expect(pending).rejects.toThrow()
    // Without this the Gateway would keep working on a response nobody reads.
    await vi.waitFor(() => { expect(upstreamAborted).toBe(true) })
  })

  it('destroys the upstream handshake when the browser disconnects mid-upgrade', async () => {
    // The teardown handlers must exist before the upstream request is issued;
    // registering them inside the `upgrade` callback is too late for a client
    // that leaves while the Gateway is still deciding.
    let upstreamClosed = false
    const gateway = await startGateway((request, _response) => {
      // Never answer: the handshake stays open until someone tears it down.
      request.once('aborted', () => { upstreamClosed = true })
      request.socket.once('close', () => { upstreamClosed = true })
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    )
    await vi.waitFor(() => { expect(gateway.seen).toHaveLength(1) })
    socket.destroy()
    await vi.waitFor(() => { expect(upstreamClosed).toBe(true) })
  })
})

describe('upgrade handshake edge cases', () => {
  /** Open a raw upgrade request and read the first bytes the proxy writes back. */
  async function handshake(port: number, path: string): Promise<{ socket: Socket; head: string }> {
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const first = once(socket, 'data')
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    )
    const [data] = await first as [Buffer]
    return { socket, head: String(data) }
  }

  it('refuses an upgrade whose target the proxy will not forward', async () => {
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const { socket, head } = await handshake(port, `${GATEWAY_FILE_PREFIX}/..%2f..%2fetc/passwd`)
    expect(head).toContain('400 Bad Request')
    expect(gateway.seen).toEqual([])
    socket.destroy()
  })

  it('closes the handshake when the Gateway accepts it and never answers', async () => {
    const stalled: IncomingMessage[] = []
    const gateway = await startGateway((request) => { stalled.push(request) })
    disposers.push(async () => {
      for (const request of stalled) request.socket.destroy()
      await Promise.resolve()
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`), { proxyTimeoutMs: 150 })

    const { socket, head } = await handshake(port, `${GATEWAY_FILE_PREFIX}/k`)
    expect(head).toContain('504 Gateway Timeout')
    socket.destroy()
  })

  it('replays bytes the client sent before the 101 arrived', async () => {
    // The client socket is read during the handshake so an abandoned one is
    // noticed; anything it sends in that window must still reach the Gateway.
    const upgraded: Duplex[] = []
    const fromClient: Buffer[] = []
    let release: (() => void) | undefined
    const gateway = await startGateway((_request, response) => { response.writeHead(404); response.end() })
    disposers.push(async () => {
      for (const stream of upgraded) stream.destroy()
      await Promise.resolve()
    })
    gateway.gateway.on('upgrade', (_request, upstreamSocket) => {
      upgraded.push(upstreamSocket)
      upstreamSocket.on('data', (chunk: Buffer) => fromClient.push(chunk))
      // Held open so the client can speak before the 101 is written back.
      release = (): void => {
        upstreamSocket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
      }
    })
    const port = await startProxy(locator(`http://127.0.0.1:${String(gateway.port)}`))

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    socket.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n`,
    )
    await vi.waitFor(() => { expect(release).toBeDefined() })
    socket.write('EARLY-BYTES')
    await new Promise(resolve => setTimeout(resolve, 50))
    release?.()
    await once(socket, 'data')
    await vi.waitFor(() => { expect(Buffer.concat(fromClient).toString()).toContain('EARLY-BYTES') })
    socket.destroy()
  })
})
