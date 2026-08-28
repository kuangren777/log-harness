import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { UniverError } from '../service/errors.ts'
import type { UniverService } from '../service/univer-service.ts'
import { GATEWAY_FORBIDDEN_BODY, type RequestTrustCheck } from './gateway-proxy.ts'
import { gatewayStartRoute } from './routes/gateway.ts'
import { stateRoute } from './routes/state.ts'
import { statusRoute } from './routes/status.ts'
import { worktreeActionRoute } from './routes/worktree-action.ts'

const MAX_BODY_BYTES = 64 * 1024

/**
 * Create the `/univer-api` HTTP dispatcher.
 *
 * The browser-trust fence runs before any route: this API starts the Gateway
 * and mutates a local document store, including a `discard` that destroys
 * work, so it carries the same DNS-rebinding and cross-site defense the RPC
 * channel applies to `/api` rather than trusting whatever reached the socket.
 *
 * Every failure is answered as JSON: an untrusted request becomes 403, a
 * request the caller can correct becomes 400 (403 when the workspace denied
 * the path), anything else 500.
 * @param service - the Univer Provider the routes call.
 * @param sessions - the store each request's session is looked up in.
 * @param isTrusted - the deployment's browser-trust fence.
 * @returns the request handler the host webserver registers.
 */
export function createUniverRouter(
  service: UniverService,
  sessions: SessionStore,
  isTrusted: RequestTrustCheck,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!isTrusted(request.headers)) {
      sendJson(response, 403, GATEWAY_FORBIDDEN_BODY)
      return
    }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/univer-api/status') {
        sendJson(response, 200, await statusRoute(service))
        return
      }
      if (request.method === 'POST' && url.pathname === '/univer-api/gateway/start') {
        sendJson(response, 200, await gatewayStartRoute(service))
        return
      }
      if (request.method === 'GET' && url.pathname === '/univer-api/state') {
        sendJson(response, 200, await stateRoute(service, sessions, url.searchParams.get('file'), url.searchParams.get('sessionId')))
        return
      }
      if (request.method === 'POST' && url.pathname === '/univer-api/worktree-action') {
        sendJson(response, 200, await worktreeActionRoute(service, sessions, await readJsonBody(request)))
        return
      }
      response.writeHead(404)
      response.end()
    } catch (error) {
      const rejected = error instanceof UniverError && (
        error.code === 'INVALID_REQUEST'
        || error.code === 'INVALID_FILE_PATH'
        || error.code === 'FILE_PERMISSION_DENIED'
        || error.code === 'SESSION_SCOPE_UNAVAILABLE'
        || error.code === 'SESSION_SCOPE_DENIED'
      )
      const forbidden = error instanceof UniverError && (
        error.code === 'FILE_PERMISSION_DENIED' || error.code === 'SESSION_SCOPE_DENIED'
      )
      const status = rejected ? (forbidden ? 403 : 400) : 500
      sendJson(response, status, {
        ok: false,
        code: error instanceof UniverError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Send a JSON response with no browser cache.
 * @param response - the open server response.
 * @param status - HTTP status to write.
 * @param value - body to serialize.
 */
export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw new UniverError('request body is too large', 'INVALID_REQUEST')
    chunks.push(buffer)
  }
  if (chunks.length === 0) throw new UniverError('JSON body is required', 'INVALID_REQUEST')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    throw new UniverError('request body must be valid JSON', 'INVALID_REQUEST', { cause: error })
  }
}
