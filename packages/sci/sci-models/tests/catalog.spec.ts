// The catalog crosses a process boundary, so the client is pinned over an
// injected transport for the request it makes and every malformed answer it can
// receive, and the refreshing copy is driven through a fake scheduler rather
// than waited on.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CatalogUnavailableError, GateCatalogClient, ModelCatalog } from '../src/catalog.ts'
import type { ModelCatalogSnapshot } from '../src/types.ts'

/** The token the suite's client sends. */
const VM_TOKEN = 'vm-token-placeholder'

/** One row the gate serves, complete. */
const HUB_ROW = {
  model: 'kimi-k2',
  displayName: 'Kimi K2',
  providerLabel: 'Moonshot',
  route: 'camel-api',
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

/** One recorded transport call. */
interface Recorded {
  readonly url: string
  readonly authorization: string | undefined
}

/** A queued transport answer: a status/body pair, or a transport failure. */
type Answer = { status: number; body: string } | 'unreachable'

/**
 * A client over an injected transport.
 * @param answers - the answers to serve in order; the last one repeats.
 * @param gateUrl - the base URL to configure, so the trailing-slash rule is testable.
 * @returns the client and the calls it made.
 */
function client(answers: Answer[], gateUrl = 'http://gate.test'): { gate: GateCatalogClient; calls: Recorded[] } {
  const calls: Recorded[] = []
  const gate = new GateCatalogClient({
    gateUrl,
    vmToken: VM_TOKEN,
    requestTimeoutMs: 1000,
    fetch: (input, init) => {
      calls.push({
        url: urlOf(input),
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      })
      const answer = answers.length > 1 ? answers.shift() : answers[0]
      if (answer === undefined || answer === 'unreachable') return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve(new Response(answer.body, { status: answer.status }))
    },
  })
  return { gate, calls }
}

/**
 * One JSON answer at HTTP 200.
 * @param body - the value to serialize.
 * @returns the queued answer.
 */
function json(body: unknown): Answer {
  return { status: 200, body: JSON.stringify(body) }
}

describe('GateCatalogClient', () => {
  it('reads the catalog with the VM bearer token, tolerating a trailing slash', async () => {
    const { gate, calls } = client([json({ version: 4, models: [HUB_ROW] })], 'http://gate.test//')

    await expect(gate.catalog()).resolves.toEqual({
      version: 4,
      models: [{ model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' }],
    })
    expect(calls[0]).toEqual({
      url: 'http://gate.test/gate/api/credit/models',
      authorization: `Bearer ${VM_TOKEN}`,
    })
  })

  it('falls back to the model id and the route for the two labels a row may omit', async () => {
    const { gate } = client([json({ version: 1, models: [{ model: 'deepseek-v4-pro', route: 'deepseek-official' }] })])

    await expect(gate.catalog()).resolves.toEqual({
      version: 1,
      models: [{
        model: 'deepseek-v4-pro',
        displayName: 'deepseek-v4-pro',
        providerLabel: 'deepseek-official',
        route: 'deepseek-official',
      }],
    })
  })

  it.each([
    { label: 'is not an object at all', row: 'deepseek-v4-pro' },
    { label: 'names no model', row: { route: 'camel-api' } },
    { label: 'names a blank model', row: { model: '', route: 'camel-api' } },
    { label: 'names no route', row: { model: 'kimi-k2' } },
    { label: 'names a route this harness cannot serve', row: { model: 'kimi-k2', route: 'anthropic-official' } },
  ])('skips a row that $label and keeps the rest of the catalog', async ({ row }) => {
    const { gate } = client([json({ version: 1, models: [row, HUB_ROW] })])

    const catalog = await gate.catalog()

    expect(catalog.models.map(entry => entry.model)).toEqual(['kimi-k2'])
  })

  it('accepts a tenant whose selection is empty, which is not the same as unknown', async () => {
    const { gate } = client([json({ version: 9, models: [] })])

    await expect(gate.catalog()).resolves.toEqual({ version: 9, models: [] })
  })

  it.each([
    { label: 'a body that is not an object', body: json([HUB_ROW]) },
    { label: 'a body with no version', body: json({ models: [] }) },
    { label: 'a fractional version', body: json({ version: 1.5, models: [] }) },
    { label: 'models that are not a list', body: json({ version: 1, models: 'all' }) },
  ])('refuses $label', async ({ body }) => {
    const { gate } = client([body])

    await expect(gate.catalog()).rejects.toThrow(/missing version or models/)
  })

  it('refuses an answer that is not JSON at all', async () => {
    const { gate } = client([{ status: 200, body: 'not json' }])

    await expect(gate.catalog()).rejects.toThrow(/answered unparseable JSON/)
  })

  it('refuses a non-2xx answer, naming the status', async () => {
    const { gate } = client([{ status: 401, body: '{}' }])

    await expect(gate.catalog()).rejects.toThrow(/answered HTTP 401/)
  })

  it('reports an unreachable gate as the same condition, carrying the transport failure', async () => {
    const { gate } = client(['unreachable'])

    const failure: unknown = await gate.catalog().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CatalogUnavailableError)
    expect(failure).toMatchObject({ code: 'SCI_MODELS_GATE_UNAVAILABLE', name: 'CatalogUnavailableError' })
    expect((failure as CatalogUnavailableError).cause).toBeInstanceOf(Error)
  })

  it('reads through the platform transport when no test one is injected', async () => {
    const platform = vi.fn(() => Promise.resolve(new Response('{"version":1,"models":[]}', { status: 200 })))
    vi.stubGlobal('fetch', platform)
    try {
      const gate = new GateCatalogClient({ gateUrl: 'http://gate.test', vmToken: VM_TOKEN, requestTimeoutMs: 1000 })

      await expect(gate.catalog()).resolves.toEqual({ version: 1, models: [] })
      expect(platform).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/** One armed fake timer. */
interface ArmedTimer {
  readonly delayMs: number
  readonly run: () => void
  cancelled: boolean
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** The catalog fixture one test drives. */
interface Fixture {
  readonly catalog: ModelCatalog
  readonly timers: ArmedTimer[]
  readonly changes: number[]
  readonly logs: string[]
  /** Fire every armed timer once, in arming order. */
  fire: () => void
}

/**
 * Build a refreshing catalog over a stub client.
 * @param reads - what each successive read resolves or rejects with; the last one repeats.
 * @returns the catalog, its armed timers, its change notifications, and its warnings.
 */
function fixture(reads: (ModelCatalogSnapshot | Error)[]): Fixture {
  const ctx = new Context()
  contexts.push(ctx)
  const logs: string[] = []
  // The default exporter threshold is INFO, which drops `warn`.
  ctx.logger.exporter({
    colors: false,
    levels: { default: 3 },
    export: (message) => { logs.push(String(message.args[0])) },
  })
  const timers: ArmedTimer[] = []
  const changes: number[] = []
  const stub = {
    catalog: (): Promise<ModelCatalogSnapshot> => {
      const next = reads.length > 1 ? reads.shift() : reads[0]
      if (next === undefined) return Promise.reject(new CatalogUnavailableError('sci-models: nothing queued'))
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
  } as GateCatalogClient
  const catalog = new ModelCatalog(ctx, stub, 60_000, {
    setTimer: (run, delayMs) => {
      const timer: ArmedTimer = { delayMs, run, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    onChange: () => { changes.push(catalog.current?.version ?? -1) },
  })
  return {
    catalog,
    timers,
    changes,
    logs,
    fire: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run()
    },
  }
}

describe('ModelCatalog', () => {
  it('has no catalog at all until the first read succeeds', async () => {
    const booted = fixture([new CatalogUnavailableError('sci-models: gate down')])

    expect(booted.catalog.current).toBeUndefined()
    booted.catalog.start()
    await booted.catalog.settled()

    expect(booted.catalog.current).toBeUndefined()
    expect(booted.changes).toEqual([])
    expect(booted.logs[0]).toMatch(/keeping the previous model catalog/)
  })

  it('lists no model on any route until the first read succeeds', () => {
    const booted = fixture([{ version: 1, models: [] }])

    expect(booted.catalog.modelsOn('camel-api')).toEqual([])
  })

  it('lists the catalogued models of one route and none of the other', async () => {
    const booted = fixture([{
      version: 5,
      models: [
        { model: 'kimi-k2', displayName: 'Kimi K2', providerLabel: 'Moonshot', route: 'camel-api' as const },
        { model: 'deepseek-v4-pro', displayName: 'V4 Pro', providerLabel: 'DeepSeek', route: 'deepseek-official' as const },
      ],
    }])

    booted.catalog.start()
    await booted.catalog.settled()

    expect(booted.catalog.modelsOn('camel-api').map(entry => entry.model)).toEqual(['kimi-k2'])
    expect(booted.catalog.modelsOn('deepseek-official').map(entry => entry.model)).toEqual(['deepseek-v4-pro'])
  })

  it('publishes the read catalog and announces the change', async () => {
    const booted = fixture([{ version: 2, models: [] }])

    booted.catalog.start()
    await booted.catalog.settled()

    expect(booted.catalog.current).toEqual({ version: 2, models: [] })
    expect(booted.changes).toEqual([2])
  })

  it('keeps the previous catalog when a later read fails, rather than revoking every model', async () => {
    const booted = fixture([
      { version: 2, models: [{ ...HUB_ROW, route: 'camel-api' as const }] },
      new CatalogUnavailableError('sci-models: gate down'),
    ])

    booted.catalog.start()
    await booted.catalog.settled()
    expect(booted.timers[0]?.delayMs).toBe(60_000)
    booted.fire()
    await booted.catalog.settled()

    expect(booted.catalog.current?.version).toBe(2)
    expect(booted.changes).toEqual([2])
  })

  it('arms the next read after every attempt, so one outage does not stop the refresh', async () => {
    const booted = fixture([new CatalogUnavailableError('sci-models: gate down')])

    booted.catalog.start()
    await booted.catalog.settled()
    const armed = booted.timers.length
    booted.fire()
    await booted.catalog.settled()

    expect(armed).toBe(1)
    expect(booted.timers).toHaveLength(1)
  })

  it('arms nothing more once disposed mid-read, and cancels the timer it holds', async () => {
    const booted = fixture([{ version: 1, models: [] }])

    booted.catalog.start()
    await booted.catalog.settled()
    const held = booted.timers[0]
    booted.catalog.dispose()

    expect(held?.cancelled).toBe(true)
    booted.catalog.start()
    await booted.catalog.settled()
    expect(booted.timers.filter(timer => !timer.cancelled)).toHaveLength(0)
  })

  it('uses a real unref’d timer when no scheduler is injected', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const stub = { catalog: (): Promise<ModelCatalogSnapshot> => Promise.resolve({ version: 1, models: [] }) }
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const catalog = new ModelCatalog(ctx, stub as GateCatalogClient, 60_000)

    catalog.start()
    await catalog.settled()
    catalog.dispose()

    expect(timeout).toHaveBeenCalled()
    timeout.mockRestore()
  })
})
