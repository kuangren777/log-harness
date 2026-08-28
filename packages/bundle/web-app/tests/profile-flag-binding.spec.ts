/**
 * The three-hop invocation binding a `--profile` boot actually performs:
 * `web-startup` parses the flags and provides `webStartup`, the `web-runtime`
 * row reads that service through its own config expressions and provides
 * `webRuntime`, and the `connection` row reads `webRuntime`. Asserted over a
 * real Loader tree with the real plugin bodies, because a bundle-patch
 * expression is only resolved by the Loader — a hand-built `ctx.plugin` call
 * passes config directly and would prove nothing about the chain.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals as cmdlineInternals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply as webAppApply, Config as WebAppConfig, internals as webAppInternals, type WebRuntimeValues,
} from '../src/index.ts'
import { apply as startupApply } from '../src/startup.ts'

/** The real bundle patch: the expressions under test are read from it, never retyped blind. */
const PATCH = readFileSync(
  fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)),
  'utf8',
)

/** What one booted fixture tree observed. */
interface Observed {
  /** Config the `connection`-shaped consumer row received, after expression resolution. */
  connectionConfig?: { trustedHosts?: unknown; privilegedTrustedHosts?: unknown }
  /** The `webRuntime` value the real web-app plugin published. */
  runtime?: WebRuntimeValues
  exits: number[]
  out: string
  /** Readiness lines the row printed (`printUrl` is true, as in the bundle patch). */
  lines: string[]
}

const disposers: (() => Promise<void>)[] = []
const originalResolveDist = webAppInternals.resolveDistIndex

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  cmdlineInternals.stdout = process.stdout
  cmdlineInternals.stderr = process.stderr
  webAppInternals.resolveDistIndex = originalResolveDist
  vi.restoreAllMocks()
})

/** A webServer stand-in satisfying the web-app row and its frontend-static child. */
function fakeWebServer(): WebServer {
  return {
    host: '127.0.0.1',
    port: 4567,
    registerFallback: () => () => {},
    renderIndex: (html: string) => html,
  } as unknown as WebServer
}

/**
 * Boot a Loader tree carrying the four rows this binding runs through, with
 * the same `inject` lists and the same config expressions the bundle patch
 * uses. Row bodies are the real ones: the fixture modules Node loads outside
 * Vite's resolver delegate to the sources this test imported.
 * @param args - the invocation's inner arguments.
 * @returns what the tree published and observed.
 */
async function bootProfileTree(args: string[]): Promise<Observed> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-web-flag-binding-'))
  const observed: Observed = { exits: [], out: '', lines: [] }
  const index = join(dir, 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  webAppInternals.resolveDistIndex = () => index

  writeFileSync(join(dir, 'web-server.mjs'), `
export function apply(ctx) { ctx.provide('webServer', globalThis.__flagBinding.webServer()) }
`)
  writeFileSync(join(dir, 'web-startup.mjs'), `
export const name = 'web-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__flagBinding.startupApply(ctx)
`)
  writeFileSync(join(dir, 'web-runtime.mjs'), `
export const name = 'web-app'
export const inject = ['webServer']
export const Config = globalThis.__flagBinding.webAppConfig
export const apply = (ctx, config) => { globalThis.__flagBinding.webAppApply(ctx, config) }
`)
  writeFileSync(join(dir, 'connection.mjs'), `
export const apply = (ctx, config) => {
  const observed = globalThis.__flagBinding.observed
  observed.connectionConfig = config
  // The service the row injected, read from the consumer side — the only place
  // a downstream row can see what the web-runtime hop published.
  observed.runtime = ctx.get('webRuntime')
}
`)
  // The rows' `inject` lists and config expressions mirror the bundle patch
  // verbatim; the assertions below pin that they still match the real file.
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: web-server',
    `  name: ${pathToFileURL(join(dir, 'web-server.mjs')).href}`,
    '- id: web-startup',
    `  name: ${pathToFileURL(join(dir, 'web-startup.mjs')).href}`,
    '- id: web-runtime',
    `  name: ${pathToFileURL(join(dir, 'web-runtime.mjs')).href}`,
    // Exactly the real row's inject list: config expressions are released by
    // `webStartup` alone, while the plugin's own `inject` waits for webServer.
    // A wider row inject here would mask an ordering defect between the hops.
    '  inject: [webStartup]',
    '  config:',
    '    openBrowser: !!js ctx.webStartup.openBrowser',
    '    printUrl: true',
    '    surfaceContext: true',
    '    trustedHosts: !!js ctx.webStartup.trustedHosts',
    '    privilegedTrustedHosts: !!js ctx.webStartup.privilegedTrustedHosts',
    '- id: connection',
    `  name: ${pathToFileURL(join(dir, 'connection.mjs')).href}`,
    '  inject: [webRuntime]',
    '  config:',
    '    trustedHosts: !!js ctx.webRuntime.trustedHosts',
    '    privilegedTrustedHosts: !!js ctx.webRuntime.privilegedTrustedHosts',
    '',
  ].join('\n'))

  // printUrl stays at the row's real value, so the readiness line is captured
  // rather than written to the test runner's stdout.
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => { observed.lines.push(String(line)) })
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  cmdlineInternals.stdout = observing
  cmdlineInternals.stderr = observing
  ;(globalThis as unknown as { __flagBinding: unknown }).__flagBinding = {
    startupApply,
    webAppApply,
    webAppConfig: WebAppConfig,
    webServer: fakeWebServer,
    observed,
  }

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return observed
}

describe('the privileged-trusted-hosts flag over a profile boot', () => {
  it('keeps the bundle patch carrying both hops of the binding', () => {
    // A patch row that stops restating either expression is how the value
    // would silently become the schema default at either hop.
    expect(PATCH).toContain('privilegedTrustedHosts: !!js ctx.webStartup.privilegedTrustedHosts')
    expect(PATCH).toContain('privilegedTrustedHosts: !!js ctx.webRuntime.privilegedTrustedHosts')
    expect(PATCH).toContain('trustedHosts: !!js ctx.webRuntime.trustedHosts')
  })

  it('carries --privileged-trusted-hosts through webStartup and webRuntime into the connection row', async () => {
    const observed = await bootProfileTree([
      '--no-open',
      '--trusted-host', 'sci.example', 'sci-2.example',
      '--privileged-trusted-hosts',
    ])
    expect(observed.exits).toEqual([])
    // The row activated fully, not merely resolved its config: readiness is
    // announced after the Loader tree settles.
    expect(observed.lines).toEqual(['dsh web: http://127.0.0.1:4567'])
    // Hop 2: the value the real web-app plugin published, beside the
    // authorities it applies to.
    expect(observed.runtime).toEqual({
      lanAddresses: [],
      trustedHosts: ['sci.example', 'sci-2.example'],
      privilegedTrustedHosts: true,
    })
    // Hop 3: what the connection row's own config expressions resolved to.
    expect(observed.connectionConfig).toEqual({
      trustedHosts: ['sci.example', 'sci-2.example'],
      privilegedTrustedHosts: true,
    })
  })

  it('leaves the opt-in false through the same chain when the invocation omits the flag', async () => {
    const observed = await bootProfileTree(['--no-open', '--trusted-host', 'sci.example'])
    expect(observed.runtime?.privilegedTrustedHosts).toBe(false)
    expect(observed.connectionConfig).toEqual({
      trustedHosts: ['sci.example'],
      privilegedTrustedHosts: false,
    })
  })
})
