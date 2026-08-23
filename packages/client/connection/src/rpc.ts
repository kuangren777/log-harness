/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Trust fence applied before a Host RPC channel reaches its handler. */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  readonly authority: ConnectionRpcAuthority
}

/**
 * The request facts a channel may need beyond its payload. A channel that
 * authenticates its own caller — the sign-in channel is the reason this
 * exists — cannot read them from the envelope: credentials ride headers, and
 * the client address is a property of the socket rather than of the message.
 */
export interface ConnectionRpcCaller {
  /** Request headers as the carrier received them. */
  readonly headers: Headers
  /** Client address the HTTP server saw, or `undefined` when the carrier exposes none. */
  readonly ip: string | undefined
}

/**
 * A reply that also sets the browser's credential cookie.
 *
 * `Set-Cookie` is the only header a channel may contribute, and only because
 * an HttpOnly credential cannot be delivered any other way; every other
 * response header belongs to the carrier.
 */
export interface ConnectionRpcReply {
  /** The business result, wrapped into the standard server-response envelope. */
  readonly result: RpcResult<unknown>
  /** Complete `Set-Cookie` header value to send with this reply. */
  readonly setCookie: string
}

/**
 * Handler invoked after Connection has decoded the transport envelope. A
 * handler that needs neither the caller facts nor a cookie declares neither.
 */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  caller: ConnectionRpcCaller,
) => Promise<RpcResult<unknown> | ConnectionRpcReply>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}
