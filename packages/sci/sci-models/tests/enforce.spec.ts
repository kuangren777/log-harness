// The whitelist is exercised through the real `llm/stream` waterfall behind
// `ctx.llm.stream()` with a mock adapter, because a refusal that did not reach
// the same seam every model call passes through would prove nothing.
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ModelCatalog } from '../src/catalog.ts'
import type { FailMode } from '../src/config.ts'
import {
  allows,
  catalogUnavailableMessage,
  installEnforcement,
  MODEL_CATALOG_UNAVAILABLE_CODE,
  MODEL_NOT_ALLOWED_CODE,
  notAllowedMessage,
} from '../src/enforce.ts'
import type { ModelCatalogSnapshot } from '../src/types.ts'

/** A catalog opening one hub model and one built-in DeepSeek model. */
const OPEN: ModelCatalogSnapshot = {
  version: 3,
  models: [
    { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' },
    { model: 'deepseek-v4-pro', displayName: 'DeepSeek-V4-Pro', providerLabel: 'DeepSeek', route: 'deepseek-official' },
  ],
}

/** An adapter that records being reached and finishes immediately. */
class MockAdapter extends LlmAdapter {
  /** How many times the adapter was reached. */
  calls = 0

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** The enforced context one test drives. */
interface Booted {
  readonly adapter: MockAdapter
  /** Run one model call through the composed waterfall and collect its chunks. */
  run: (provider: string, model: string) => Promise<StreamChunk[]>
}

/**
 * Boot a context whose `llm/stream` carries the whitelist.
 * @param snapshot - the catalog in force, or `undefined` for one never read.
 * @param failMode - what happens before any catalog has been read.
 * @returns the fixture.
 */
async function boot(snapshot: ModelCatalogSnapshot | undefined, failMode: FailMode = 'open'): Promise<Booted> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const adapter = new MockAdapter()
  ctx.llm.registerAdapter(['camel-api', 'deepseek-official'], adapter)
  installEnforcement(ctx, { current: snapshot } as ModelCatalog, failMode)
  return {
    adapter,
    run: async (provider, model) => {
      const chunks: StreamChunk[] = []
      for await (const chunk of ctx.llm.stream({ provider, model, messages: [] })) chunks.push(chunk)
      return chunks
    },
  }
}

describe('allows', () => {
  it('opens the exact route and model the catalog lists', () => {
    expect(allows(OPEN, 'camel-api', 'kimi-k2')).toBe(true)
    expect(allows(OPEN, 'deepseek-official', 'deepseek-v4-pro')).toBe(true)
  })

  it('does not carry a model across routes, because those are different endpoints at different prices', () => {
    expect(allows(OPEN, 'deepseek-official', 'kimi-k2')).toBe(false)
    expect(allows(OPEN, 'camel-api', 'deepseek-v4-pro')).toBe(false)
  })

  it('closes a model the catalog does not list at all', () => {
    expect(allows(OPEN, 'camel-api', 'gpt-9')).toBe(false)
  })

  it('closes everything for a tenant whose selection is empty', () => {
    expect(allows({ version: 1, models: [] }, 'camel-api', 'kimi-k2')).toBe(false)
  })
})

describe('the refusal messages', () => {
  it('names the model the user lost and both actions that clear it', () => {
    const message = notAllowedMessage('kimi-k2')

    expect(message).toContain('kimi-k2')
    expect(message).toMatch(/未对本机构开放/)
    expect(message).toMatch(/ask your administrator/)
  })

  it('says the catalog is unavailable rather than telling a user to ask for a model they may already have', () => {
    expect(catalogUnavailableMessage()).toMatch(/目录暂时不可用/)
    expect(catalogUnavailableMessage()).not.toMatch(/administrator/)
  })
})

describe('the llm/stream whitelist', () => {
  it('passes an opened model through to the adapter', async () => {
    const booted = await boot(OPEN)

    const chunks = await booted.run('camel-api', 'kimi-k2')

    expect(booted.adapter.calls).toBe(1)
    expect(chunks).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('refuses a closed model before the adapter is reached at all', async () => {
    const booted = await boot(OPEN)

    const chunks = await booted.run('camel-api', 'gpt-9')

    expect(booted.adapter.calls).toBe(0)
    expect(chunks).toEqual([{
      type: 'finish',
      reason: { kind: 'error', failure: { code: MODEL_NOT_ALLOWED_CODE, message: notAllowedMessage('gpt-9') } },
    }])
  })

  it('refuses a built-in DeepSeek model the institution unchecked, exactly like a hub one', async () => {
    const booted = await boot(OPEN)

    const chunks = await booted.run('deepseek-official', 'deepseek-v4-flash')

    expect(booted.adapter.calls).toBe(0)
    expect(chunks[0]).toMatchObject({ reason: { failure: { code: MODEL_NOT_ALLOWED_CODE } } })
  })

  it('admits a call made before any catalog has been read when the deployment fails open', async () => {
    const booted = await boot(undefined)

    const chunks = await booted.run('camel-api', 'kimi-k2')

    expect(booted.adapter.calls).toBe(1)
    expect(chunks).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('refuses that same call with its own code when the deployment fails closed', async () => {
    const booted = await boot(undefined, 'closed')

    const chunks = await booted.run('camel-api', 'kimi-k2')

    expect(booted.adapter.calls).toBe(0)
    expect(chunks).toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: MODEL_CATALOG_UNAVAILABLE_CODE, message: catalogUnavailableMessage() },
      },
    }])
  })
})
