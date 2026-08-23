/** Host-side WebSocket carrier for the two server-to-browser event streams. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import type { Principal } from '@deepseek-ai/dsh-auth'
import type {
  ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

type Frame = MuxFrame | HostFrame

function serverRequest(frame: RpcRequest<Frame>): ServerRequest {
  return {
    type: 'server-request',
    rpcId: frame.rpcId,
    method: frame.payload.type,
    payload: frame.payload,
  }
}

function send(socket: WebSocket, frame: RpcRequest<Frame>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('websocket downlink closed before frame delivery'))
      return
    }
    socket.send(JSON.stringify(serverRequest(frame)), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function failureFrame(error: unknown): RpcRequest<Frame> {
  return {
    rpcId: RpcId(randomUUID()),
    payload: {
      type: 'stream/error',
      error: { code: 'internal', message: String(error), details: {} },
    },
  }
}

/**
 * Owns WebSocket negotiation and frame pumping for the connection plugin's
 * two downlinks. Client messages are a protocol violation: upstream traffic
 * remains on HTTP.
 */
export class WebSocketDownlinks {
  private readonly server = new WebSocketServer({ noServer: true })
  private readonly pumps = new Set<Promise<void>>()

  /** @param api - host API supplying the typed event streams. */
  constructor(private readonly api: ApiProxy) {}

  /**
   * Upgrade one socket and pump the mux stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   * @param principal - the principal the transport authenticated this socket as.
   */
  handleMux(req: IncomingMessage, socket: Duplex, head: Buffer, principal: Principal): void {
    this.upgrade(req, socket, head, signal => this.api.events.mux({
      rpcId: RpcId(randomUUID()),
      payload: {},
      principal,
    }, signal))
  }

  /**
   * Upgrade one socket and pump the host stream until either side closes.
   * @param req - HTTP upgrade request.
   * @param socket - Raw socket transferred by the HTTP server.
   * @param head - Bytes already read after the upgrade headers.
   * @param principal - the principal the transport authenticated this socket as.
   */
  handleHost(req: IncomingMessage, socket: Duplex, head: Buffer, principal: Principal): void {
    this.upgrade(req, socket, head, signal => this.api.events.host({
      rpcId: RpcId(randomUUID()),
      payload: {},
      principal,
    }, signal))
  }

  /**
   * Terminate owned sockets and await the no-server acceptor plus frame pumps.
   * @returns A promise resolving after every socket and source iterator stops.
   */
  async close(): Promise<void> {
    for (const socket of this.server.clients) socket.terminate()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await Promise.all(this.pumps)
  }

  private upgrade<F extends Frame>(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    open: (signal: AbortSignal) => AsyncIterable<RpcRequest<F>>,
  ): void {
    this.server.handleUpgrade(req, socket, head, (websocket) => {
      const abort = new AbortController()
      websocket.once('close', () => { abort.abort() })
      websocket.once('error', () => { abort.abort() })
      websocket.once('message', () => {
        websocket.close(1008, 'downlink only')
      })
      const pump = this.pump(websocket, open(abort.signal), abort)
      this.pumps.add(pump)
      void pump.then(() => { this.pumps.delete(pump) })
    })
  }

  private async pump<F extends Frame>(
    socket: WebSocket,
    frames: AsyncIterable<RpcRequest<F>>,
    abort: AbortController,
  ): Promise<void> {
    try {
      for await (const frame of frames) await send(socket, frame)
    } catch (error) {
      if (!abort.signal.aborted) {
        try {
          await send(socket, failureFrame(error))
        } catch {
          // Socket loss won the race; no downstream remains to receive the failure frame.
        }
      }
    } finally {
      abort.abort()
      if (socket.readyState === WebSocket.OPEN) socket.close()
    }
  }
}

/** The refusals an upgrade can earn, and the status line and body each sends. */
const UPGRADE_REFUSALS = {
  401: { line: 'HTTP/1.1 401 Unauthorized', body: 'unauthorized' },
  403: { line: 'HTTP/1.1 403 Forbidden', body: 'forbidden' },
  503: { line: 'HTTP/1.1 503 Service Unavailable', body: 'unavailable' },
} as const

/** Why one upgrade was refused; the statuses are not interchangeable. */
export type UpgradeRefusal = keyof typeof UPGRADE_REFUSALS

/**
 * Reject an upgrade before protocol negotiation.
 *
 * 403 says the request came from somewhere this deployment does not serve,
 * 401 says it carried no usable credential, and 503 says this host is
 * configured to authenticate but currently cannot. A browser retries only the
 * second after signing in.
 * @param socket - Raw HTTP socket that remains owned by the caller.
 * @param status - the refusal to send.
 */
export function rejectWebSocketUpgrade(socket: Duplex, status: UpgradeRefusal): void {
  const refusal = UPGRADE_REFUSALS[status]
  socket.end([
    refusal.line,
    'Connection: close',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${String(Buffer.byteLength(refusal.body))}`,
    '',
    refusal.body,
  ].join('\r\n'))
}
