// The route is the one thing a user sees before any model call happens, so the
// selector name, the connection facts handed to the reused adapter, the
// credential precedence, and the register/drop lifecycle are pinned directly.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  CAMEL_API_PROVIDER,
  CAMEL_API_PROVIDER_NAME,
  CamelApiAdapter,
  camelApiAdapterOptions,
  camelApiConnection,
  CamelApiRoute,
  resolveCamelApiKey,
} from '../src/adapter.ts'
import type { CatalogModel } from '../src/types.ts'

/** The credential reference the suite resolves. */
const KEY_ENV = credentialRef('CAMEL_API_KEY')

/** Two catalogued models on the CaMeL Hub route. */
const MODELS: readonly CatalogModel[] = [
  { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' },
  { model: 'qwen3-max', displayName: 'Qwen3 Max', providerLabel: 'Alibaba', route: 'camel-api' },
]

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * A context with the LLM registry mounted.
 * @returns the context.
 */
async function llmContext(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  return ctx
}

/**
 * An adapter over the given catalog.
 * @param models - the catalogued models to advertise.
 * @returns the adapter.
 */
function adapterFor(models: readonly CatalogModel[]): CamelApiAdapter {
  return new CamelApiAdapter({
    options: () => camelApiConnection('https://hub.test/v1', KEY_ENV, models),
    resolveApiKey: () => Promise.resolve('key-placeholder'),
    resolveUserId: () => 'anon' as never,
  })
}

describe('camelApiConnection', () => {
  it('carries the endpoint, the credential reference, and the catalogued models', () => {
    const connection = camelApiConnection('https://hub.test/v1', KEY_ENV, MODELS)

    expect(connection).toMatchObject({
      baseURL: 'https://hub.test/v1',
      apiKeyEnv: KEY_ENV,
      models: [{ id: 'kimi-k2', name: 'Kimi K2' }, { id: 'qwen3-max', name: 'Qwen3 Max' }],
    })
  })

  it('takes its request bounds from the adapter that enforces them', () => {
    const connection = camelApiConnection('https://hub.test/v1', KEY_ENV, [])

    expect(connection.retryPolicy.mode).toBe('normal')
    expect(connection.maxTokens).toBeGreaterThan(0)
    expect(connection.defaultContextWindow).toBeGreaterThan(0)
    expect(connection.filePolicy.expiresAfterSeconds).toBeGreaterThan(0)
  })
})

describe('CamelApiAdapter', () => {
  it('names the route CaMeL Hub rather than the vendor the base class was written for', () => {
    expect(adapterFor(MODELS).providerInfo(CAMEL_API_PROVIDER))
      .toEqual({ id: CAMEL_API_PROVIDER, name: CAMEL_API_PROVIDER_NAME })
  })

  it('advertises the catalogued models under that route', async () => {
    await expect(adapterFor(MODELS).listModels(CAMEL_API_PROVIDER)).resolves.toMatchObject([
      { id: 'kimi-k2', name: 'Kimi K2' },
      { id: 'qwen3-max', name: 'Qwen3 Max' },
    ])
  })
})

describe('camelApiAdapterOptions', () => {
  it('reads the optional image and named-text services at each request, not at construction', async () => {
    const ctx = await llmContext()
    const options = camelApiAdapterOptions(ctx, () => camelApiConnection('https://hub.test', KEY_ENV, []))

    expect(options.resolveAttachments?.()).toBeUndefined()
    expect(options.resolveReferencedText?.()).toBeUndefined()

    ctx.provide('attachments')
    ctx.attachments = { marker: 'mounted late' } as never

    expect(options.resolveAttachments?.()).toMatchObject({ marker: 'mounted late' })
  })

  it('mints the anonymous id once and reuses it', async () => {
    const ctx = await llmContext()
    const options = camelApiAdapterOptions(ctx, () => camelApiConnection('https://hub.test', KEY_ENV, []))
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = await mkdtemp(join(tmpdir(), 'dsh-sci-models-home-'))
    try {
      expect(options.resolveUserId()).toBe(options.resolveUserId())
    } finally {
      await rm(process.env['DSH_HOME'], { recursive: true, force: true })
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })
})

describe('resolveCamelApiKey', () => {
  it('prefers the managed credential store over whatever the container inherited', async () => {
    const ctx = await llmContext()
    process.env['CAMEL_API_KEY'] = 'from-environment'
    try {
      ctx.provide('credentials')
      ctx.credentials = { resolve: () => Promise.resolve({ value: 'from-store' }) } as never

      await expect(resolveCamelApiKey(ctx, camelApiConnection('https://hub.test', KEY_ENV, [])))
        .resolves.toBe('from-store')
    } finally {
      delete process.env['CAMEL_API_KEY']
    }
  })

  it('falls back to the launching environment when the mounted store holds nothing', async () => {
    const ctx = await llmContext()
    ctx.provide('credentials')
    ctx.credentials = { resolve: () => Promise.resolve(undefined) } as never
    process.env['CAMEL_API_KEY'] = 'from-environment'
    try {
      await expect(resolveCamelApiKey(ctx, camelApiConnection('https://hub.test', KEY_ENV, [])))
        .resolves.toBe('from-environment')
    } finally {
      delete process.env['CAMEL_API_KEY']
    }
  })

  it('fails the call with MISSING_CREDENTIAL when neither plane carries the key', async () => {
    const ctx = await llmContext()
    const previous = process.env['CAMEL_API_KEY']
    delete process.env['CAMEL_API_KEY']
    try {
      await expect(resolveCamelApiKey(ctx, camelApiConnection('https://hub.test', KEY_ENV, [])))
        .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    } finally {
      if (previous !== undefined) process.env['CAMEL_API_KEY'] = previous
    }
  })
})

describe('CamelApiRoute', () => {
  it('registers the route only once the catalog lists a model on it', async () => {
    const ctx = await llmContext()
    const route = new CamelApiRoute(ctx, adapterFor(MODELS))

    route.sync(false)
    expect(ctx.llm.listProviders()).toEqual([])

    route.sync(true)
    expect(ctx.llm.listProviders()).toEqual([{ id: CAMEL_API_PROVIDER, name: CAMEL_API_PROVIDER_NAME }])

    route.sync(true)
    expect(ctx.llm.listProviders()).toHaveLength(1)
  })

  it('drops the route when the catalog stops listing one, so no empty selector entry remains', async () => {
    const ctx = await llmContext()
    const route = new CamelApiRoute(ctx, adapterFor(MODELS))

    route.sync(true)
    route.sync(false)

    expect(ctx.llm.listProviders()).toEqual([])
    route.sync(false)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('drops the route on disposal and ignores every later catalog change', async () => {
    const ctx = await llmContext()
    const route = new CamelApiRoute(ctx, adapterFor(MODELS))

    route.sync(true)
    route.dispose()
    expect(ctx.llm.listProviders()).toEqual([])

    route.sync(true)
    expect(ctx.llm.listProviders()).toEqual([])
  })
})
