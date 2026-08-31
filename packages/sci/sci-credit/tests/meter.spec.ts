// The listener is exercised through the real `llm/stream` waterfall: a mock
// adapter behind `ctx.llm.stream()`, a real session store, an injected
// transport for the gate, a real spool file, and a fake scheduler so the retry
// backoff is driven rather than waited on.
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { Config } from '../src/config.ts'
import {
  CREDIT_EXHAUSTED_CODE,
  CREDIT_GATE_UNAVAILABLE_CODE,
  CreditMeter,
  exhaustedMessage,
  gateUnavailableMessage,
} from '../src/meter.ts'
import type { MeterDeps } from '../src/meter.ts'
import type { ChargePayload } from '../src/types.ts'

/** The usage a metered call reports by default. */
const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 }

/** Monday 02:00 UTC: a peak instant on the built-in schedule. */
const MONDAY_PEAK = Date.parse('2026-08-31T02:00:00Z')

/** Saturday 02:00 UTC: an off-peak instant. */
const SATURDAY = Date.parse('2026-09-05T02:00:00Z')

/** The rate card the suites price against, so no gate fetch is needed. */
const PRICING = [
  { model: 'deepseek-v4-pro', hitMicros: 44_000, missMicros: 1_320_000, outMicros: 3_960_000, peakMultiplierX1000: 1000, ratioX1000: 1000 },
  { model: 'deepseek-v4-flash', hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000, peakMultiplierX1000: 1000, ratioX1000: 1000 },
]

/** A gate balance body with both pools funded. */
const FUNDED = { planMicros: 1000, creditMicros: 0, totalMicros: 1000, exhausted: false }

/** A gate balance body with both pools spent. */
const SPENT = { planMicros: 0, creditMicros: 0, totalMicros: 0, exhausted: true }

/**
 * Request fields one test overrides. Unlike `Partial<GenerateOptions>` it
 * admits an explicit `undefined`, which is how the no-session case is stated
 * under `exactOptionalPropertyTypes`.
 */
type RequestOverrides = { [K in keyof GenerateOptions]?: GenerateOptions[K] | undefined }

/** The request URL of one transport call, whatever form the caller passed it in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** One armed fake timer. */
interface ArmedTimer {
  readonly delayMs: number
  readonly run: () => void
  cancelled: boolean
}

/** An adapter that emits one text block and, when given usage, one usage chunk. */
class MockAdapter extends LlmAdapter {
  /** How many times the adapter was reached. */
  calls = 0

  constructor(private readonly usage: TokenUsage | undefined) { super() }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hello' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } }
    if (this.usage !== undefined) yield { type: 'usage', usage: this.usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** One recorded gate call. */
interface Recorded {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

/**
 * A queued transport answer: a status/body pair, a transport failure, or a call
 * left in flight until the test releases it.
 */
type Answer = { status: number; body: unknown } | 'unreachable' | 'hang'

/** The booted fixture one test drives. */
interface Booted {
  readonly ctx: Context
  readonly meter: CreditMeter
  /** The fiber the metering plugin mounted on; disposing it removes the listener alone. */
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly session: Session
  readonly adapter: MockAdapter
  readonly calls: Recorded[]
  readonly timers: ArmedTimer[]
  readonly logs: { type: string; text: string }[]
  readonly spoolPath: string
  /** Answers the injected transport serves, keyed by API path; the last one repeats. */
  readonly answers: Map<string, Answer[]>
  clock: number
  /** Run one model call through the composed waterfall and collect its chunks. */
  run: (options?: RequestOverrides) => Promise<StreamChunk[]>
  /** Fire every armed timer once, in arming order. */
  fireTimers: () => void
  /** Let every gate call held in flight by a `hang` answer complete with a 200. */
  releaseHangs: () => void
}

const contexts: Context[] = []
let root: string | undefined

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot one metered context.
 * @param overrides - configuration fields to change from the suite defaults.
 * @param options - the adapter's reported usage and the queued gate answers.
 * @returns the fixture.
 */
async function boot(
  overrides: Partial<Config> = {},
  options: { usage?: TokenUsage | undefined; answers?: Record<string, Answer[]> } = {},
): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-credit-meter-'))
  const spoolPath = join(root, '.sci', 'credit-spool.jsonl')
  const calls: Recorded[] = []
  const timers: ArmedTimer[] = []
  const held: (() => void)[] = []
  const answers = new Map<string, Answer[]>(Object.entries(options.answers ?? {}))
  const fixture: Partial<Booted> = { clock: MONDAY_PEAK }

  const deps: MeterDeps = {
    now: () => fixture.clock as number,
    randomUUID: () => `req-${String(calls.filter(call => call.method === 'POST').length + 1)}`,
    setTimer: (run, delayMs) => {
      const timer: ArmedTimer = { delayMs, run, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    fetch: (input, init) => {
      const path = new URL(urlOf(input)).pathname
      const method = init?.method ?? 'GET'
      calls.push({
        path,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      const queue = answers.get(path) ?? []
      const answer = queue.length > 1 ? queue.shift() : queue[0]
      if (answer === undefined) return Promise.resolve(new Response('{}', { status: 404 }))
      if (answer === 'unreachable') return Promise.reject(new Error('ECONNREFUSED'))
      if (answer === 'hang') {
        return new Promise<Response>((resolve) => {
          held.push(() => { resolve(new Response('{"duplicate":false}', { status: 200 })) })
        })
      }
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }))
    },
  }

  const config = Config({
    vmToken: 'vm-token-placeholder',
    pricing: PRICING,
    spoolPath,
    ...overrides,
  } as unknown as Config)

  const ctx = new Context()
  contexts.push(ctx)
  const logs: { type: string; text: string }[] = []
  // The default exporter threshold is INFO, which drops `warn` and `debug`.
  ctx.logger.exporter({
    colors: false,
    levels: { default: 3 },
    export: (message) => { logs.push({ type: message.type, text: String(message.args[0]) }) },
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  const adapter = new MockAdapter(options.usage === undefined && !('usage' in options) ? USAGE : options.usage)
  ctx.llm.registerAdapter(['mock'], adapter)

  let meter: CreditMeter | undefined
  const fiber = await ctx.plugin({
    name: 'sci-credit-under-test',
    inject: ['llm', 'sessions'],
    apply(child: Context) {
      meter = new CreditMeter(child, config, deps)
      meter.install()
    },
  })

  const session = ctx.sessions.create(SessionId('sci-credit-meter'))
  session.append('turn/start', { turn: 1 })

  Object.assign(fixture, {
    ctx,
    meter: meter as CreditMeter,
    fiber,
    session,
    adapter,
    calls,
    timers,
    logs,
    spoolPath,
    answers,
    run: async (partial: RequestOverrides = {}): Promise<StreamChunk[]> => {
      const chunks: StreamChunk[] = []
      const options = {
        provider: 'mock',
        model: 'deepseek-v4-pro',
        messages: [],
        sessionId: session.id,
        ...partial,
      } as GenerateOptions
      for await (const chunk of ctx.llm.stream(options)) chunks.push(chunk)
      return chunks
    },
    fireTimers: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run()
    },
    releaseHangs: () => {
      for (const release of held.splice(0)) release()
    },
  })
  return fixture as Booted
}

/** The charge records one session's log holds. */
function charged(session: Session): SessionEvent<'sci/credit-charged'>[] {
  return session.events.filter((event): event is SessionEvent<'sci/credit-charged'> => event.type === 'sci/credit-charged')
}

/** The charge bodies the gate was asked to record. */
function chargeBodies(calls: readonly Recorded[]): ChargePayload[] {
  return calls.filter(call => call.method === 'POST').map(call => call.body as ChargePayload)
}

/** Answers for a funded tenant that accepts every charge. */
function acceptingGate(): Record<string, Answer[]> {
  return {
    '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
    '/gate/api/credit/charge': [{ status: 200, body: { duplicate: false } }],
  }
}

describe('the balance gate before the adapter', () => {
  it('refuses a spent tenant with one terminal error chunk and never calls next()', async () => {
    const booted = await boot({}, {
      answers: { '/gate/api/credit/balance': [{ status: 200, body: SPENT }] },
    })

    const chunks = await booted.run()

    expect(booted.adapter.calls).toBe(0)
    expect(chunks).toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: exhaustedMessage('/gate/credit'), code: CREDIT_EXHAUSTED_CODE },
      },
    }])
    expect(booted.calls.map(call => call.method)).toEqual(['GET'])
  })

  it('names the configured top-up page in the refusal', async () => {
    const booted = await boot({ creditUrl: 'https://sci.example/credit' }, {
      answers: { '/gate/api/credit/balance': [{ status: 200, body: SPENT }] },
    })

    const chunks = await booted.run()

    expect((chunks[0] as { reason: { failure: { message: string } } }).reason.failure.message)
      .toContain('https://sci.example/credit')
  })

  it('refuses under the default fail-closed mode when the gate cannot be reached', async () => {
    const booted = await boot({}, {
      answers: { '/gate/api/credit/balance': ['unreachable'] },
    })

    const chunks = await booted.run()

    expect(booted.adapter.calls).toBe(0)
    expect(chunks).toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: gateUnavailableMessage('/gate/credit'), code: CREDIT_GATE_UNAVAILABLE_CODE },
      },
    }])
  })

  it('admits the call under fail-open and reports the outage at most once per interval', async () => {
    const booted = await boot({ failMode: 'open', balanceTtlMs: 0 }, {
      answers: {
        '/gate/api/credit/balance': ['unreachable'],
        '/gate/api/credit/charge': [{ status: 200, body: { duplicate: false } }],
      },
    })

    await booted.run()
    await booted.run()
    booted.clock += 59_999
    await booted.run()
    const before = booted.logs.filter(log => log.text.includes('unmetered')).length
    booted.clock += 1
    await booted.run()
    await booted.meter.settled()

    expect(booted.adapter.calls).toBe(4)
    expect(before).toBe(1)
    expect(booted.logs.filter(log => log.text.includes('unmetered'))).toHaveLength(2)
  })

  it('reuses one balance answer across the rapid steps of a tool loop', async () => {
    const booted = await boot({ balanceTtlMs: 2000 }, { answers: acceptingGate() })

    await booted.run()
    booted.clock += 1999
    await booted.run()
    await booted.meter.settled()

    expect(booted.calls.filter(call => call.method === 'GET' && call.path.endsWith('/balance'))).toHaveLength(1)
  })

  it('re-reads the balance after a charge moved the ledger', async () => {
    const booted = await boot({ balanceTtlMs: 60_000 }, { answers: acceptingGate() })

    await booted.run()
    await booted.meter.settled()
    await booted.run()
    await booted.meter.settled()

    expect(booted.calls.filter(call => call.path.endsWith('/balance'))).toHaveLength(2)
  })
})

describe('metering an admitted call', () => {
  it('passes every chunk through unchanged and charges the reported usage', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    const chunks = await booted.run()
    await booted.meter.settled()

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: USAGE },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    // 1M uncached input at 1.32 + 1M cached input at 0.044 + 1M output at 3.96.
    expect(chargeBodies(booted.calls)).toEqual([{
      requestId: 'req-1',
      sessionId: 'sci-credit-meter',
      model: 'deepseek-v4-pro',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, reasoningTokens: 0 },
      usdMicros: 1_320_000 + 44_000 + 3_960_000,
      priceVersion: 0,
      ratioX1000: 1000,
      unknownModel: false,
    }])
  })

  it('records the charge on the session log as an ignorable event', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    await booted.run()
    await booted.meter.settled()

    const records = charged(booted.session)
    expect(records).toHaveLength(1)
    expect(records[0]?.ignorable).toBe(true)
    expect(records[0]?.data).toEqual({
      requestId: 'req-1',
      model: 'deepseek-v4-pro',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, reasoningTokens: 0 },
      usdMicros: 5_324_000,
      priceVersion: 0,
      peak: true,
      ratioX1000: 1000,
      spooled: false,
      unknownModel: false,
    })
  })

  it('halves an off-peak call and says so on the record', async () => {
    const booted = await boot({}, { answers: acceptingGate() })
    booted.clock = SATURDAY

    await booted.run()
    await booted.meter.settled()

    expect(charged(booted.session)[0]?.data).toMatchObject({ usdMicros: 2_662_000, peak: false })
  })

  it('prices a model the card does not list at its most expensive row and marks it', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    await booted.run({ model: 'deepseek-v5-unreleased' })
    await booted.meter.settled()

    expect(charged(booted.session)[0]?.data).toMatchObject({
      model: 'deepseek-v5-unreleased',
      usdMicros: 5_324_000,
      unknownModel: true,
    })
    expect(chargeBodies(booted.calls)[0]).toMatchObject({ unknownModel: true })
  })

  it('charges nothing at all when the adapter reported no usage', async () => {
    const booted = await boot({}, { usage: undefined, answers: acceptingGate() })

    await booted.run()
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)).toEqual([])
    expect(charged(booted.session)).toEqual([])
  })

  it('charges the last usage chunk when the adapter reported more than one', async () => {
    const booted = await boot({}, { answers: acceptingGate() })
    booted.ctx.on('llm/stream', () => (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } }
      yield { type: 'usage', usage: { inputTokens: 2_000_000, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())

    await booted.run()
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)[0]).toMatchObject({ usdMicros: 2_640_000 })
  })

  it('still charges when the stream throws after reporting usage', async () => {
    const booted = await boot({}, { answers: acceptingGate() })
    booted.ctx.on('llm/stream', () => (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } }
      throw new Error('connection reset mid-stream')
    })())

    await expect(booted.run()).rejects.toThrow(/connection reset mid-stream/)
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)[0]).toMatchObject({ usdMicros: 1_320_000 })
    expect(charged(booted.session)).toHaveLength(1)
  })

  it('treats a duplicate answer as a delivered charge', async () => {
    const booted = await boot({}, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': [{ status: 200, body: { duplicate: true, entries: [] } }],
      },
    })

    await booted.run()
    await booted.meter.settled()

    expect(charged(booted.session)[0]?.data.spooled).toBe(false)
    await expect(stat(booted.spoolPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('charges a call that names no session, and writes no record for it', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    await booted.run({ sessionId: undefined })
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)[0]).toMatchObject({ sessionId: null })
    expect(charged(booted.session)).toEqual([])
  })

  it('charges a call whose session is gone, and writes no record for it', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    await booted.run({ sessionId: SessionId('never-created') })
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)).toHaveLength(1)
    expect(charged(booted.session)).toEqual([])
  })
})

describe('the charge spool', () => {
  it('spools a refused charge, says so on the record, and delivers it on the next retry', async () => {
    const booted = await boot({}, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': [{ status: 503, body: { error: 'down' } }, { status: 200, body: { duplicate: false } }],
      },
    })

    await booted.run()
    await booted.meter.settled()
    expect(charged(booted.session)[0]?.data.spooled).toBe(true)
    const spooled = JSON.parse((await readFile(booted.spoolPath, 'utf8')).trim()) as ChargePayload
    expect(spooled).toMatchObject({ requestId: 'req-1', usdMicros: 5_324_000 })

    booted.fireTimers()
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)).toHaveLength(2)
    expect(chargeBodies(booted.calls)[1]).toMatchObject({ requestId: 'req-1' })
    await expect(stat(booted.spoolPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('backs off with a doubling delay while the gate keeps refusing', async () => {
    const booted = await boot({ spoolRetryBaseMs: 1000, spoolRetryMaxMs: 4000 }, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': [{ status: 503, body: { error: 'down' } }],
      },
    })
    const delays: number[] = []

    await booted.run()
    await booted.meter.settled()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      delays.push(booted.timers[booted.timers.length - 1]?.delayMs ?? -1)
      booted.fireTimers()
      await booted.meter.settled()
    }

    expect(delays).toEqual([1000, 2000, 4000, 4000, 4000])
    expect((await readFile(booted.spoolPath, 'utf8')).trim().length).toBeGreaterThan(0)
  })

  it('reports an unreadable spool and keeps retrying', async () => {
    const booted = await boot({}, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': [{ status: 503, body: { error: 'down' } }],
      },
    })
    await booted.run()
    await booted.meter.settled()
    await rm(booted.spoolPath)
    await (await import('node:fs/promises')).mkdir(booted.spoolPath)

    booted.fireTimers()
    await booted.meter.settled()

    expect(booted.logs.some(log => log.type === 'warn' && log.text.includes('reading the charge spool failed'))).toBe(true)
    expect(booted.timers.filter(timer => !timer.cancelled)).toHaveLength(1)
  })

  it('reports a charge that reached neither the gate nor the spool as lost', async () => {
    const booted = await boot({ spoolPath: join(tmpdir(), 'dsh-sci-credit-meter-nonexistent') }, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': ['unreachable'],
      },
    })
    // A spool path whose parent cannot be created: the file itself is the parent.
    const meter = booted.meter
    Reflect.set(meter, 'spool', {
      append: () => Promise.reject(new Error('ENOSPC')),
      drain: () => Promise.resolve({ delivered: 0, pending: 0, discarded: 0 }),
    })

    await booted.run()
    await meter.settled()

    expect(booted.logs.some(log => log.type === 'error' && log.text.includes('is lost'))).toBe(true)
    expect(charged(booted.session)[0]?.data.spooled).toBe(false)
  })
})

describe('the rate card', () => {
  it('prices from the gate card once the boot fetch lands', async () => {
    const booted = await boot({ pricing: 'gate' }, {
      answers: {
        '/gate/api/credit/pricing': [{
          status: 200,
          body: { version: 9, models: [{ model: 'deepseek-v4-pro', hitMicros: 0, missMicros: 1_000_000, outMicros: 0 }] },
        }],
        ...acceptingGate(),
      },
    })
    await booted.meter.settled()

    expect(booted.meter.priceTable.version).toBe(9)

    await booted.run()
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)[0]).toMatchObject({ usdMicros: 1_000_000, priceVersion: 9 })
  })

  it('keeps the built-in official card when the gate serves none, and says so', async () => {
    const booted = await boot({ pricing: 'gate' }, {
      answers: { '/gate/api/credit/pricing': ['unreachable'], ...acceptingGate() },
    })
    await booted.meter.settled()

    expect(booted.meter.priceTable.version).toBe(1)
    expect(booted.meter.priceTable.models.map(row => row.model))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'])
    expect(booted.logs.some(log => log.type === 'warn' && log.text.includes('keeping the previous rate card'))).toBe(true)
  })

  it('re-fetches the card on the refresh interval', async () => {
    const booted = await boot({ pricing: 'gate', pricingRefreshMs: 600_000 }, {
      answers: {
        '/gate/api/credit/pricing': [
          { status: 200, body: { version: 1, models: [{ model: 'a', hitMicros: 1, missMicros: 1, outMicros: 1 }] } },
          { status: 200, body: { version: 2, models: [{ model: 'a', hitMicros: 1, missMicros: 1, outMicros: 1 }] } },
        ],
        ...acceptingGate(),
      },
    })
    await booted.meter.settled()
    const armed = booted.timers.find(timer => timer.delayMs === 600_000)

    expect(armed).toBeDefined()
    booted.fireTimers()
    await booted.meter.settled()

    expect(booted.meter.priceTable.version).toBe(2)
  })

  it('never asks the gate for a card when configuration declared one', async () => {
    const booted = await boot({}, { answers: acceptingGate() })
    await booted.meter.settled()

    expect(booted.calls.filter(call => call.path.endsWith('/pricing'))).toEqual([])
    expect(booted.meter.priceTable.version).toBe(0)
  })
})

describe('teardown', () => {
  it('cancels the armed timers and stops arming new ones when the fiber goes away', async () => {
    const booted = await boot({ pricing: 'gate' }, {
      answers: {
        '/gate/api/credit/pricing': ['unreachable'],
        ...acceptingGate(),
      },
    })

    await booted.ctx.fiber.dispose()
    await booted.meter.settled()

    expect(booted.timers.every(timer => timer.cancelled)).toBe(true)
  })

  it('arms no further refresh when the fiber goes away while the card fetch is still in flight', async () => {
    const booted = await boot({ pricing: 'gate' }, {
      answers: { '/gate/api/credit/pricing': ['hang'], ...acceptingGate() },
    })

    await booted.ctx.fiber.dispose()
    booted.releaseHangs()
    await booted.meter.settled()

    expect(booted.timers.filter(timer => !timer.cancelled && timer.delayMs === 600_000)).toEqual([])
  })

  it('stops metering when only its own fiber is disposed', async () => {
    const booted = await boot({}, { answers: acceptingGate() })

    await booted.run()
    await booted.meter.settled()
    await booted.fiber.dispose()
    const before = booted.calls.length
    const chunks = await booted.run()
    await booted.meter.settled()

    expect(booted.adapter.calls).toBe(2)
    expect(chunks.map(chunk => chunk.type)).toContain('finish')
    expect(booted.calls).toHaveLength(before)
    expect(charged(booted.session)).toHaveLength(1)
  })

  it('finishes a charge that was still in flight when the fiber went away', async () => {
    const booted = await boot({}, {
      answers: {
        '/gate/api/credit/balance': [{ status: 200, body: FUNDED }],
        '/gate/api/credit/charge': ['hang'],
      },
    })

    await booted.run()
    await booted.ctx.fiber.dispose()
    booted.releaseHangs()
    await booted.meter.settled()

    expect(chargeBodies(booted.calls)).toHaveLength(1)
    expect(booted.logs.filter(log => log.type === 'error')).toEqual([])
  })
})
