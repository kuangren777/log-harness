/**
 * HTTP client for the gate's credit API: the balance read metering gates on,
 * the charge that moves the ledger, and the published rate card.
 *
 * Every answer crosses a process boundary, so every field is validated here
 * rather than trusted from the type. A malformed or unreachable gate raises
 * {@link GateUnavailableError}, which is the single failure the caller's
 * fail-closed and spool decisions are made on.
 * @module @deepseek-ai/dsh-sci-credit/gate
 */

import type { ChargeOutcome, ChargePayload, CreditBalance, PeakSchedule, PriceRow, PriceTable } from './types.ts'
import { DEFAULT_PEAK_SCHEDULE } from './pricing.ts'

/** Path of the balance read, relative to the gate's base URL. */
const BALANCE_PATH = '/gate/api/credit/balance'

/** Path of the charge write, relative to the gate's base URL. */
const CHARGE_PATH = '/gate/api/credit/charge'

/** Path of the published rate card, relative to the gate's base URL. */
const PRICING_PATH = '/gate/api/credit/pricing'

/** Machine code every gate-side failure carries. */
export const GATE_UNAVAILABLE_CODE = 'CREDIT_GATE_UNAVAILABLE'

/**
 * The gate could not be reached, timed out, refused the call, or answered
 * something this client cannot read. All four are one condition for the
 * caller: nothing about the tenant's ledger is known right now.
 */
export class GateUnavailableError extends Error {
  /** Stable machine-routable failure class. */
  readonly code: string = GATE_UNAVAILABLE_CODE

  /**
   * @param message - what specifically failed, for the operator's log.
   * @param options - optional cause chaining.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GateUnavailableError'
  }
}

/** Construction options for {@link GateClient}. */
export interface GateClientOptions {
  /** Base URL of the gate; a trailing slash is tolerated. */
  readonly gateUrl: string
  /** Bearer token identifying this VM's tenant. */
  readonly vmToken: string
  /** How long one balance answer may be reused. */
  readonly balanceTtlMs: number
  /** HTTP deadline for one call, after which it counts as unreachable. */
  readonly requestTimeoutMs: number
  /** Transport; tests substitute one, deployments get the platform's. */
  readonly fetch?: typeof fetch
  /** Clock the balance cache ages against; tests substitute one. */
  readonly now?: () => number
}

/** A non-negative safe integer read off a JSON field, or `undefined`. */
function integerField(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/** A JSON object, or `undefined` when the value is not one. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Read the balance answer.
 * @param body - the parsed JSON body.
 * @returns the balance.
 * @throws GateUnavailableError when a required field is missing or not an integer.
 */
function readBalance(body: unknown): CreditBalance {
  const source = objectValue(body)
  const planMicros = source === undefined ? undefined : integerField(source, 'planMicros')
  const creditMicros = source === undefined ? undefined : integerField(source, 'creditMicros')
  const totalMicros = source === undefined ? undefined : integerField(source, 'totalMicros')
  if (source === undefined || planMicros === undefined || creditMicros === undefined || totalMicros === undefined) {
    throw new GateUnavailableError('sci-credit: gate balance answer is missing planMicros/creditMicros/totalMicros')
  }
  if (typeof source['exhausted'] !== 'boolean') {
    throw new GateUnavailableError('sci-credit: gate balance answer is missing the exhausted flag')
  }
  return { planMicros, creditMicros, totalMicros, exhausted: source['exhausted'] }
}

/**
 * Read the peak schedule the rate card publishes.
 *
 * An absent or unreadable schedule falls back to the built-in rule, which is
 * the same rule the gate seeds. A schedule that names a clock other than UTC is
 * refused instead: the plugin can only read UTC, and applying UTC windows to
 * windows meant for another zone would misprice every call in silence.
 * @param value - the answer's `peak` member.
 * @returns the schedule to price with.
 * @throws GateUnavailableError when the schedule names a clock other than `UTC`.
 */
function readPeakSchedule(value: unknown): PeakSchedule {
  const source = objectValue(value)
  if (source === undefined) return DEFAULT_PEAK_SCHEDULE
  if (typeof source['timezone'] === 'string' && source['timezone'] !== DEFAULT_PEAK_SCHEDULE.timezone) {
    throw new GateUnavailableError(
      `sci-credit: gate rate card states its peak windows on the ${JSON.stringify(source['timezone'])} clock,`
      + ' which this plugin cannot apply',
    )
  }
  const weekdays = source['weekdays']
  const windows = source['windows']
  const multiplier = integerField(source, 'offPeakMultiplierX1000')
  if (typeof source['timezone'] !== 'string'
    || !Array.isArray(weekdays) || !weekdays.every(day => typeof day === 'number')
    || !Array.isArray(windows)
    || multiplier === undefined) {
    return DEFAULT_PEAK_SCHEDULE
  }
  const parsed = windows.filter((window): window is [string, string] => Array.isArray(window)
    && window.length === 2 && window.every(edge => typeof edge === 'string'))
  if (parsed.length !== windows.length) return DEFAULT_PEAK_SCHEDULE
  return { timezone: source['timezone'], weekdays, windows: parsed, offPeakMultiplierX1000: multiplier }
}

/**
 * Read the published rate card.
 * @param body - the parsed JSON body.
 * @returns the rate card.
 * @throws GateUnavailableError when the version or every row is unreadable.
 */
function readPriceTable(body: unknown): PriceTable {
  const source = objectValue(body)
  const version = source === undefined ? undefined : integerField(source, 'version')
  const rows = source?.['models']
  if (source === undefined || version === undefined || !Array.isArray(rows)) {
    throw new GateUnavailableError('sci-credit: gate rate card is missing version or models')
  }
  const models: PriceRow[] = []
  for (const entry of rows) {
    const row = objectValue(entry)
    if (row === undefined || typeof row['model'] !== 'string') continue
    const hitMicros = integerField(row, 'hitMicros')
    const missMicros = integerField(row, 'missMicros')
    const outMicros = integerField(row, 'outMicros')
    if (hitMicros === undefined || missMicros === undefined || outMicros === undefined) continue
    models.push({
      model: row['model'],
      hitMicros,
      missMicros,
      outMicros,
      peakMultiplierX1000: integerField(row, 'peakMultiplierX1000') ?? 1000,
    })
  }
  if (models.length === 0) {
    throw new GateUnavailableError('sci-credit: gate rate card priced no models')
  }
  return { version, models, peak: readPeakSchedule(source['peak']) }
}

/** One cached balance answer and when it was read. */
interface CachedBalance {
  readonly balance: CreditBalance
  readonly readAt: number
}

/**
 * The gate's credit API as three methods. One instance per mounted plugin: the
 * balance cache and the in-flight coalescing are per-token state, and two
 * clients would each keep their own.
 */
export class GateClient {
  private readonly transport: typeof fetch
  private readonly clock: () => number
  private cached: CachedBalance | undefined
  private inFlight: Promise<CreditBalance> | undefined

  /**
   * @param options - endpoint, credential, cache lifetime, deadline, and the injected transport and clock.
   */
  constructor(private readonly options: GateClientOptions) {
    this.transport = options.fetch ?? globalThis.fetch
    this.clock = options.now ?? Date.now
  }

  /**
   * Read the tenant's balance, reusing an answer younger than the configured
   * lifetime and coalescing concurrent reads onto one request.
   * @returns the balance.
   * @throws GateUnavailableError when the gate cannot answer.
   */
  balance(): Promise<CreditBalance> {
    const cached = this.cached
    if (cached !== undefined && this.clock() - cached.readAt < this.options.balanceTtlMs) {
      return Promise.resolve(cached.balance)
    }
    const existing = this.inFlight
    if (existing !== undefined) return existing
    const request = this.readBalanceFromGate()
      .then((balance) => {
        this.cached = { balance, readAt: this.clock() }
        return balance
      })
      .finally(() => { this.inFlight = undefined })
    this.inFlight = request
    return request
  }

  /**
   * Record one call's cost against the tenant's ledger.
   * @param payload - the charge body, whose `requestId` is the gate's idempotency key.
   * @returns whether the gate answered from an existing ledger row.
   * @throws GateUnavailableError when the gate cannot be reached or refuses the charge.
   */
  async charge(payload: ChargePayload): Promise<ChargeOutcome> {
    const body = await this.call(CHARGE_PATH, 'POST', JSON.stringify(payload))
    return { duplicate: objectValue(body)?.['duplicate'] === true }
  }

  /**
   * Read the gate's published rate card.
   * @returns the rate card.
   * @throws GateUnavailableError when the gate cannot be reached or answers unreadably.
   */
  async pricing(): Promise<PriceTable> {
    return readPriceTable(await this.call(PRICING_PATH, 'GET'))
  }

  /** Drop the cached balance so the next read reaches the gate. */
  invalidateBalance(): void {
    this.cached = undefined
  }

  /**
   * Read the balance straight from the gate, bypassing the cache.
   * @returns the balance.
   * @throws GateUnavailableError when the gate cannot answer.
   */
  private async readBalanceFromGate(): Promise<CreditBalance> {
    return readBalance(await this.call(BALANCE_PATH, 'GET'))
  }

  /**
   * Issue one authenticated gate call and parse its JSON body.
   * @param path - the API path, relative to the configured base URL.
   * @param method - the HTTP method, also named in every failure message.
   * @param body - the JSON request body, for the one call that carries one.
   * @returns the parsed JSON body.
   * @throws GateUnavailableError on a transport failure, a timeout, a non-2xx status, or unparseable JSON.
   */
  private async call(path: string, method: 'GET' | 'POST', body?: string): Promise<unknown> {
    const url = `${this.options.gateUrl.replace(/\/+$/, '')}${path}`
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.vmToken}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await this.transport(url, {
        method,
        headers,
        ...body === undefined ? {} : { body },
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new GateUnavailableError(`sci-credit: ${method} ${path} did not reach the gate`, { cause: error })
    }
    if (!response.ok) {
      throw new GateUnavailableError(`sci-credit: ${method} ${path} answered HTTP ${String(response.status)}`)
    }
    try {
      return await response.json()
    } catch (error) {
      throw new GateUnavailableError(`sci-credit: ${method} ${path} answered unparseable JSON`, { cause: error })
    }
  }
}
