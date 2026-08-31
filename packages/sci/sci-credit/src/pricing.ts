/**
 * Integer pricing of one model call: the built-in official rate card, the peak
 * schedule, and the micro-USD arithmetic. Every step is exact integer
 * arithmetic over `BigInt` — a tenant's ledger is integer micro-USD, and a
 * float intermediate would make two identical calls priced on different hosts
 * disagree in the last digit.
 * @module @deepseek-ai/dsh-sci-credit/pricing
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ChargeQuote, PeakSchedule, PeakWindow, PriceRow, PriceTable } from './types.ts'

/** Tokens one rate-card price is quoted per. */
const TOKENS_PER_PRICE_UNIT = 1_000_000n

/** Denominator of a thousandths multiplier. */
const MULTIPLIER_UNIT = 1000n

/**
 * The peak schedule DeepSeek publishes and the gate mirrors: Monday through
 * Friday 01:00–04:00 and 06:00–10:00 UTC are peak, and everything else —
 * weekends included — is half price. Kept here as well as at the gate because
 * the plugin must still price a call when the rate-card fetch failed.
 */
export const DEFAULT_PEAK_SCHEDULE: PeakSchedule = {
  timezone: 'UTC',
  weekdays: [1, 2, 3, 4, 5],
  windows: [['01:00', '04:00'], ['06:00', '10:00']],
  offPeakMultiplierX1000: 500,
}

/**
 * The official DeepSeek USD list price of 2026-08, in micro-USD per 1M tokens
 * at the peak rate. It is the fallback the plugin prices with when the gate's
 * rate card cannot be fetched at boot, so a gate that is briefly unreachable
 * costs a deployment nothing but the version stamp.
 */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  version: 1,
  models: [
    {
      model: 'deepseek-v4-flash',
      hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000,
      peakMultiplierX1000: 1000, ratioX1000: 1000,
    },
    {
      model: 'deepseek-v4-pro',
      hitMicros: 44_000, missMicros: 1_320_000, outMicros: 3_960_000,
      peakMultiplierX1000: 1000, ratioX1000: 1000,
    },
    {
      model: 'deepseek-v4-flash-vision-exp',
      hitMicros: 14_000, missMicros: 440_000, outMicros: 1_320_000,
      peakMultiplierX1000: 1000, ratioX1000: 1000,
    },
  ],
  peak: DEFAULT_PEAK_SCHEDULE,
}

/**
 * Version stamp for a rate card this plugin's own configuration declared. The
 * gate versions its own table from `1` upward, so `0` is unambiguous in a
 * ledger row: the price came from the VM's configuration, not the price list.
 */
export const CONFIGURED_PRICE_VERSION = 0

/**
 * Divide two positive integers, rounding a half up.
 * @param numerator - non-negative dividend.
 * @param denominator - positive divisor.
 * @returns the quotient with `.5` resolved away from zero.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/**
 * Price one token count at one per-1M-token rate.
 * @param tokens - the token count; a negative or fractional count is priced as zero.
 * @param micros - micro-USD per 1M tokens.
 * @returns the component's micro-USD, rounded half up.
 */
function priceComponent(tokens: number, micros: number): bigint {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return 0n
  return divideRoundHalfUp(BigInt(tokens) * BigInt(micros), TOKENS_PER_PRICE_UNIT)
}

/**
 * Minutes since midnight for one `HH:MM` boundary.
 * @param time - the boundary as `HH:MM`.
 * @returns minutes since midnight, or `undefined` when the text is not `HH:MM`.
 */
function minutesOfDay(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/**
 * Whether one instant falls inside a peak window of the schedule.
 *
 * The window start is inclusive and the end exclusive, so `01:00:00` is the
 * first peak second and `10:00:00` is the first off-peak one. Both the weekday
 * and the time of day are read in UTC; a schedule naming any other timezone is
 * rejected rather than silently read as UTC, because a wrong clock would
 * halve or double every price.
 * @param at - the instant to classify, normally the request's start time.
 * @param schedule - the peak schedule to read.
 * @returns whether the peak rate applies at that instant.
 * @throws Error when the schedule names a timezone other than `UTC`.
 */
export function isPeak(at: Date, schedule: PeakSchedule): boolean {
  if (schedule.timezone !== 'UTC') {
    throw new Error(`sci-credit: peak schedule timezone must be UTC, got ${JSON.stringify(schedule.timezone)}`)
  }
  if (!schedule.weekdays.includes(at.getUTCDay())) return false
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes()
  return schedule.windows.some((window: PeakWindow) => {
    const start = minutesOfDay(window[0])
    const end = minutesOfDay(window[1])
    if (start === undefined || end === undefined) return false
    return minute >= start && minute < end
  })
}

/**
 * One row's three prices with its resale multiplier already applied, left
 * scaled by {@link MULTIPLIER_UNIT} because only their order matters here and
 * dividing would round two rows onto the same number.
 * @param row - the card row to scale.
 * @returns the output, uncached-input, and cached-input prices, times the multiplier.
 */
function chargedPrices(row: PriceRow): { out: bigint; miss: bigint; hit: bigint } {
  const ratio = BigInt(row.ratioX1000)
  return {
    out: BigInt(row.outMicros) * ratio,
    miss: BigInt(row.missMicros) * ratio,
    hit: BigInt(row.hitMicros) * ratio,
  }
}

/**
 * The row an unlisted model is priced by: the most expensive one on the card.
 *
 * Comparison walks output, then uncached input, then cached input, then the
 * model id, so the choice is total and does not depend on card order. Each
 * price is read AFTER the row's resale multiplier, because that product is what
 * a call on the row would be charged; comparing list prices would pick a
 * cheaper row whenever a dearer one carries a bigger multiplier. Erring
 * expensive is the safe direction: the alternative is serving an unpriced
 * model below cost until someone notices the ledger.
 * @param models - the card's rows; must be non-empty.
 * @returns the most expensive row.
 */
function mostExpensive(models: readonly PriceRow[]): PriceRow {
  return models.reduce((left, right) => {
    const dearer = chargedPrices(right)
    const held = chargedPrices(left)
    if (dearer.out !== held.out) return dearer.out > held.out ? right : left
    if (dearer.miss !== held.miss) return dearer.miss > held.miss ? right : left
    if (dearer.hit !== held.hit) return dearer.hit > held.hit ? right : left
    return right.model > left.model ? right : left
  })
}

/** One rate-card lookup: the row to price with, and whether it is the fallback. */
export interface ResolvedPriceRow {
  /** The row the components are priced against. */
  readonly row: PriceRow
  /** Whether the card did not list the requested model. */
  readonly unknownModel: boolean
}

/**
 * Find the row that prices one model.
 * @param table - the rate card in force.
 * @param model - the provider model id the request named.
 * @returns the matching row, or the most expensive row marked as a fallback.
 * @throws Error when the card lists no models at all, which cannot price anything.
 */
export function resolvePriceRow(table: PriceTable, model: string): ResolvedPriceRow {
  const listed = table.models.find(row => row.model === model)
  if (listed !== undefined) return { row: listed, unknownModel: false }
  if (table.models.length === 0) {
    throw new Error('sci-credit: rate card lists no models, so no call can be priced')
  }
  return { row: mostExpensive(table.models), unknownModel: true }
}

/**
 * Price one model call.
 *
 * The four components are priced separately and rounded half up each, then
 * summed; the peak multiplier is applied to that sum with a half-up rounding,
 * and the row's resale multiplier to that result with another. Rounding once
 * per component and once per multiplier keeps the arithmetic reproducible from
 * the ledger row alone; multiplying the prices first would compound a rounding
 * error per component instead. The two multipliers are applied in that order
 * and not folded into one, so the official list price and the platform's markup
 * stay separately auditable in the same quote.
 *
 * `reasoningTokens` is deliberately NOT priced on top of `outputTokens`. The
 * DeepSeek adapter maps `completion_tokens` straight to `outputTokens` and
 * reports `completion_tokens_details.reasoning_tokens` beside it without
 * subtracting (`packages/llm/llm-deepseek/src/translate.ts::mapUsage`), which
 * is the OpenAI-compatible convention: reasoning output is already inside the
 * completion count. Adding it would bill every reasoning token twice.
 * `cacheWriteTokens` is priced at the uncached-input rate, because DeepSeek
 * charges a cache write as ordinary uncached input.
 * @param usage - the disjoint token counts the adapter reported.
 * @param table - the rate card in force.
 * @param model - the provider model id the request named.
 * @param startedAt - when the request started, which decides peak or off-peak.
 * @returns the price, its rate-card version, and the pricing inputs that produced it.
 * @throws Error when the card cannot price anything, or names a timezone other than `UTC`.
 */
export function quoteCharge(usage: TokenUsage, table: PriceTable, model: string, startedAt: Date): ChargeQuote {
  const { row, unknownModel } = resolvePriceRow(table, model)
  const peak = isPeak(startedAt, table.peak)
  const atPeak = priceComponent(usage.inputTokens, row.missMicros)
    + priceComponent(usage.cacheWriteTokens ?? 0, row.missMicros)
    + priceComponent(usage.cacheReadTokens ?? 0, row.hitMicros)
    + priceComponent(usage.outputTokens, row.outMicros)
  const multiplier = BigInt(peak ? row.peakMultiplierX1000 : table.peak.offPeakMultiplierX1000)
  const atRate = divideRoundHalfUp(atPeak * multiplier, MULTIPLIER_UNIT)
  const usdMicros = divideRoundHalfUp(atRate * BigInt(row.ratioX1000), MULTIPLIER_UNIT)
  return { usdMicros: Number(usdMicros), priceVersion: table.version, peak, unknownModel, row }
}

/**
 * Complete a partial usage report so the charge payload states every count.
 * @param usage - the counts the adapter reported; absent cache and reasoning fields mean zero.
 * @returns the same counts with every optional field materialized.
 */
export function completeUsage(usage: TokenUsage): Required<TokenUsage> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  }
}
