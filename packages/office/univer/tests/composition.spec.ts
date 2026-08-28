/**
 * Registration behaviour observed through real cordis compositions: which
 * `univer_*` tools a deployment ends up advertising, and which webserver
 * routes carry the Viewer. Both are the user-visible result of configuration,
 * so both are asserted against the live registries rather than against the
 * plugin's internals.
 */

import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import * as univerPackage from '../src/index.ts'
import { resolveConfig } from '../src/host/config.ts'
import type { Config } from '../src/host/config.ts'
import type { EnsureGatewayResult, GatewayStatus } from '../src/shared/wire/status.ts'
import { UNIVER_TOOL_NAMES } from '../src/host/tools/names.ts'
import { UniverService } from '../src/host/service/univer-service.ts'
import * as toolsPlugin from '../src/host/tools/plugin.ts'
import * as webPlugin from '../src/host/webServer/plugin.ts'
import { GATEWAY_FILE_PREFIX, GATEWAY_PROXY_PREFIX } from '../src/host/webServer/gateway-proxy.ts'

/** Nothing in these tests reaches a document operation; only registration is observed. */
function unreachable(): never {
  throw new Error('univer service operation is not exercised by a registration test')
}

/**
 * A Univer Provider that reports a stopped Gateway and refuses every document
 * operation. Registration never calls one, so a throwing body is the honest
 * body: a silent stub would let a wrong call pass unnoticed.
 */
class StubUniverService extends UniverService {
  // The three Gateway-lifecycle reads keep their declared return types so a
  // suite that needs them answered can override one without widening the rest.
  gatewayStatus = (): Promise<GatewayStatus> => unreachable()
  ensureGateway = (): Promise<EnsureGatewayResult> => unreachable()
  unitContentStatus = (): Promise<'bundled' | 'unavailable'> => unreachable()
  fileState = (): never => unreachable()
  worktreeAction = (): never => unreachable()
  newFile = (): never => unreachable()
  status = (): never => unreachable()
  worktree = (): never => unreachable()
  unit = (): never => unreachable()
  inspectUnitContent = (): never => unreachable()
  executeUnitContent = (): never => unreachable()
  importUnitContent = (): never => unreachable()
  exportUnitContent = (): never => unreachable()
  lintUnitLayout = (): never => unreachable()
  screenshotUnit = (): never => unreachable()
  compileSvg = (): never => unreachable()
  apiReference = (): never => unreachable()
  resources = (): never => unreachable()
}

/** The session store the browser API router is handed; never read here. */
class StubSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** Mount the tools Consumer over a real tool registry and return the context. */
async function mountTools(config: Config): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubUniverService, resolveConfig({}))
  await ctx.plugin(toolsPlugin, resolveConfig(config))
  return ctx
}

/** Names the registry advertises out of this package's tool set. */
function registered(ctx: Context): string[] {
  return UNIVER_TOOL_NAMES.filter(name => ctx.tools.get(name) !== undefined)
}

describe('tool registration', () => {
  it('advertises every tool the deployment did not withhold', async () => {
    const ctx = await mountTools({})
    // `univer_screenshot` needs an attachment store to hold its image bytes, so
    // a deployment without one never sees it — that gate is upstream's, not
    // disabledTools'.
    const advertised = registered(ctx)
    expect(advertised).not.toContain('univer_screenshot')
    expect(advertised).toEqual(UNIVER_TOOL_NAMES.filter(name => name !== 'univer_screenshot'))
  })

  it('withholds exactly the configured names', async () => {
    const ctx = await mountTools({ disabledTools: ['univer_lint', 'univer_resources', 'univer_api'] })
    const advertised = registered(ctx)
    for (const withheld of ['univer_lint', 'univer_resources', 'univer_api']) {
      expect(advertised).not.toContain(withheld)
    }
    expect(advertised).toContain('univer_new')
    expect(advertised).toContain('univer_export')
    expect(advertised).toHaveLength(UNIVER_TOOL_NAMES.length - 4)
  })

  it('can withhold the whole set', async () => {
    expect(registered(await mountTools({ disabledTools: [...UNIVER_TOOL_NAMES] }))).toEqual([])
  })

  it('refuses to load when a withheld name matches no tool', () => {
    expect(() => resolveConfig({ disabledTools: ['univer_lint', 'univer_typo'] })).toThrow(/univer_typo/)
  })

  it('removes its tools when its own fiber is disposed', async () => {
    // Disposal is observed against a registry that outlives the Consumer, so
    // the assertion is that the contributions went away, not the service.
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubUniverService, resolveConfig({}))
    const consumer = await ctx.plugin(toolsPlugin, resolveConfig({}))
    expect(registered(ctx).length).toBeGreaterThan(0)

    await consumer.dispose()
    expect(registered(ctx)).toEqual([])
  })
})

describe('web route registration', () => {
  it('claims the browser API, both proxy prefixes, and the upgrade path', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection)
    await ctx.plugin(StubUniverService, resolveConfig({}))
    await ctx.plugin(StubSessions)
    await ctx.plugin(webPlugin, resolveConfig({}))

    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')
    // Re-registering a claimed (kind, path) throws, which is how an outside
    // observer confirms this plugin holds each seat.
    for (const path of ['/univer-api', GATEWAY_PROXY_PREFIX, GATEWAY_FILE_PREFIX]) {
      expect(() => server.register({ kind: 'prefix', path, handler: () => {} }))
        .toThrow(/duplicate prefix route/)
    }
    expect(() => server.registerUpgrade({ kind: 'prefix', path: GATEWAY_FILE_PREFIX, handler: () => {} }))
      .toThrow(/duplicate prefix upgrade route/)

    // `/assets` stays unclaimed: the harness web app owns it, and the proxy's
    // body rewrite is what keeps the Viewer off it.
    expect(() => server.register({ kind: 'prefix', path: '/assets', handler: () => {} })).not.toThrow()
  })

  it('releases every route when the fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection)
    await ctx.plugin(StubUniverService, resolveConfig({}))
    await ctx.plugin(StubSessions)
    const web = await ctx.plugin(webPlugin, resolveConfig({}))
    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')

    await web.dispose()
    for (const path of ['/univer-api', GATEWAY_PROXY_PREFIX, GATEWAY_FILE_PREFIX]) {
      expect(() => server.register({ kind: 'prefix', path, handler: () => {} })).not.toThrow()
    }
    expect(() => server.registerUpgrade({ kind: 'prefix', path: GATEWAY_FILE_PREFIX, handler: () => {} })).not.toThrow()
    await ctx.fiber.dispose()
  })
})

describe('package entry composition', () => {
  /** Everything the four rows of the package entry inject, and nothing else. */
  async function hostFor(config: Config): Promise<Context> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection)
    await ctx.plugin(StubSessions)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Skills)
    await ctx.plugin(univerPackage, config)
    return ctx
  }

  /** Univer skill names the catalog advertises. */
  async function univerSkills(ctx: Context): Promise<string[]> {
    const summaries = await ctx.skills.list()
    return summaries.filter(summary => summary.name.startsWith('univer')).map(summary => summary.name)
  }

  it('publishes the resolved configuration for Consumers mounted elsewhere', async () => {
    const ctx = await hostFor({ gatewayPort: 9099, gatewayStartupTimeoutMs: 7 })
    const service = ctx.get('univer')
    expect(service?.config.gatewayPort).toBe(9099)
    // Resolution, not passthrough: an unset key still arrives at its default.
    expect(service?.config.gatewayRequestTimeoutMs).toBe(3_000)
  })

  it('mounts the optional Consumers by default', async () => {
    const ctx = await hostFor({})
    expect(registered(ctx)).toContain('univer_new')
    expect(await univerSkills(ctx)).toContain('univer')
  })

  it('leaves each optional Consumer out when its flag is off', async () => {
    const ctx = await hostFor({ tools: false, skills: false })
    // The Provider and its browser routes stay: those are what the flags do not gate.
    expect(ctx.get('univer')).toBeDefined()
    expect(registered(ctx)).toEqual([])
    expect(await univerSkills(ctx)).toEqual([])
  })
})

describe('browser-trust fence over the real composition', () => {
  /**
   * A Provider that answers the two Gateway-lifecycle reads these routes make
   * and still refuses every document operation. The fence decides before any
   * of them runs, so a refusal here would hide the status the test reads.
   */
  class LifecycleUniverService extends StubUniverService {
    override gatewayStatus = (): Promise<GatewayStatus> =>
      Promise.resolve({ phase: 'stopped', gateway: null, owned: false })

    override ensureGateway = (): Promise<EnsureGatewayResult> =>
      Promise.resolve({ ok: false, reason: 'no Gateway in this composition' })

    override unitContentStatus = (): Promise<'bundled'> => Promise.resolve('bundled')
  }

  /** Boot the mounted Web Consumer over the real Connection service. */
  async function serve(trustedHosts: string[] = []): Promise<number> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection, { trustedHosts })
    await ctx.plugin(LifecycleUniverService, resolveConfig({}))
    await ctx.plugin(StubSessions)
    await ctx.plugin(webPlugin, resolveConfig({}))
    const server = ctx.get('webServer')
    if (server === undefined) throw new Error('webServer service did not activate')
    return server.port
  }

  /** One request carrying a chosen Host header, read to completion. */
  function send(port: number, method: string, path: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, method, path, headers: { host, 'content-type': 'application/json' } },
        (response) => {
          response.resume()
          response.once('end', () => { resolve(response.statusCode ?? 0) })
        },
      )
      request.once('error', reject)
      request.end(method === 'POST' ? '{"action":"discard"}' : undefined)
    })
  }

  it('refuses a DNS-rebound Host on every route this package registers', async () => {
    const port = await serve()
    // The socket lands here either way; `Host` is the header rebinding cannot
    // forge, and it is what the `/api` fence binds every request with.
    expect(await send(port, 'GET', '/univer-api/status', 'evil.example:3080')).toBe(403)
    expect(await send(port, 'POST', '/univer-api/worktree-action', 'evil.example:3080')).toBe(403)
    expect(await send(port, 'GET', `${GATEWAY_PROXY_PREFIX}/?file=KEY`, 'evil.example:3080')).toBe(403)
    expect(await send(port, 'GET', `${GATEWAY_FILE_PREFIX}/file-key-1`, 'evil.example:3080')).toBe(403)
  })

  it('refuses a rebound WebSocket upgrade as well', async () => {
    const port = await serve()
    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const first = once(socket, 'data')
    socket.write(
      `GET ${GATEWAY_FILE_PREFIX}/k HTTP/1.1\r\nHost: evil.example:3080\r\n`
      + 'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    )
    const [data] = await first as [Buffer]
    expect(String(data)).toContain('403 Forbidden')
    socket.destroy()
  })

  it('admits loopback, and a declared trusted authority, exactly as /api does', async () => {
    const loopback = await serve()
    // Past the fence the request reaches the route: no Gateway is running in
    // this composition, so the honest answer is 503, never 403.
    expect(await send(loopback, 'GET', `${GATEWAY_FILE_PREFIX}/k`, '127.0.0.1:1')).toBe(503)
    expect(await send(loopback, 'GET', '/univer-api/status', '127.0.0.1:1')).toBe(200)

    const declared = await serve(['studio.internal'])
    expect(await send(declared, 'GET', '/univer-api/status', 'studio.internal')).toBe(200)
    expect(await send(declared, 'GET', '/univer-api/status', 'other.internal')).toBe(403)
  })

  it('keeps the Gateway loopback origin out of the browser status payload', async () => {
    const port = await serve()
    const body = await (await fetch(`http://127.0.0.1:${String(port)}/univer-api/status`)).json() as {
      gateway: Record<string, unknown>
    }
    // Phase and reachability are what the page needs; the port the Gateway
    // binds is host-process detail an attacker would use to address it.
    expect(body.gateway).toEqual({ phase: 'stopped', gatewayRunning: false, owned: false })
  })
})
