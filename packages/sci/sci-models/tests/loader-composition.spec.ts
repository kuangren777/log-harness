// Proves the catalog is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the LLM registry and dsh-sci-models, and everything this package owns
// — the authenticated catalog read against a real HTTP gate, the CaMeL Hub
// route it opens, a served model call reaching a real OpenAI-compatible
// endpoint, and the refusal of a model the catalog does not open — appears from
// that composition alone, with no injected transport or scheduler.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import * as SciModels from '@deepseek-ai/dsh-sci-models'
import { MODEL_NOT_ALLOWED_CODE } from '@deepseek-ai/dsh-sci-models'

/** The VM bearer token the composed gate accepts. */
const VM_TOKEN = 'vm-token-for-loader-suite'

/** The CaMeL Hub key the composed endpoint accepts. */
const HUB_KEY = 'hub-key-for-loader-suite'

/** The text the composed endpoint answers with. */
const ANSWER = 'composed hub answer'

/** A real loopback gate serving the catalog endpoint. */
interface FakeGate {
  readonly url: string
  /** The authorization headers the plugin sent, in order. */
  readonly authorizations: (string | undefined)[]
  close: () => Promise<void>
}

/**
 * Start a loopback HTTP gate over the real catalog API.
 * @param models - the rows to serve.
 * @returns the gate's base URL, the credentials it saw, and its closer.
 */
async function startGate(models: unknown[]): Promise<FakeGate> {
  const authorizations: (string | undefined)[] = []
  const server: Server = createServer((request, response) => {
    authorizations.push(request.headers.authorization)
    if (request.headers.authorization !== `Bearer ${VM_TOKEN}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{"error":"models: 需要 VM token"}')
      return
    }
    if (new URL(request.url ?? '/', 'http://gate').pathname === '/gate/api/credit/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ version: 7, models }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{"error":"unknown catalog endpoint"}')
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}`,
    authorizations,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

let root: string | undefined
let context: Context | undefined
let gate: FakeGate | undefined
let hub: MockLlmServer | undefined
const restore: (() => void)[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await gate?.close()
  gate = undefined
  await hub?.close()
  hub = undefined
  for (const undo of restore.splice(0)) undo()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Set this process's environment for one test and restore it afterwards.
 * @param values - the values to set.
 */
function withEnvironment(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    restore.push(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = previous
    })
    process.env[key] = value
  }
}

/** The booted composition one test drives. */
interface Booted {
  readonly ctx: Context
  readonly gate: FakeGate
  readonly hub: MockLlmServer
}

/**
 * Boot a cordis.yml mounting the LLM registry and this package.
 * @param models - the catalog rows the composed gate serves.
 * @returns the booted context, the composed gate, and the composed endpoint.
 */
async function boot(models: unknown[]): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-models-loader-'))
  gate = await startGate(models)
  hub = await startMockLlmServer({ sequence: ['success'], repeatLast: true, apiKey: HUB_KEY, successText: ANSWER })
  withEnvironment({
    SCI_GATE_VM_TOKEN: VM_TOKEN,
    CAMEL_API_BASE_URL: `${hub.baseURL}/v1`,
    CAMEL_API_KEY: HUB_KEY,
    // The reused adapter mints an anonymous id under the harness home; keep it
    // inside this suite's temporary root rather than the developer's.
    DSH_HOME: root,
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-sci-models'",
    '  config:',
    `    gateUrl: ${JSON.stringify(gate.url)}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-sci-models', SciModels],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, gate, hub }
}

/**
 * Wait until a predicate holds, polling the event loop.
 * @param predicate - the condition to wait for.
 * @param label - what is being waited for, used in the timeout failure.
 */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`sci-models loader suite: timed out waiting for ${label}`)
}

/**
 * Run one model call through the composed waterfall.
 * @param booted - the composition to call.
 * @param provider - the provider route to select.
 * @param model - the model id to name.
 * @returns every chunk the call produced.
 */
async function run(booted: Booted, provider: string, model: string): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of booted.ctx.llm.stream({ provider, model, messages: [] })) chunks.push(chunk)
  return chunks
}

describe('sci-models real Loader composition through cordis.yml', () => {
  it('opens the CaMeL Hub route from the composed gate and serves a real call over it', async () => {
    const booted = await boot([
      { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' },
    ])
    await until(() => booted.ctx.llm.listProviders().length === 1, 'the CaMeL Hub route')

    expect(booted.gate.authorizations).toEqual([`Bearer ${VM_TOKEN}`])
    expect(booted.ctx.llm.listProviders()).toEqual([{ id: 'camel-api', name: 'CaMeL Hub' }])

    const chunks = await run(booted, 'camel-api', 'kimi-k2')

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toMatchObject([
      { block: { type: 'text', text: ANSWER } },
    ])
    // The composed endpoint received the request with the key the environment
    // named and the model the catalog opened.
    expect(booted.hub.requests[0]).toMatchObject({
      headers: { authorization: `Bearer ${HUB_KEY}` },
      body: { model: 'kimi-k2' },
    })
  }, 30_000)

  it('refuses a model the composed catalog does not open, without reaching the endpoint', async () => {
    const booted = await boot([
      { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' },
    ])
    await until(() => booted.ctx.llm.listProviders().length === 1, 'the CaMeL Hub route')

    const chunks = await run(booted, 'camel-api', 'gpt-9')

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ reason: { kind: 'error', failure: { code: MODEL_NOT_ALLOWED_CODE } } })
    expect(booted.hub.requests).toHaveLength(0)
  }, 30_000)
})
