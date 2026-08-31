/**
 * The metering itself: one `llm/stream` waterfall listener that refuses a spent
 * tenant before the adapter is reached, passes every chunk of an admitted call
 * through unchanged, and prices the usage the adapter reported once the stream
 * has settled.
 *
 * The class exists so the network transport, the wall clock, the request-id
 * mint, and the timer are injectable without any of them being deployment
 * configuration: `apply` builds one with the platform's, and the suites build
 * one with their own.
 * @module @deepseek-ai/dsh-sci-credit/meter
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmFailure, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { configuredPriceTable, resolveSpoolPath, type Config } from './config.ts'
import { GateClient, GateUnavailableError } from './gate.ts'
import { completeUsage, DEFAULT_PRICE_TABLE, quoteCharge } from './pricing.ts'
import { ChargeSpool, retryDelayMs } from './spool.ts'
import type { ChargePayload, ChargeQuote, PriceTable } from './types.ts'

/** Provider-neutral code for a model call refused because the tenant has no credit left. */
export const CREDIT_EXHAUSTED_CODE = 'CREDIT_EXHAUSTED'

/** Provider-neutral code for a model call refused because the ledger could not be consulted. */
export const CREDIT_GATE_UNAVAILABLE_CODE = 'CREDIT_GATE_UNAVAILABLE'

/**
 * The refusal a spent tenant reads.
 *
 * Bilingual and identical in both halves, because the researcher who hits it
 * may be reading either and the sentence has to carry the one action that
 * clears it — top up or subscribe — plus where to do it.
 * @param creditUrl - the page that sells credit.
 * @returns the refusal message.
 */
export function exhaustedMessage(creditUrl: string): string {
  return `额度已用完，请前往 ${creditUrl} 充值或订阅套餐。 / Credit exhausted — top up or subscribe at ${creditUrl}.`
}

/**
 * The refusal a fail-closed deployment reads when the gate is unreachable.
 *
 * Deliberately NOT the exhausted sentence: the tenant may have plenty of
 * credit, and telling them to buy more would send them to a page that cannot
 * fix anything.
 * @param creditUrl - the page that shows the balance.
 * @returns the refusal message.
 */
export function gateUnavailableMessage(creditUrl: string): string {
  return `额度网关暂时不可用，无法确认余额，请稍后重试或前往 ${creditUrl} 查看。`
    + ` / Credit gate unavailable — the balance could not be confirmed; retry shortly or check ${creditUrl}.`
}

/** Host facilities the meter takes from outside so the suites can substitute them. */
export interface MeterDeps {
  /** HTTP transport for the gate calls. */
  readonly fetch?: typeof fetch
  /** Wall clock, read for the peak decision and the balance cache. */
  readonly now?: () => number
  /** Mints the per-call idempotency key. */
  readonly randomUUID?: () => string
  /**
   * Schedules deferred work and returns its canceller. The default uses an
   * unref'd `setTimeout`, so a pending spool retry never holds the process open.
   */
  readonly setTimer?: (callback: () => void, delayMs: number) => () => void
}

/** The default deferred-work scheduler: an unref'd timer that cannot keep Node alive. */
function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs)
  timer.unref()
  return () => { clearTimeout(timer) }
}

/** One terminal error finish, which is how a waterfall listener refuses a model call. */
function refusalChunk(failure: LlmFailure): StreamChunk {
  return { type: 'finish', reason: { kind: 'error', failure } }
}

/**
 * Credit metering over one mounted context.
 *
 * One instance owns the balance cache, the rate card in force, the spool, and
 * the retry timer; nothing is shared between mounts.
 */
export class CreditMeter {
  private readonly gate: GateClient
  private readonly spool: ChargeSpool
  private readonly now: () => number
  private readonly mintRequestId: () => string
  private readonly setTimer: (callback: () => void, delayMs: number) => () => void
  private table: PriceTable
  private readonly pending = new Set<Promise<void>>()
  private pricingTimer: (() => void) | undefined
  private drainTimer: (() => void) | undefined
  private drainAttempt = 0
  private draining = false
  private disposed = false
  private lastDegradedLogAt: number | undefined

  /**
   * @param ctx - the mounting context, carrying `llm` and `sessions`.
   * @param config - the resolved deployment configuration.
   * @param deps - injected transport, clock, id mint, and scheduler.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    deps: MeterDeps = {},
  ) {
    this.now = deps.now ?? Date.now
    this.mintRequestId = deps.randomUUID ?? randomUUID
    this.setTimer = deps.setTimer ?? defaultSetTimer
    this.gate = new GateClient({
      gateUrl: config.gateUrl,
      vmToken: config.vmToken,
      balanceTtlMs: config.balanceTtlMs,
      requestTimeoutMs: config.requestTimeoutMs,
      ...deps.fetch === undefined ? {} : { fetch: deps.fetch },
      ...deps.now === undefined ? {} : { now: deps.now },
    })
    this.spool = new ChargeSpool(resolveSpoolPath(config.spoolPath))
    this.table = config.pricing === 'gate' ? DEFAULT_PRICE_TABLE : configuredPriceTable(config.pricing)
  }

  /**
   * Register the listener and start the background work.
   *
   * The rate-card fetch and the first spool drain are deliberately not awaited:
   * a gate that is slow at boot must not delay the first model call, which is
   * already priced by the built-in table until the fetch lands.
   */
  install(): void {
    this.ctx.on('llm/stream', (options, next) => this.meter(options, next))
    this.ctx.effect(() => () => { this.dispose() }, 'sci-credit.dispose')
    if (this.config.pricing === 'gate') this.refreshPricing()
    this.scheduleDrain()
  }

  /** The rate card currently in force. */
  get priceTable(): PriceTable {
    return this.table
  }

  /**
   * Wait for every charge, spool write, and rate-card fetch this meter still
   * owes. Called by the suites for their assertions and by teardown so a
   * disposed fiber does not leave a charge half-written.
   * @returns nothing, once no background work remains.
   */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  /** Cancel the timers and stop scheduling new ones. */
  private dispose(): void {
    this.disposed = true
    this.pricingTimer?.()
    this.pricingTimer = undefined
    this.drainTimer?.()
    this.drainTimer = undefined
  }

  /**
   * Meter one model call.
   * @param options - the assembled request.
   * @param next - the downstream `llm/stream` chain.
   * @returns the chunk stream: either one refusal, or every downstream chunk unchanged.
   */
  private async *meter(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const startedAt = new Date(this.now())
    const admitted = await this.admit()
    if (admitted !== undefined) {
      yield admitted
      return
    }
    const requestId = this.mintRequestId()
    let usage: TokenUsage | undefined
    try {
      for await (const chunk of next()) {
        // The LAST usage chunk wins: an adapter that retried inside one call
        // reports the attempt that produced the response the consumer sees.
        if (chunk.type === 'usage') usage = chunk.usage
        yield chunk
      }
    } finally {
      // Reached on a normal finish, on a throw, and on a consumer that abandons
      // the iterator: the tokens were spent in all three cases.
      if (usage !== undefined) this.track(this.recordCharge(requestId, options, usage, startedAt))
    }
  }

  /**
   * Decide whether this call may reach the adapter.
   * @returns the refusal chunk to yield instead of calling `next()`, or `undefined` to proceed.
   */
  private async admit(): Promise<StreamChunk | undefined> {
    try {
      const balance = await this.gate.balance()
      if (!balance.exhausted) return undefined
      return refusalChunk({
        message: exhaustedMessage(this.config.creditUrl),
        code: CREDIT_EXHAUSTED_CODE,
      })
    } catch (error) {
      if (this.config.failMode === 'closed') {
        return refusalChunk({
          message: gateUnavailableMessage(this.config.creditUrl),
          code: CREDIT_GATE_UNAVAILABLE_CODE,
        })
      }
      this.logDegraded(error)
      return undefined
    }
  }

  /**
   * Report a fail-open admission, at most once per configured interval.
   *
   * Throttled because fail-open metering admits every call while the gate is
   * down: one line per model call would bury the outage in its own symptoms.
   * @param error - what the gate read failed with.
   */
  private logDegraded(error: unknown): void {
    const at = this.now()
    if (this.lastDegradedLogAt !== undefined
      && at - this.lastDegradedLogAt < this.config.degradedLogIntervalMs) return
    this.lastDegradedLogAt = at
    this.ctx.logger.warn('sci-credit: admitting model calls unmetered while the gate is unreachable: %o', error)
  }

  /**
   * Price one settled call, deliver the charge, and record it in the session.
   * @param requestId - the idempotency key minted for this call.
   * @param options - the request the usage belongs to.
   * @param usage - the token counts the adapter reported.
   * @param startedAt - when the request started, which decides peak or off-peak.
   * @throws Error when the charge reached neither the gate nor the spool, which
   *   is money spent upstream that nothing will ever collect; the session record
   *   is still written first, with `spooled: false`.
   */
  private async recordCharge(
    requestId: string,
    options: GenerateOptions,
    usage: TokenUsage,
    startedAt: Date,
  ): Promise<void> {
    const quote = quoteCharge(usage, this.table, options.model, startedAt)
    const payload: ChargePayload = {
      requestId,
      sessionId: options.sessionId ?? null,
      model: options.model,
      usage: completeUsage(usage),
      usdMicros: quote.usdMicros,
      priceVersion: quote.priceVersion,
      ratioX1000: quote.row.ratioX1000,
      unknownModel: quote.unknownModel,
    }
    let spooled = false
    try {
      try {
        // A duplicate answer is a success: the gate already holds this exact
        // charge, so there is nothing left to deliver.
        await this.gate.charge(payload)
        // The ledger just moved; a cached balance from before the charge would
        // admit calls a spent tenant can no longer pay for.
        this.gate.invalidateBalance()
      } catch (gateError) {
        await this.spool.append(payload).catch((spoolError: unknown) => {
          throw new Error(
            `sci-credit: charge ${requestId} of ${String(payload.usdMicros)} micro-USD`
            + ' reached neither the gate nor the spool and is lost',
            { cause: new AggregateError([gateError, spoolError]) },
          )
        })
        spooled = true
        this.scheduleDrain()
      }
    } finally {
      // The record is written whatever happened to the delivery: it is what an
      // audit reconciles the tenant's ledger against, and a lost charge is
      // exactly the case that needs to be visible in the log.
      this.appendChargedEvent(options.sessionId, payload, quote, spooled)
    }
  }

  /**
   * Record the charge on the session log, when the request named a live session.
   *
   * A hand-built model call carries no session id, and a session may have been
   * disposed while its last call was still settling; neither has a log to write
   * to and neither is an error.
   * @param sessionId - the session the request named, if any.
   * @param payload - the charge that was priced.
   * @param quote - the price, carrying the peak decision and the row's resale multiplier.
   * @param spooled - whether the payload is waiting in the local spool.
   */
  private appendChargedEvent(
    sessionId: SessionId | undefined,
    payload: ChargePayload,
    quote: ChargeQuote,
    spooled: boolean,
  ): void {
    if (sessionId === undefined) return
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return
    session.append('sci/credit-charged', {
      requestId: payload.requestId,
      model: payload.model,
      usage: payload.usage,
      usdMicros: payload.usdMicros,
      priceVersion: payload.priceVersion,
      peak: quote.peak,
      ratioX1000: quote.row.ratioX1000,
      spooled,
      unknownModel: payload.unknownModel,
    }, { ignorable: true })
  }

  /** Fetch the gate's rate card, keep the previous one on failure, and schedule the next refresh. */
  private refreshPricing(): void {
    this.track((async (): Promise<void> => {
      try {
        this.table = await this.gate.pricing()
      } catch (error) {
        // The built-in official table (or the last good fetch) stays in force:
        // pricing a call from a stale card is far better than not charging it.
        this.ctx.logger.warn('sci-credit: keeping the previous rate card; the gate did not serve one: %o', error)
      }
      if (this.disposed) return
      this.pricingTimer = this.setTimer(() => {
        this.pricingTimer = undefined
        this.refreshPricing()
      }, this.config.pricingRefreshMs)
    })())
  }

  /** Arm the next spool-drain attempt, unless one is already armed or running. */
  private scheduleDrain(): void {
    if (this.disposed || this.draining || this.drainTimer !== undefined) return
    this.drainAttempt += 1
    const delay = retryDelayMs(this.drainAttempt, this.config.spoolRetryBaseMs, this.config.spoolRetryMaxMs)
    this.drainTimer = this.setTimer(() => {
      this.drainTimer = undefined
      this.track(this.runDrain())
    }, delay)
  }

  /** Hand the spool to the gate once, and re-arm with a longer delay while anything remains. */
  private async runDrain(): Promise<void> {
    this.draining = true
    let pending = 1
    try {
      pending = (await this.spool.drain(payload => this.gate.charge(payload))).pending
    } catch (error) {
      this.ctx.logger.warn('sci-credit: reading the charge spool failed: %o', error)
    } finally {
      this.draining = false
    }
    if (pending === 0) {
      this.drainAttempt = 0
      return
    }
    this.scheduleDrain()
  }

  /**
   * Own one background task so teardown and the suites can wait for it, and so
   * a failure is reported rather than becoming an unhandled rejection.
   *
   * Every task handles the outcomes it can act on itself, so anything arriving
   * here has already exhausted them — today only a charge that reached neither
   * the gate nor the spool, which is why it is reported at error severity.
   * @param task - the work to own.
   */
  private track(task: Promise<void>): void {
    const guarded = task.catch((error: unknown) => {
      this.ctx.logger.error(error)
    })
    this.pending.add(guarded)
    void guarded.then(() => { this.pending.delete(guarded) })
  }
}

/** Re-exported so a consumer can distinguish a gate outage from a pricing bug. */
export { GateUnavailableError }
