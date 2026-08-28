/**
 * Credit-metering vocabulary: the rate card, the gate's answers, the charge
 * payload the spool persists, and the session record one metered model call
 * leaves behind.
 * @module @deepseek-ai/dsh-sci-credit/types
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** One model's official list price, in micro-USD per 1M tokens at the PEAK rate. */
export interface PriceRow {
  /** Provider model id the charge is priced under. */
  readonly model: string
  /** Cached-input price: what a `cacheReadTokens` token costs. */
  readonly hitMicros: number
  /** Uncached-input price: what an `inputTokens` or `cacheWriteTokens` token costs. */
  readonly missMicros: number
  /** Output price: what an `outputTokens` token costs. */
  readonly outMicros: number
  /**
   * Peak multiplier in thousandths. The stored price already IS the peak
   * price, so the gate seeds `1000`; a deployment that discounts its peak rate
   * lowers this instead of restating every row.
   */
  readonly peakMultiplierX1000: number
}

/** One peak window as `[startInclusive, endExclusive]` in `HH:MM`, on the schedule's own clock. */
export type PeakWindow = readonly [string, string]

/**
 * When the peak rate applies. The gate publishes this rule and never applies
 * it: one authority for the rule, one authority for the wall clock.
 */
export interface PeakSchedule {
  /** Clock the windows and weekdays are read on. Only `UTC` is implemented. */
  readonly timezone: string
  /** Days the windows apply on, `0` = Sunday through `6` = Saturday. */
  readonly weekdays: readonly number[]
  /** Peak windows within a listed weekday; a time outside every window is off-peak. */
  readonly windows: readonly PeakWindow[]
  /** Off-peak multiplier in thousandths, applied to the summed peak-priced total. */
  readonly offPeakMultiplierX1000: number
}

/** A complete rate card: the priced models plus the schedule that discounts them. */
export interface PriceTable {
  /**
   * Version the charge is recorded under, so a later price change leaves old
   * charges auditable at the rate they were priced with. `0` marks a table
   * declared in this plugin's own configuration rather than served by the gate.
   */
  readonly version: number
  /** The priced models. A request naming none of them is priced by the most expensive row. */
  readonly models: readonly PriceRow[]
  /** The peak schedule this card's prices are the peak rate of. */
  readonly peak: PeakSchedule
}

/** What one model call costs, and the pricing inputs that produced the number. */
export interface ChargeQuote {
  /** The amount to charge, in micro-USD. */
  readonly usdMicros: number
  /** The rate-card version the price came from. */
  readonly priceVersion: number
  /** Whether the request started inside a peak window. */
  readonly peak: boolean
  /** Whether the model was absent from the rate card and priced by its most expensive row. */
  readonly unknownModel: boolean
  /** The row the components were priced against. */
  readonly row: PriceRow
}

/** The gate's `GET /gate/api/credit/balance` answer, reduced to what metering reads. */
export interface CreditBalance {
  /** Subscription-granted micro-USD remaining in the current period. */
  readonly planMicros: number
  /** Purchased micro-USD remaining; the gate lets this go negative. */
  readonly creditMicros: number
  /** Both pools summed. */
  readonly totalMicros: number
  /** Whether both pools are spent, which is the gate's own refusal condition. */
  readonly exhausted: boolean
}

/** One `POST /gate/api/credit/charge` body, as spooled and as sent. */
export interface ChargePayload {
  /** Idempotency key: the gate answers a replay from its ledger instead of charging twice. */
  readonly requestId: string
  /** The session the call belongs to, or `null` for a call with no session. */
  readonly sessionId: string | null
  /** Provider model id as the request named it, even when the rate card did not price it. */
  readonly model: string
  /** The disjoint token counts the adapter reported. */
  readonly usage: Required<TokenUsage>
  /** The price this plugin computed, in micro-USD. */
  readonly usdMicros: number
  /** The rate-card version the price came from. */
  readonly priceVersion: number
  /** Whether the model was priced by the most expensive row because the card did not list it. */
  readonly unknownModel: boolean
}

/** What the gate answered one charge attempt with. */
export interface ChargeOutcome {
  /** True when the gate recognized the request id and answered from its ledger. */
  readonly duplicate: boolean
}

/** Payload of {@link SessionEventMap['sci/credit-charged']}. */
export interface SciCreditChargedData {
  /** The idempotency key the charge was sent under; the ledger row's `ref` is `req:<requestId>`. */
  readonly requestId: string
  /** Provider model id the request named. */
  readonly model: string
  /** The disjoint token counts the charge was computed from. */
  readonly usage: Required<TokenUsage>
  /** What the call cost, in micro-USD. */
  readonly usdMicros: number
  /** The rate-card version the price came from; `0` for a configured table. */
  readonly priceVersion: number
  /** Whether the request started inside a peak window. */
  readonly peak: boolean
  /** Whether the gate refused or could not be reached and the payload is waiting in the spool. */
  readonly spooled: boolean
  /** Whether the rate card did not list the model and its most expensive row was used. */
  readonly unknownModel: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One model call was priced and its charge handed to the gate. Log-only
     * and non-surface: the model never reads it, nothing later in the log is
     * interpreted differently by its presence, and it exists so an audit
     * projection can reconcile the session against the tenant's ledger. The
     * producer appends it with the envelope's `ignorable` marker, so a reader
     * that does not know the type skips it instead of refusing the log.
     * @param data - the idempotency key, the model, the token counts, the
     *   computed micro-USD, the rate-card version, whether the request started
     *   in a peak window, whether the payload is waiting in the local spool,
     *   and whether the model was priced by the fallback row.
     */
    'sci/credit-charged': SciCreditChargedData
  }
}
