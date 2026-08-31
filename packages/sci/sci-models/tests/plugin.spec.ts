// The plugin is mounted the way a profile mounts it — one `ctx.plugin` over a
// real LLM registry — so the load-time environment reads, the route the first
// catalog opens, and the teardown are exercised through the composition rather
// than by calling the pieces.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as SciModels from '../src/index.ts'
import { Config } from '../src/config.ts'
import { CAMEL_API_PROVIDER, CAMEL_API_PROVIDER_NAME } from '../src/adapter.ts'

/** The environment a mounted VM carries. */
const ENVIRONMENT: Record<string, string> = {
  SCI_GATE_VM_TOKEN: 'vm-token-placeholder',
  CAMEL_API_BASE_URL: 'https://hub.test/v1',
  CAMEL_API_KEY: 'hub-key-placeholder',
}

/** One catalogued CaMeL Hub model. */
const HUB_ROW = { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' }

/** One catalogued built-in DeepSeek model. */
const DEEPSEEK_ROW = {
  model: 'deepseek-v4-pro',
  displayName: 'DeepSeek-V4-Pro',
  providerLabel: 'DeepSeek',
  route: 'deepseek-official',
}

/**
 * The request URL of one transport call, whatever form the caller passed it in.
 * @param input - the transport's first argument.
 * @returns the URL as text.
 */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

const contexts: Context[] = []
const restore: (() => void)[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const undo of restore.splice(0)) undo()
  vi.unstubAllGlobals()
})

/**
 * Set this process's environment for one test and restore it afterwards.
 * @param values - the values to set; `undefined` removes the name.
 */
function withEnvironment(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    restore.push(() => {
      if (previous === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = previous
    })
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
}

/**
 * Mount the plugin over a real LLM registry, with the gate answering once.
 * @param models - the catalog rows the gate serves.
 * @param overrides - configuration fields to change from the suite defaults.
 * @returns the context and the gate calls the plugin made.
 */
async function boot(
  models: unknown[],
  overrides: Partial<Config> = {},
): Promise<{
  ctx: Context
  calls: string[]
  logs: string[]
  fiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const calls: string[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    calls.push(urlOf(input))
    return Promise.resolve(new Response(JSON.stringify({ version: 1, models }), { status: 200 }))
  })
  const ctx = new Context()
  contexts.push(ctx)
  const logs: string[] = []
  // The default exporter threshold is INFO, which drops `warn`.
  ctx.logger.exporter({
    colors: false,
    levels: { default: 3 },
    export: (message) => { logs.push(message.args.map(arg => String(arg)).join(' ')) },
  })
  await ctx.plugin(LlmRuntime)
  const fiber = await ctx.plugin(SciModels, Config(overrides as Config))
  return { ctx, calls, logs, fiber }
}

/**
 * Wait until a predicate holds, polling the event loop.
 * @param predicate - the condition to wait for.
 * @param label - what is being waited for, used in the timeout failure.
 */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`sci-models suite: timed out waiting for ${label}`)
}

describe('mounting sci-models', () => {
  it('fails the load when the environment does not carry the gate VM token', async () => {
    withEnvironment({ ...ENVIRONMENT, SCI_GATE_VM_TOKEN: undefined })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)

    await expect(ctx.plugin(SciModels, Config({} as Config))).rejects.toThrow(/SCI_GATE_VM_TOKEN must carry/)
  })

  it('still enforces without the CaMeL Hub endpoint, registering no route and saying so once', async () => {
    withEnvironment({ ...ENVIRONMENT, CAMEL_API_BASE_URL: undefined })
    const booted = await boot([HUB_ROW, DEEPSEEK_ROW])
    await until(() => booted.calls.length === 1, 'the catalog read')

    expect(booted.ctx.llm.listProviders()).toEqual([])
    expect(booted.logs.filter(line => line.includes('CAMEL_API_BASE_URL'))).toHaveLength(1)
    // The catalogued camel-api model is still the tenant's to call: the route
    // is what is missing, so the call fails at dispatch rather than at the gate.
    const chunks: StreamChunk[] = []
    for await (const chunk of booted.ctx.llm.stream({
      provider: CAMEL_API_PROVIDER, model: 'kimi-k2', messages: [],
    })) chunks.push(chunk)

    expect(chunks[0]).toMatchObject({ reason: { kind: 'error', failure: { code: 'NO_ADAPTER' } } })
  })

  it('reads the catalog with the token the environment names and opens the CaMeL Hub route', async () => {
    withEnvironment(ENVIRONMENT)
    const booted = await boot([HUB_ROW, DEEPSEEK_ROW])

    await until(() => booted.ctx.llm.listProviders().length === 1, 'the CaMeL Hub route')

    expect(booted.calls).toEqual(['http://127.0.0.1:3079/gate/api/credit/models'])
    expect(booted.ctx.llm.listProviders())
      .toEqual([{ id: CAMEL_API_PROVIDER, name: CAMEL_API_PROVIDER_NAME }])
    await expect(booted.ctx.llm.listModels(CAMEL_API_PROVIDER))
      .resolves.toMatchObject([{ id: 'kimi-k2', name: 'Kimi K2' }])
  })

  it('opens no route at all when the catalog lists nothing on it', async () => {
    withEnvironment(ENVIRONMENT)
    const booted = await boot([DEEPSEEK_ROW])

    await until(() => booted.calls.length === 1, 'the catalog read')

    expect(booted.ctx.llm.listProviders()).toEqual([])
  })

  it('reads the gate this deployment names, at the interval it configures', async () => {
    withEnvironment({ ...ENVIRONMENT, OTHER_TOKEN: 'other-vm-token' })
    const booted = await boot([HUB_ROW], {
      gateUrl: 'https://gate.test',
      vmTokenEnv: 'OTHER_TOKEN',
      refreshMs: 1000,
    })

    await until(() => booted.calls.length === 1, 'the catalog read')

    expect(booted.calls).toEqual(['https://gate.test/gate/api/credit/models'])
  })

  it('drops the route it opened when its own fiber is disposed, leaving the registry standing', async () => {
    withEnvironment(ENVIRONMENT)
    const booted = await boot([HUB_ROW])
    await until(() => booted.ctx.llm.listProviders().length === 1, 'the CaMeL Hub route')

    await booted.fiber.dispose()

    expect(booted.ctx.llm.listProviders()).toEqual([])
  })
})
