import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { ResolvedConfig } from '../config.ts'
import type {} from '../service/univer-service.ts'
import {
  createGatewayHttpProxy,
  createGatewayUpgradeBridge,
  GATEWAY_FILE_PREFIX,
  GATEWAY_PROXY_PREFIX,
  type RequestTrustCheck,
} from './gateway-proxy.ts'
import { createUniverRouter } from './router.ts'

/**
 * Services required by the browser API consumer.
 *
 * `connection` is required, not optional: it owns the deployment's
 * `trustedHosts` and therefore the only correct answer to whether a browser
 * request may reach these routes. A composition serving this Viewer without it
 * would have to invent a second trust policy, so an absent Connection leaves
 * the routes unmounted instead.
 */
export const inject = ['univer', 'webServer', 'sessions', 'connection']
export const name = 'univer-web'

/**
 * Register the browser API and the Gateway reverse proxy as host webserver
 * routes. The Viewer runs in an iframe on the harness origin, so all three
 * registrations must be same-origin; the Gateway's own loopback origin is
 * reachable only from the host process.
 * @param ctx - Cordis context carrying `univer`, `webServer`, `sessions`, and `connection`.
 * @param config - resolved plugin configuration; `autoStartGateway` and `proxyTimeoutMs` are read.
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  // Read through the service rather than copied into a local policy, so these
  // routes and `/api` cannot answer the same request differently.
  const isTrusted: RequestTrustCheck = headers => ctx.connection.isTrustedRequest(headers)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/univer-api',
    handler: createUniverRouter(ctx.univer, ctx.sessions, isTrusted),
  }), 'univer: browser api')

  const options = {
    autoStartGateway: config.autoStartGateway,
    isTrusted,
    proxyTimeoutMs: config.proxyTimeoutMs,
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: GATEWAY_PROXY_PREFIX,
    handler: createGatewayHttpProxy(ctx.univer, options, GATEWAY_PROXY_PREFIX, true),
  }), 'univer: gateway proxy')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: GATEWAY_FILE_PREFIX,
    handler: createGatewayHttpProxy(ctx.univer, options, GATEWAY_FILE_PREFIX, false),
  }), 'univer: gateway file passthrough')
  ctx.effect(() => ctx.webServer.registerUpgrade({
    kind: 'prefix',
    path: GATEWAY_FILE_PREFIX,
    handler: createGatewayUpgradeBridge(ctx.univer, options),
  }), 'univer: gateway websocket bridge')
}
