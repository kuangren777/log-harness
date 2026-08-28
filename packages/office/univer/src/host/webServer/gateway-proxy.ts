/**
 * Same-origin reverse proxy in front of the bundled Univer Gateway.
 *
 * The Gateway listens on its own loopback origin (`http://127.0.0.1:<port>`),
 * which only the host process can reach — a browser tab served by the harness
 * cannot. The prebuilt Viewer also addresses the Gateway with ABSOLUTE paths it
 * derives from `location.origin`: `/uf/<fileKey>` for file content and its
 * WebSocket, and `/assets/<chunk>` for its own code. Serving the Viewer from
 * the harness origin therefore needs two things this module provides: a path
 * the Viewer document hangs under, and a passthrough for the absolute paths it
 * emits afterwards.
 *
 * Two prefixes, deliberately asymmetric:
 * - `/univer-gw` is stripped, so `/univer-gw/?file=x` reaches the Gateway as
 *   `/?file=x`. HTML and CSS bodies coming back have `/assets/` rewritten to
 *   `/univer-gw/assets/`, which keeps the Viewer's own chunks off the harness
 *   web app's `/assets/*` routes — the two would otherwise collide.
 * - `/uf` is NOT stripped, because the Viewer builds those paths itself at
 *   runtime and the Gateway expects to see them verbatim.
 *
 * The `/assets` PREFIX stays the harness web app's — this proxy claims none of
 * it, and the rewrite above is what keeps the Viewer's markup off it. The
 * Viewer's JavaScript is a separate problem this module does not solve: its
 * module-preload helper builds absolute `/assets/<name>` URLs that no body
 * rewrite reaches, so `viewer-assets.ts` claims those exact names from the
 * bundled directory instead.
 *
 * Every route here is a browser-reachable surface in front of a local service
 * that performs destructive operations, so all three carry the same
 * browser-trust fence the RPC channel applies to `/api`, and the hop to the
 * Gateway starts from a header set this proxy controls rather than from
 * whatever the client sent.
 */

import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { UniverService } from '../service/univer-service.ts'

/** Path the Viewer document and its rewritten chunk URLs hang under; stripped before forwarding. */
export const GATEWAY_PROXY_PREFIX = '/univer-gw'

/** Path the Viewer addresses absolutely for file content and its WebSocket; forwarded verbatim. */
export const GATEWAY_FILE_PREFIX = '/uf'

/** Response body sent when no Gateway is reachable and none may be started. */
export const GATEWAY_UNAVAILABLE_BODY = { error: 'gateway-unavailable' } as const

/** Response body sent when a request fails the browser-trust fence. */
export const GATEWAY_FORBIDDEN_BODY = { error: 'forbidden' } as const

/** Response body sent when the Gateway did not answer within the configured deadline. */
export const GATEWAY_TIMEOUT_BODY = { error: 'gateway-timeout' } as const

/** Response body sent when the request target is not one this proxy will forward. */
export const GATEWAY_BAD_TARGET_BODY = { error: 'invalid-target' } as const

/**
 * Origin used only to parse a request target into its components. A client may
 * send an absolute-form target (`GET http://host/path`), so the string cannot
 * be treated as a path; parsing against a base normalizes both forms and the
 * base itself never reaches the Gateway.
 */
const PARSE_BASE = 'http://univer-proxy.invalid'

/**
 * Hop-by-hop headers, which belong to one connection and must not be forwarded
 * across a proxy (RFC 9110 section 7.6.1). `upgrade` and `connection` are
 * re-stated by the upgrade bridge itself, and node re-frames the body, so
 * carrying the originals over would desynchronize the two connections.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Request headers withheld from the Gateway on top of the hop-by-hop set.
 *
 * The Gateway is an unauthenticated loopback service that trusts its caller, so
 * the proxy must not hand it the browser's ambient credentials for the harness
 * origin (`cookie`, `authorization`) — a Viewer request would otherwise carry
 * the operator's session into a process that has no notion of it. The
 * The forwarding, client-address, and proxy-provenance headers are dropped
 * because a client controls them end to end: a Gateway that trusted
 * `x-forwarded-for`, `x-real-ip`, or `via` would be reading attacker-chosen
 * values. This proxy states none of them itself; the Gateway derives every URL
 * it builds from `host`, which is set explicitly below.
 *
 * A denylist rather than an allowlist, deliberately. The Gateway is a 43 MB
 * prebuilt bundle this repository cannot rebuild or fully enumerate, and a
 * missing allowlist entry would silently break a Viewer request with no e2e
 * coverage to catch it. The names withheld here are the ones a caller must not
 * be able to assert; searching the pinned bundle finds no quoted occurrence of
 * any of them, while headers it does consult (`content-type`, `accept-encoding`,
 * `sec-websocket-key`) appear as literals — so withholding these removes trust
 * inputs without removing anything the Gateway reads.
 */
const WITHHELD_REQUEST_HEADERS = new Set([
  'authorization',
  'cf-connecting-ip',
  'cookie',
  'fastly-client-ip',
  'forwarded',
  'proxy-authorization',
  'true-client-ip',
  'via',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-real-ip',
])

/**
 * Response headers withheld from the browser. The Gateway's cookies would land
 * on the harness origin, where they are indistinguishable from the harness's
 * own and travel to every harness route afterwards.
 */
const WITHHELD_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2'])

/** Content types whose bodies carry absolute `/assets/` URLs the Viewer must not resolve against the harness app. */
const REWRITTEN_TYPES = ['text/html', 'text/css']

/**
 * Ceiling on a body buffered for the `/assets/` rewrite. The Viewer document
 * and its stylesheets are far below it; anything larger is not a document this
 * rewrite was written for, and buffering it would let one response hold the
 * host's memory. Past the cap the response streams through unrewritten.
 */
const REWRITE_BUFFER_LIMIT = 8 * 1024 * 1024

/**
 * Absolute `/assets/` reference in a markup or stylesheet body. The captured
 * leading character keeps the match anchored to a URL position (`href="`,
 * `url(`, a bare `=`) so a path that merely contains the text is left alone.
 */
const ASSET_REFERENCE = /(^|[\s"'(=])\/assets\//g

/**
 * The Gateway-lifecycle slice of {@link UniverService} the proxy reads. Stated
 * as its own type because forwarding bytes needs an origin and nothing else:
 * the document operations on the full service are not the proxy's business.
 */
export type GatewayLocator = Pick<UniverService, 'gatewayStatus' | 'ensureGateway'>

/**
 * The browser-trust decision for one request, supplied by the deployment's
 * Connection service so this proxy and `/api` cannot drift apart.
 */
export type RequestTrustCheck = (headers: IncomingHttpHeaders) => boolean

/** How a proxied request reaches the Gateway. */
export interface GatewayProxyOptions {
  /** Start the Gateway on demand; when false an absent Gateway answers 503. */
  readonly autoStartGateway: boolean
  /** The browser-trust fence; a request it refuses is answered 403 and never forwarded. */
  readonly isTrusted: RequestTrustCheck
  /**
   * Idle deadline for the upstream hop, applied to both the HTTP proxy and the
   * upgrade handshake: the socket must produce activity within it, and each
   * byte restarts the clock. A slow but progressing transfer is therefore never
   * cut off, and a total cap on one response is deliberately not imposed.
   */
  readonly proxyTimeoutMs: number
}

/** The Gateway origin for one request, or why there is none. */
type OriginResult = { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly reason: string }

/**
 * Resolve the Gateway origin, starting it when the deployment allows it.
 * @param service - the Gateway-lifecycle slice of the Univer service.
 * @param options - whether an absent Gateway may be started on demand.
 * @returns the origin, or the reason no Gateway is reachable.
 */
async function resolveOrigin(service: GatewayLocator, options: GatewayProxyOptions): Promise<OriginResult> {
  const status = await service.gatewayStatus()
  if (status.gateway !== null) return { ok: true, origin: status.gateway }
  if (!options.autoStartGateway) return { ok: false, reason: status.reason ?? 'the Univer Gateway is not running' }
  const started = await service.ensureGateway()
  return started.ok ? { ok: true, origin: started.gateway } : { ok: false, reason: started.reason }
}

/**
 * Answer one request the proxy will not forward.
 * @param response - the client response to write.
 * @param status - the HTTP status to send.
 * @param body - the JSON body naming the refusal.
 */
function sendRefusal(response: ServerResponse, status: number, body: object): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(payload)),
  })
  response.end(payload)
}

/**
 * Copy request headers for the upstream hop: hop-by-hop and credential-bearing
 * headers dropped, and `host` re-pointed at the Gateway, which builds its own
 * URLs from it.
 * @param headers - the inbound request headers.
 * @param authority - the Gateway's `host:port`.
 * @returns headers to send upstream.
 */
function forwardHeaders(headers: IncomingHttpHeaders, authority: string): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase()
    /* v8 ignore next -- node never enumerates a header with an undefined
    value; only the index signature's type admits one. */
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name) || WITHHELD_REQUEST_HEADERS.has(name)) continue
    if (name.startsWith('x-forwarded-')) continue
    forwarded[key] = value
  }
  forwarded.host = authority
  return forwarded
}

/**
 * Whether any path segment is a traversal step once percent-decoded.
 *
 * WHATWG parsing already resolves the plain and `%2e` spellings of `..`, which
 * leaves the encoded-separator forms: `..%2f` is one opaque segment to the
 * parser and a traversal step to whatever decodes it next. A segment that does
 * not decode at all is refused for the same reason — the Gateway's decoder,
 * not this one, would decide what it means.
 * @param pathname - the parsed, already normalized pathname.
 * @returns true when the path must not be forwarded.
 */
function hasTraversalSegment(pathname: string): boolean {
  return pathname.split('/').some((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return true
    }
    return decoded.split(/[/\\]/).includes('..')
  })
}

/**
 * Build the upstream request target from one inbound request target.
 *
 * The raw target is never sliced: a client may send absolute form
 * (`GET http://evil.example/univer-gw/?file=K`), where a prefix-length slice
 * cuts into the authority and forwards a path the client chose. Parsing first
 * normalizes both forms, resolves dot segments, and lets the prefix be
 * re-checked on the result — a target that escaped the prefix during
 * normalization is refused rather than forwarded somewhere else.
 * @param url - the inbound request target, origin-form or absolute-form.
 * @param prefix - the registered route prefix.
 * @param strip - whether the prefix is removed before forwarding.
 * @returns the upstream target, or null when the request must be refused.
 */
export function upstreamTarget(url: string, prefix: string, strip: boolean): string | null {
  let parsed: URL
  try {
    parsed = new URL(url, PARSE_BASE)
  } catch {
    return null
  }
  const { pathname } = parsed
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null
  if (hasTraversalSegment(pathname)) return null
  if (!strip) return `${pathname}${parsed.search}`
  const rest = pathname.slice(prefix.length)
  return `${rest === '' ? '/' : rest}${parsed.search}`
}

/**
 * Rewrite absolute `/assets/` references so the Viewer loads its chunks
 * through this proxy instead of the harness web app's own `/assets/*`.
 * @param body - an HTML or CSS response body.
 * @returns the body with every asset reference re-rooted under the proxy prefix.
 */
export function rewriteAssetReferences(body: string): string {
  return body.replace(ASSET_REFERENCE, `$1${GATEWAY_PROXY_PREFIX}/assets/`)
}

/**
 * Whether a response body must be buffered and rewritten rather than streamed.
 *
 * A body under a `content-encoding` is compressed bytes: rewriting them as text
 * produces garbage that still carries the encoding header, so the browser fails
 * to decode a response the proxy reported as complete. Those stream through.
 * @param headers - the upstream response headers.
 * @returns true only for an unencoded HTML or CSS body.
 */
function isRewritten(headers: IncomingHttpHeaders): boolean {
  const encoding = headers['content-encoding']
  if (typeof encoding === 'string' && encoding.trim().toLowerCase() !== 'identity') return false
  const contentType = headers['content-type']
  if (contentType === undefined) return false
  const type = contentType.toLowerCase()
  return REWRITTEN_TYPES.some(candidate => type.startsWith(candidate))
}

/** Copy upstream response headers back to the client, minus hop-by-hop and cookie entries. */
function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copied: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase()
    /* v8 ignore next -- as in forwardHeaders: an enumerated header always has a value. */
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name) || WITHHELD_RESPONSE_HEADERS.has(name)) continue
    copied[key] = value
  }
  return copied
}

/**
 * Build the HTTP handler forwarding one prefix to the Gateway.
 *
 * Registered twice by the Web Consumer, once per prefix, because the two differ
 * only in whether the prefix is stripped.
 * @param service - the Gateway-lifecycle slice of the Univer service.
 * @param options - the trust fence, the upstream deadline, and whether an
 * absent Gateway may be started on demand.
 * @param prefix - the registered route prefix ({@link GATEWAY_PROXY_PREFIX} or
 * {@link GATEWAY_FILE_PREFIX}).
 * @param strip - whether to remove the prefix before forwarding.
 * @returns a handler owning the full response lifecycle of matched requests.
 */
export function createGatewayHttpProxy(
  service: GatewayLocator,
  options: GatewayProxyOptions,
  prefix: string,
  strip: boolean,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!options.isTrusted(request.headers)) {
      sendRefusal(response, 403, GATEWAY_FORBIDDEN_BODY)
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests. */
    const target = upstreamTarget(request.url ?? '/', prefix, strip)
    if (target === null) {
      sendRefusal(response, 400, GATEWAY_BAD_TARGET_BODY)
      return
    }
    const resolved = await resolveOrigin(service, options)
    if (!resolved.ok) {
      sendRefusal(response, 503, GATEWAY_UNAVAILABLE_BODY)
      return
    }
    const upstream = new URL(resolved.origin)
    await new Promise<void>((settle) => {
      const proxied = httpRequest({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: target,
        headers: forwardHeaders(request.headers, upstream.host),
      }, (upstreamResponse) => {
        // A failure arriving after the response headers surfaces on the
        // response stream, not on the request, and `pipe` does not forward it:
        // without this the client would wait out its own timeout.
        upstreamResponse.once('error', () => { failResponse(response, settle, 502, GATEWAY_UNAVAILABLE_BODY) })
        pipeBack(upstreamResponse, response, settle)
      })
      // Idle deadline, not a total one: node restarts this clock on every byte,
      // so a slow transfer survives and only a genuinely stalled Gateway trips
      // it. Without it a stall would hold the request, its socket, and the
      // handler promise open forever.
      proxied.setTimeout(options.proxyTimeoutMs, () => {
        failResponse(response, settle, 504, GATEWAY_TIMEOUT_BODY)
        proxied.destroy()
      })
      // A browser that navigates away must not leave the upstream hop running;
      // settling here is also what lets `webServer` disposal reach quiescence.
      response.once('close', () => {
        if (!response.writableFinished) proxied.destroy()
        settle()
      })
      proxied.once('error', () => { failResponse(response, settle, 502, GATEWAY_UNAVAILABLE_BODY) })
      request.pipe(proxied)
    })
  }
}

/**
 * Relay one upstream response, rewriting asset references in HTML and CSS and
 * streaming everything else.
 * @param upstreamResponse - the Gateway's response.
 * @param response - the client response to write.
 * @param settle - called once the client response is finished.
 */
function pipeBack(upstreamResponse: IncomingMessage, response: ServerResponse, settle: () => void): void {
  const headers = responseHeaders(upstreamResponse.headers)
  /* v8 ignore next -- `?? 502` arm: node:http always sets statusCode on a
  response it emitted; the field is only optional on the request-side type. */
  const status = upstreamResponse.statusCode ?? 502
  if (!isRewritten(upstreamResponse.headers)) {
    response.writeHead(status, headers)
    upstreamResponse.pipe(response)
    response.once('close', settle)
    return
  }
  // A rewrite changes the byte count, so the body cannot stream: buffer it,
  // then re-state content-length rather than leave the original value behind.
  const chunks: Buffer[] = []
  let buffered = 0
  let streaming = false
  upstreamResponse.on('data', (chunk: Buffer) => {
    if (streaming) return
    chunks.push(chunk)
    buffered += chunk.length
    if (buffered <= REWRITE_BUFFER_LIMIT) return
    // Past the ceiling this is not the Viewer document the rewrite exists for.
    // Flush what was held under the ORIGINAL headers and stream the remainder:
    // the body is then unrewritten, so the untouched content-length still fits.
    streaming = true
    response.writeHead(status, headers)
    for (const held of chunks) response.write(held)
    chunks.length = 0
    upstreamResponse.pipe(response)
    response.once('close', settle)
  })
  upstreamResponse.once('end', () => {
    if (streaming) return
    const body = rewriteAssetReferences(Buffer.concat(chunks).toString('utf8'))
    response.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(body)) })
    response.end(body, settle)
  })
}

/**
 * Fail one request whose upstream hop broke or timed out.
 *
 * Before the headers go out there is still a status to send. Afterwards the
 * response is already committed to a status and a length, and the only signal
 * that does not misreport a truncated body as a complete one is a reset.
 * @param response - the client response to fail.
 * @param settle - called once the client response is finished.
 * @param status - the status to send when nothing has been written yet.
 * @param body - the JSON body naming the failure.
 */
function failResponse(response: ServerResponse, settle: () => void, status: number, body: object): void {
  // One broken connection can raise several handlers; every arm stays safe on a
  // second arrival, because `destroy` and settling a promise are idempotent.
  if (response.headersSent || response.writableEnded) {
    response.destroy()
    settle()
    return
  }
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
  })
  response.end(payload, settle)
}

/**
 * The 101 response head replayed to the client.
 *
 * Built from `rawHeaders`, not the parsed map: node folds repeated headers into
 * one comma-joined string there, and a folded list changes what a repeated
 * header means — illegally so for `Set-Cookie`. Replaying the raw pairs keeps
 * each value on its own line. The Gateway's cookies are dropped here for the
 * same reason they are dropped from an ordinary response.
 * @param statusLine - the upstream status line.
 * @param rawHeaders - the upstream 101 headers as received, `[name, value, …]`.
 * @returns the bytes to write to the client socket.
 */
function upgradeHead(statusLine: string, rawHeaders: readonly string[]): string {
  const lines: string[] = [statusLine]
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]
    const value = rawHeaders[index + 1]
    /* v8 ignore next -- the loop bound keeps both indexes in range; only
    `noUncheckedIndexedAccess` admits undefined here. */
    if (name === undefined || value === undefined) continue
    if (WITHHELD_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    lines.push(`${name}: ${value}`)
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

/**
 * Build the upgrade handler bridging a client WebSocket to the Gateway.
 *
 * Registered as a PREFIX upgrade route on `/uf`, because the Viewer picks the
 * sub-path (`/uf/<fileKey>`) at runtime. The bridge is protocol-agnostic: it
 * replays the Gateway's own 101 response head to the client and then couples
 * the two sockets, so WebSocket framing stays entirely between the endpoints.
 * @param service - the Gateway-lifecycle slice of the Univer service.
 * @param options - the trust fence, the handshake deadline, and whether an
 * absent Gateway may be started on demand.
 * @returns a handler owning the client socket after dispatch.
 */
export function createGatewayUpgradeBridge(
  service: GatewayLocator,
  options: GatewayProxyOptions,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> {
  return async (request, socket, head) => {
    if (!options.isTrusted(request.headers)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests. */
    const target = upstreamTarget(request.url ?? '/', GATEWAY_FILE_PREFIX, false)
    if (target === null) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    const resolved = await resolveOrigin(service, options)
    if (!resolved.ok) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = new URL(resolved.origin)
    // `httpRequest` performs no I/O until `end()` below, so building the
    // request first and registering every teardown handler before that call
    // still means nothing can be abandoned before someone is listening.
    const proxied = httpRequest({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: target,
      headers: { ...forwardHeaders(request.headers, upstream.host), connection: 'Upgrade', upgrade: 'websocket' },
    })
    const abandon = (): void => {
      // Destroying the request alone leaves the socket node already handed to
      // this upgrade, so the Gateway would hold the half-open handshake until
      // its own timeout.
      proxied.socket?.destroy()
      proxied.destroy()
      socket.destroy()
    }
    // `end` as well as `close`: an abandoned handshake arrives as a FIN, and
    // the socket stays half-open afterwards, so `close` alone would not run
    // until something else tore the connection down. A client that half-closes
    // mid-handshake is not waiting for a 101.
    socket.once('end', abandon)
    socket.once('close', abandon)
    socket.on('error', abandon)
    // A paused socket never reports the peer leaving, and nothing reads this
    // one until the bridge is coupled: without flowing it now, a client that
    // gives up during the handshake goes unnoticed and `abandon` never runs.
    // Anything it sends before the 101 is held and replayed to the Gateway.
    const early: Buffer[] = []
    const collectEarly = (chunk: Buffer): void => { early.push(chunk) }
    socket.on('data', collectEarly)
    proxied.setTimeout(options.proxyTimeoutMs, () => {
      socket.end('HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n')
      proxied.destroy()
    })
    proxied.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      /* v8 ignore next -- `?? ''` arm: node fills statusMessage on every
      response it parsed, so only the request-side type admits undefined. */
      const statusLine = `HTTP/1.1 ${String(upstreamResponse.statusCode)} ${upstreamResponse.statusMessage ?? ''}`.trimEnd()
      // The handshake succeeded, so the socket now belongs to the bridge: its
      // teardown must destroy the peer socket rather than the request object.
      socket.off('end', abandon)
      socket.off('close', abandon)
      socket.off('error', abandon)
      // Stop the early-read before handing the socket to the bridge, so no
      // byte is dropped between the last `data` event and the pipe below.
      socket.pause()
      socket.off('data', collectEarly)
      socket.write(upgradeHead(statusLine, upstreamResponse.rawHeaders))
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      for (const pending of [head, ...early]) {
        if (pending.length > 0) upstreamSocket.write(pending)
      }
      // Either endpoint closing must tear down the other: a half-open bridge
      // would leak the surviving socket for the lifetime of the process.
      upstreamSocket.once('close', () => socket.destroy())
      socket.once('close', () => upstreamSocket.destroy())
      upstreamSocket.on('error', () => socket.destroy())
      socket.on('error', () => upstreamSocket.destroy())
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
    })
    // A non-upgrade answer means the Gateway refused the handshake; the client
    // socket is already committed to an upgrade, so the only honest reply is to
    // close it rather than write a body it will not parse.
    proxied.once('response', () => { socket.destroy() })
    proxied.once('error', () => { socket.destroy() })
    proxied.end()
  }
}
