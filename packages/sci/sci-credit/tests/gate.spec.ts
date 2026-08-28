// Everything the gate answers crosses a process boundary, so every field is
// validated rather than trusted; these cases pin the validation, the balance
// cache and its coalescing, and the one failure class the caller's fail-closed
// and spool decisions are made on.
import { describe, expect, it } from 'vitest'
import { GateClient, GateUnavailableError } from '../src/gate.ts'
import { DEFAULT_PEAK_SCHEDULE } from '../src/pricing.ts'
import type { ChargePayload } from '../src/types.ts'

/** One recorded call the injected transport saw. */
interface Recorded {
  readonly url: string
  readonly method: string
  readonly authorization: string
  readonly body: string | undefined
}

/** The request URL of one transport call, whatever form the caller passed it in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/** A JSON body answer, with a status. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A transport that answers each call from a queue and records what it was asked. */
function transport(answers: readonly (Response | Error)[]): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  return {
    calls,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: urlOf(input),
        method: init?.method ?? 'GET',
        authorization: headers.get('authorization') ?? '',
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      if (answer instanceof Error) return Promise.reject(answer)
      // A Response body may be read once, so each call gets its own clone.
      return Promise.resolve((answer as Response).clone())
    },
  }
}

/** A full balance answer as the gate serves it. */
const BALANCE = { tenantId: 4, planMicros: 1000, creditMicros: 2000, totalMicros: 3000, exhausted: false }

/** A client over one injected transport and a movable clock. */
function client(answers: readonly (Response | Error)[], options: { balanceTtlMs?: number; gateUrl?: string } = {}): {
  gate: GateClient
  calls: Recorded[]
  advance: (ms: number) => void
} {
  const { fetch: injected, calls } = transport(answers)
  let clock = 1_000_000
  const gate = new GateClient({
    gateUrl: options.gateUrl ?? 'http://127.0.0.1:3079',
    vmToken: 'vm-token-placeholder',
    balanceTtlMs: options.balanceTtlMs ?? 2000,
    requestTimeoutMs: 5000,
    fetch: injected,
    now: () => clock,
  })
  return { gate, calls, advance: (ms) => { clock += ms } }
}

/** A charge body with the fields the gate requires. */
const PAYLOAD: ChargePayload = {
  requestId: 'req-1',
  sessionId: 'session-1',
  model: 'deepseek-v4-pro',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 },
  usdMicros: 42,
  priceVersion: 1,
  unknownModel: false,
}

describe('GateClient.balance', () => {
  it('reads the two pools and the exhausted flag over a bearer-authenticated GET', async () => {
    const { gate, calls } = client([jsonResponse(BALANCE)])

    await expect(gate.balance()).resolves.toEqual({
      planMicros: 1000, creditMicros: 2000, totalMicros: 3000, exhausted: false,
    })
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:3079/gate/api/credit/balance',
      method: 'GET',
      authorization: 'Bearer vm-token-placeholder',
    })
  })

  it('trims a trailing slash off the configured base URL rather than doubling it', async () => {
    const { gate, calls } = client([jsonResponse(BALANCE)], { gateUrl: 'http://gate.internal:3079//' })

    await gate.balance()

    expect(calls[0]?.url).toBe('http://gate.internal:3079/gate/api/credit/balance')
  })

  it('reuses an answer younger than the cache lifetime and reaches the gate once it ages out', async () => {
    const { gate, calls, advance } = client([jsonResponse(BALANCE)], { balanceTtlMs: 2000 })

    await gate.balance()
    advance(1999)
    await gate.balance()
    expect(calls).toHaveLength(1)

    advance(1)
    await gate.balance()
    expect(calls).toHaveLength(2)
  })

  it('coalesces concurrent reads onto one request', async () => {
    const { gate, calls } = client([jsonResponse(BALANCE)])

    const [first, second] = await Promise.all([gate.balance(), gate.balance()])

    expect(calls).toHaveLength(1)
    expect(first).toEqual(second)
  })

  it('reaches the gate again after the cache is invalidated', async () => {
    const { gate, calls } = client([jsonResponse(BALANCE)])

    await gate.balance()
    gate.invalidateBalance()
    await gate.balance()

    expect(calls).toHaveLength(2)
  })

  it('does not cache a failure, so the next read tries again immediately', async () => {
    const { gate, calls } = client([new Error('ECONNREFUSED'), jsonResponse(BALANCE)])

    await expect(gate.balance()).rejects.toBeInstanceOf(GateUnavailableError)
    await expect(gate.balance()).resolves.toMatchObject({ exhausted: false })
    expect(calls).toHaveLength(2)
  })

  it.each([
    { label: 'a transport failure', answer: new Error('ECONNREFUSED'), message: /did not reach the gate/ },
    { label: 'an HTTP error status', answer: jsonResponse({ error: 'nope' }, 503), message: /answered HTTP 503/ },
    { label: 'a body that is not JSON', answer: new Response('<html>', { status: 200 }), message: /unparseable JSON/ },
    { label: 'a body that is not an object', answer: jsonResponse([BALANCE]), message: /missing planMicros/ },
    { label: 'a missing pool', answer: jsonResponse({ ...BALANCE, creditMicros: undefined }), message: /missing planMicros/ },
    { label: 'a fractional pool', answer: jsonResponse({ ...BALANCE, totalMicros: 1.5 }), message: /missing planMicros/ },
    { label: 'a missing exhausted flag', answer: jsonResponse({ ...BALANCE, exhausted: 'no' }), message: /missing the exhausted flag/ },
  ])('reports $label as the gate being unavailable', async ({ answer, message }) => {
    const { gate } = client([answer])

    await expect(gate.balance()).rejects.toThrow(message)
  })
})

describe('GateClient.charge', () => {
  it('posts the payload as JSON and reports a fresh charge', async () => {
    const { gate, calls } = client([jsonResponse({ duplicate: false, charged: { usdMicros: 42 } })])

    await expect(gate.charge(PAYLOAD)).resolves.toEqual({ duplicate: false })
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:3079/gate/api/credit/charge',
      method: 'POST',
      body: JSON.stringify(PAYLOAD),
    })
  })

  it('reports a replay the gate answered from its ledger', async () => {
    const { gate } = client([jsonResponse({ duplicate: true, entries: [] })])

    await expect(gate.charge(PAYLOAD)).resolves.toEqual({ duplicate: true })
  })

  it('reads a non-object answer as not-a-duplicate rather than failing the charge', async () => {
    const { gate } = client([jsonResponse('ok')])

    await expect(gate.charge(PAYLOAD)).resolves.toEqual({ duplicate: false })
  })

  it('rejects a refused charge so the caller can spool it', async () => {
    const { gate } = client([jsonResponse({ error: 'requestId 必填' }, 400)])

    await expect(gate.charge(PAYLOAD)).rejects.toThrow(/POST \/gate\/api\/credit\/charge answered HTTP 400/)
  })
})

describe('GateClient.pricing', () => {
  it('reads the published rows and peak schedule', async () => {
    const { gate } = client([jsonResponse({
      unit: 'micro-USD per 1M tokens (peak price)',
      version: 3,
      models: [
        { model: 'deepseek-v4-flash', version: 1, hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000, peakMultiplierX1000: 1000 },
        { model: 'deepseek-v4-pro', version: 2, hitMicros: 44_000, missMicros: 1_320_000, outMicros: 3_960_000 },
      ],
      peak: { timezone: 'UTC', weekdays: [1], windows: [['02:00', '03:00']], offPeakMultiplierX1000: 400 },
    })])

    await expect(gate.pricing()).resolves.toEqual({
      version: 3,
      models: [
        { model: 'deepseek-v4-flash', hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000, peakMultiplierX1000: 1000 },
        { model: 'deepseek-v4-pro', hitMicros: 44_000, missMicros: 1_320_000, outMicros: 3_960_000, peakMultiplierX1000: 1000 },
      ],
      peak: { timezone: 'UTC', weekdays: [1], windows: [['02:00', '03:00']], offPeakMultiplierX1000: 400 },
    })
  })

  it('skips a row it cannot read and keeps the rest of the card', async () => {
    const { gate } = client([jsonResponse({
      version: 1,
      models: [
        'not a row',
        { hitMicros: 1, missMicros: 1, outMicros: 1 },
        { model: 'partial', missMicros: 1, outMicros: 1 },
        { model: 'good', hitMicros: 1, missMicros: 2, outMicros: 3 },
      ],
    })])

    const table = await gate.pricing()

    expect(table.models.map(row => row.model)).toEqual(['good'])
  })

  it.each([
    { label: 'omits it', peak: undefined },
    { label: 'sends a non-object', peak: 'weekdays' },
    { label: 'sends a non-string timezone', peak: { timezone: 1, weekdays: [1], windows: [], offPeakMultiplierX1000: 500 } },
    { label: 'sends non-numeric weekdays', peak: { timezone: 'UTC', weekdays: ['mon'], windows: [], offPeakMultiplierX1000: 500 } },
    { label: 'sends weekdays that are not a list', peak: { timezone: 'UTC', weekdays: 1, windows: [], offPeakMultiplierX1000: 500 } },
    { label: 'sends windows that are not a list', peak: { timezone: 'UTC', weekdays: [1], windows: '01:00', offPeakMultiplierX1000: 500 } },
    { label: 'omits the off-peak multiplier', peak: { timezone: 'UTC', weekdays: [1], windows: [] } },
    { label: 'sends a window that is not a pair', peak: { timezone: 'UTC', weekdays: [1], windows: [['01:00']], offPeakMultiplierX1000: 500 } },
  ])('falls back to the built-in peak schedule when the gate $label', async ({ peak }) => {
    const { gate } = client([jsonResponse({
      version: 1,
      models: [{ model: 'good', hitMicros: 1, missMicros: 2, outMicros: 3 }],
      ...peak === undefined ? {} : { peak },
    })])

    await expect(gate.pricing()).resolves.toMatchObject({ peak: DEFAULT_PEAK_SCHEDULE })
  })

  it.each([
    { label: 'the card is not an object', body: 'nope' },
    { label: 'the version is missing', body: { models: [{ model: 'a', hitMicros: 1, missMicros: 1, outMicros: 1 }] } },
    { label: 'the model list is missing', body: { version: 1 } },
  ])('reports the gate as unavailable when $label', async ({ body }) => {
    const { gate } = client([jsonResponse(body)])

    await expect(gate.pricing()).rejects.toThrow(/missing version or models/)
  })

  it('refuses a card whose peak windows are stated on another clock rather than mispricing them', async () => {
    const { gate } = client([jsonResponse({
      version: 1,
      models: [{ model: 'good', hitMicros: 1, missMicros: 2, outMicros: 3 }],
      peak: { timezone: 'Asia/Shanghai', weekdays: [1], windows: [['09:00', '18:00']], offPeakMultiplierX1000: 500 },
    })])

    await expect(gate.pricing()).rejects.toThrow(/"Asia\/Shanghai" clock, which this plugin cannot apply/)
  })

  it('reports the gate as unavailable when no row on the card is readable', async () => {
    const { gate } = client([jsonResponse({ version: 1, models: [{ model: 'a' }] })])

    await expect(gate.pricing()).rejects.toThrow(/priced no models/)
  })
})

describe('GateClient defaults', () => {
  it('uses the platform transport and clock when none is injected', async () => {
    const gate = new GateClient({
      // Port 0 is never listening, so the platform fetch fails and proves it ran.
      gateUrl: 'http://127.0.0.1:1',
      vmToken: 'vm-token-placeholder',
      balanceTtlMs: 0,
      requestTimeoutMs: 250,
    })

    await expect(gate.balance()).rejects.toBeInstanceOf(GateUnavailableError)
  })
})
