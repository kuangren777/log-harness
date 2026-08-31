// The pricing half is pure, so it is pinned directly: the peak-window
// boundaries the gate publishes, the half-up rounding a micro-USD ledger
// depends on, the fallback row an unpriced model is charged at, and the
// reasoning-token convention the DeepSeek adapter already folds into output.
import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import {
  completeUsage,
  DEFAULT_PEAK_SCHEDULE,
  DEFAULT_PRICE_TABLE,
  divideRoundHalfUp,
  isPeak,
  quoteCharge,
  resolvePriceRow,
} from '../src/pricing.ts'
import type { PeakSchedule, PriceRow, PriceTable } from '../src/types.ts'

/** A two-row card whose prices make every component visible in the total. */
const TABLE: PriceTable = {
  version: 7,
  models: [
    { model: 'cheap', hitMicros: 1000, missMicros: 2000, outMicros: 3000, peakMultiplierX1000: 1000, ratioX1000: 1000 },
    { model: 'dear', hitMicros: 2000, missMicros: 4000, outMicros: 6000, peakMultiplierX1000: 1000, ratioX1000: 1000 },
  ],
  peak: DEFAULT_PEAK_SCHEDULE,
}

/** Monday 02:00 UTC: inside the first peak window. */
const MONDAY_PEAK = new Date('2026-08-31T02:00:00Z')

/** Saturday 02:00 UTC: inside a window, but not on a peak weekday. */
const SATURDAY = new Date('2026-09-05T02:00:00Z')

/** A schedule with the given windows and the built-in weekdays. */
function scheduleWith(windows: readonly (readonly [string, string])[]): PeakSchedule {
  return { ...DEFAULT_PEAK_SCHEDULE, windows }
}

describe('divideRoundHalfUp', () => {
  it.each([
    { numerator: 0n, denominator: 3n, expected: 0n },
    { numerator: 1n, denominator: 3n, expected: 0n },
    { numerator: 1n, denominator: 2n, expected: 1n },
    { numerator: 3n, denominator: 2n, expected: 2n },
    { numerator: 4n, denominator: 2n, expected: 2n },
    { numerator: 5n, denominator: 2n, expected: 3n },
  ])('resolves $numerator/$denominator to $expected', ({ numerator, denominator, expected }) => {
    expect(divideRoundHalfUp(numerator, denominator)).toBe(expected)
  })
})

describe('the peak schedule', () => {
  it.each([
    { label: 'Monday 00:59:59, the last off-peak second before the first window', at: '2026-08-31T00:59:59Z', peak: false },
    { label: 'Monday 01:00:00, the first peak second', at: '2026-08-31T01:00:00Z', peak: true },
    { label: 'Monday 03:59:59, the last second of the first window', at: '2026-08-31T03:59:59Z', peak: true },
    { label: 'Monday 04:00:00, the exclusive end of the first window', at: '2026-08-31T04:00:00Z', peak: false },
    { label: 'Monday 05:59:59, the gap between the windows', at: '2026-08-31T05:59:59Z', peak: false },
    { label: 'Monday 06:00:00, the first second of the second window', at: '2026-08-31T06:00:00Z', peak: true },
    { label: 'Friday 09:59:59, the last peak second of the week', at: '2026-09-04T09:59:59Z', peak: true },
    { label: 'Friday 10:00:00, the exclusive end of the second window', at: '2026-09-04T10:00:00Z', peak: false },
    { label: 'Saturday 02:00, inside a window but off the weekday list', at: '2026-09-05T02:00:00Z', peak: false },
    { label: 'Sunday 07:00, inside a window but off the weekday list', at: '2026-09-06T07:00:00Z', peak: false },
  ])('reads $label as peak=$peak', ({ at, peak }) => {
    expect(isPeak(new Date(at), DEFAULT_PEAK_SCHEDULE)).toBe(peak)
  })

  it('refuses a schedule on any clock other than UTC, rather than reading it as UTC', () => {
    expect(() => isPeak(MONDAY_PEAK, { ...DEFAULT_PEAK_SCHEDULE, timezone: 'Asia/Shanghai' }))
      .toThrow(/timezone must be UTC/)
  })

  it.each([
    { label: 'a start that is not HH:MM', windows: [['0100', '04:00']] as const },
    { label: 'an end that is not HH:MM', windows: [['01:00', 'noon']] as const },
    { label: 'an hour past the end of a day', windows: [['25:00', '26:00']] as const },
    { label: 'a minute past the end of an hour', windows: [['01:60', '04:00']] as const },
  ])('treats a window with $label as no window at all', ({ windows }) => {
    expect(isPeak(MONDAY_PEAK, scheduleWith(windows))).toBe(false)
  })
})

describe('rate-card lookup', () => {
  it('prices a listed model with its own row', () => {
    expect(resolvePriceRow(TABLE, 'cheap')).toEqual({ row: TABLE.models[0], unknownModel: false })
  })

  it('prices an unlisted model with the most expensive row and says so', () => {
    expect(resolvePriceRow(TABLE, 'deepseek-v5-unreleased'))
      .toEqual({ row: TABLE.models[1], unknownModel: true })
  })

  it.each([
    {
      label: 'the higher output price',
      models: [
        { model: 'a', hitMicros: 9, missMicros: 9, outMicros: 1, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 1, missMicros: 1, outMicros: 2, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'b',
    },
    {
      label: 'the higher uncached-input price when output ties',
      models: [
        { model: 'a', hitMicros: 9, missMicros: 1, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 1, missMicros: 2, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'b',
    },
    {
      label: 'the higher cached-input price when both input and output tie',
      models: [
        { model: 'a', hitMicros: 1, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 2, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'b',
    },
    {
      label: 'the later model id when every price ties',
      models: [
        { model: 'a', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'b',
    },
    {
      label: 'the earlier row when it holds the higher output price',
      models: [
        { model: 'a', hitMicros: 1, missMicros: 1, outMicros: 9, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'a',
    },
    {
      label: 'the earlier row when output ties and it holds the higher uncached-input price',
      models: [
        { model: 'a', hitMicros: 1, missMicros: 9, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'a',
    },
    {
      label: 'the earlier row when both input prices tie and it holds the higher cached-input price',
      models: [
        { model: 'a', hitMicros: 9, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'a',
    },
    {
      label: 'the earlier model id when every price ties and it sorts later',
      models: [
        { model: 'z', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 1000 },
      ],
      winner: 'z',
    },
  ])('breaks the fallback choice on $label', ({ models, winner }) => {
    expect(resolvePriceRow({ ...TABLE, models }, 'absent').row.model).toBe(winner)
  })

  it.each([
    {
      label: 'a dearer resale multiplier over a dearer output list price',
      models: [
        { model: 'a', hitMicros: 1, missMicros: 1, outMicros: 10, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 1, missMicros: 1, outMicros: 9, peakMultiplierX1000: 1000, ratioX1000: 2000 },
      ],
      winner: 'b',
    },
    {
      label: 'the uncached-input multiplier when the charged output prices tie',
      models: [
        { model: 'a', hitMicros: 1, missMicros: 10, outMicros: 10, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 1, missMicros: 6, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 2000 },
      ],
      winner: 'b',
    },
    {
      label: 'the cached-input multiplier when both charged input and output prices tie',
      models: [
        { model: 'a', hitMicros: 10, missMicros: 10, outMicros: 10, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 6, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 2000 },
      ],
      winner: 'b',
    },
    {
      label: 'the model id when two rows charge identically through different multipliers',
      models: [
        { model: 'z', hitMicros: 10, missMicros: 10, outMicros: 10, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'b', hitMicros: 5, missMicros: 5, outMicros: 5, peakMultiplierX1000: 1000, ratioX1000: 2000 },
      ],
      winner: 'z',
    },
  ])('reads the fallback prices after the resale multiplier, breaking on $label', ({ models, winner }) => {
    expect(resolvePriceRow({ ...TABLE, models }, 'absent').row.model).toBe(winner)
  })

  it('charges the unlisted model what the chosen row actually costs, not its list price', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [
        { model: 'listed', hitMicros: 0, missMicros: 1_000_000, outMicros: 0, peakMultiplierX1000: 1000, ratioX1000: 1000 },
        { model: 'resold', hitMicros: 0, missMicros: 900_000, outMicros: 0, peakMultiplierX1000: 1000, ratioX1000: 2000 },
      ],
    }

    // The 0.90 list row charges 1.80 and the 1.00 list row charges 1.00, so
    // erring expensive means the resold row and 1_800_000 micro-USD.
    expect(quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, table, 'absent', MONDAY_PEAK))
      .toMatchObject({ usdMicros: 1_800_000, unknownModel: true, row: { model: 'resold' } })
  })

  it('refuses a card that prices nothing, because no call could be charged from it', () => {
    expect(() => resolvePriceRow({ ...TABLE, models: [] }, 'cheap')).toThrow(/lists no models/)
  })
})

describe('quoteCharge', () => {
  it('prices every component against the row and stamps the card version', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      cacheReadTokens: 3_000_000,
      cacheWriteTokens: 4_000_000,
    }

    const quote = quoteCharge(usage, TABLE, 'cheap', MONDAY_PEAK)

    // 1M×2000 + 4M×2000 + 3M×1000 + 2M×3000, all per 1M tokens.
    expect(quote).toMatchObject({
      usdMicros: 2000 + 8000 + 3000 + 6000,
      priceVersion: 7,
      peak: true,
      unknownModel: false,
    })
  })

  it('halves an off-peak call and rounds the halved total up', () => {
    // 1 token × 3000 per 1M rounds to 0; 500 tokens × 3000 per 1M is 1.5 → 2,
    // and half of 2 is exactly 1, so an odd total is needed to see the rounding.
    const odd = quoteCharge({ inputTokens: 0, outputTokens: 1_000_000 }, TABLE, 'cheap', SATURDAY)

    expect(odd).toMatchObject({ usdMicros: 1500, peak: false })
    expect(quoteCharge({ inputTokens: 0, outputTokens: 1_000_000 }, TABLE, 'cheap', MONDAY_PEAK).usdMicros).toBe(3000)
  })

  it('rounds a half-micro component up rather than truncating it away', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [{ model: 'cheap', hitMicros: 0, missMicros: 500_000, outMicros: 0, peakMultiplierX1000: 1000, ratioX1000: 1000 }],
    }

    expect(quoteCharge({ inputTokens: 1, outputTokens: 0 }, table, 'cheap', MONDAY_PEAK).usdMicros).toBe(1)
  })

  it('does not bill reasoning tokens on top of the output count that already contains them', () => {
    const withReasoning = quoteCharge(
      { inputTokens: 0, outputTokens: 1_000_000, reasoningTokens: 900_000 },
      TABLE, 'cheap', MONDAY_PEAK,
    )

    expect(withReasoning.usdMicros)
      .toBe(quoteCharge({ inputTokens: 0, outputTokens: 1_000_000 }, TABLE, 'cheap', MONDAY_PEAK).usdMicros)
  })

  it.each([
    { label: 'a zero count', usage: { inputTokens: 0, outputTokens: 0 } },
    { label: 'a negative count no adapter should report', usage: { inputTokens: -5, outputTokens: -5 } },
    { label: 'a fractional count no adapter should report', usage: { inputTokens: 1.5, outputTokens: 1.5 } },
  ])('prices $label as nothing', ({ usage }) => {
    expect(quoteCharge(usage, TABLE, 'cheap', MONDAY_PEAK).usdMicros).toBe(0)
  })

  it('marks an unlisted model and prices it at the most expensive row', () => {
    const quote = quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, TABLE, 'unlisted', MONDAY_PEAK)

    expect(quote).toMatchObject({ usdMicros: 4000, unknownModel: true })
  })

  it('applies a row that discounts its own peak rate', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [{ model: 'cheap', hitMicros: 0, missMicros: 1_000_000, outMicros: 0, peakMultiplierX1000: 250, ratioX1000: 1000 }],
    }

    expect(quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, table, 'cheap', MONDAY_PEAK).usdMicros).toBe(250_000)
  })

  it('applies the row resale multiplier to the peak-adjusted total', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [{
        model: 'cheap',
        hitMicros: 0, missMicros: 1_000_000, outMicros: 0,
        peakMultiplierX1000: 1000, ratioX1000: 1500,
      }],
    }

    // 1M uncached input at 1.00 USD/1M is 1_000_000 micro-USD at the list rate,
    // and 1.5× that resold; off-peak halves the list rate before the resale.
    expect(quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, table, 'cheap', MONDAY_PEAK).usdMicros)
      .toBe(1_500_000)
    expect(quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, table, 'cheap', SATURDAY).usdMicros)
      .toBe(750_000)
  })

  it('rounds the resale step on its own rather than folding it into the peak multiplier', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [{
        model: 'cheap',
        hitMicros: 0, missMicros: 1_000_000, outMicros: 0,
        peakMultiplierX1000: 1000, ratioX1000: 1500,
      }],
    }

    // One token costs exactly 1 micro-USD at the list rate. Off-peak halves it
    // to 0.5, rounded up to 1, and the resale takes that 1 to 1.5, rounded up
    // to 2. One folded 0.75 multiplier would have charged 1.
    expect(quoteCharge({ inputTokens: 1, outputTokens: 0 }, table, 'cheap', SATURDAY).usdMicros).toBe(2)
  })

  it('leaves the priced total untouched when the row resells at cost', () => {
    const atCost = quoteCharge({ inputTokens: 1_000_000, outputTokens: 2_000_000 }, TABLE, 'cheap', MONDAY_PEAK)

    expect(atCost.row.ratioX1000).toBe(1000)
    expect(atCost.usdMicros).toBe(2000 + 6000)
  })

  it('stamps the charge with the row version when the card states one per row', () => {
    const table: PriceTable = {
      ...TABLE,
      models: [{ ...TABLE.models[0] as PriceRow, version: 42 }],
    }

    // The card is version 7; the row is the one a ledger row must join on.
    expect(quoteCharge({ inputTokens: 0, outputTokens: 0 }, table, 'cheap', MONDAY_PEAK).priceVersion).toBe(42)
  })

  it('falls back to the card version for a gate that versions its whole price list at once', () => {
    expect(quoteCharge({ inputTokens: 0, outputTokens: 0 }, TABLE, 'cheap', MONDAY_PEAK).priceVersion).toBe(7)
  })

  it('prices the built-in official card at the published list rate', () => {
    // deepseek-v4-pro: 1M uncached input at 1.32 USD/1M, peak.
    expect(quoteCharge({ inputTokens: 1_000_000, outputTokens: 0 }, DEFAULT_PRICE_TABLE, 'deepseek-v4-pro', MONDAY_PEAK))
      .toMatchObject({
        usdMicros: 1_320_000,
        priceVersion: 1,
        peak: true,
        unknownModel: false,
        row: { ratioX1000: 1000 },
      })
  })
})

describe('completeUsage', () => {
  it('materializes every optional count as zero', () => {
    expect(completeUsage({ inputTokens: 3, outputTokens: 4 })).toEqual({
      inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
    })
  })

  it('keeps the counts the adapter did report', () => {
    expect(completeUsage({
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5,
    })).toEqual({
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5,
    })
  })
})
