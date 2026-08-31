/**
 * The model menu's price lines: what the gate's catalog becomes, and what a
 * gate that cannot be read becomes instead.
 *
 * The money assertions are verbatim rather than computed, because the four
 * decimals and the one-line/two-line split are the product decision this file
 * exists to hold: a row at the institution's own rate states its price once,
 * and a marked-up row states the published price, the multiplier, and what
 * the multiplier actually charges.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { fetchModelHints } from '../src/client/model-pricing.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

/** One gate answer, then the same one for any further call. */
function fetchStub(...answers: readonly unknown[]) {
  let call = 0
  return vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)]
    call += 1
    if (answer instanceof Error) throw answer
    return answer as Response
  }) as unknown as typeof fetch
}

/** A 200 answer carrying `body`. */
function ok(body: unknown): unknown {
  return { ok: true, json: async () => body }
}

/** The flash row's own numbers, which every case below varies from. */
const FLASH = {
  model: 'deepseek-v4-flash',
  route: 'deepseek-official',
  hitMicros: 14_000,
  missMicros: 440_000,
  outMicros: 1_320_000,
  peakMultiplierX1000: 1000,
  ratioX1000: 1000,
}

describe('model price hints', () => {
  it('reads the institution catalog with the session cookie and prices each row to four decimals', async () => {
    const f = fetchStub(ok({
      version: 3,
      models: [FLASH, { ...FLASH, model: 'gpt-5', route: 'camel-api', ratioX1000: 1500 }],
    }))
    await expect(fetchModelHints(t, f)).resolves.toEqual([
      {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        lines: ['官方输入 $0.4400 / 1M · 输出 $1.3200 / 1M · 缓存命中 $0.0140 / 1M'],
      },
      {
        provider: 'camel-api',
        model: 'gpt-5',
        lines: [
          '官方输入 $0.4400 / 1M · 输出 $1.3200 / 1M · 缓存命中 $0.0140 / 1M',
          '倍率 ×1.500 → 实际输入 $0.6600 / 输出 $1.9800',
        ],
      },
    ])
    expect(f).toHaveBeenCalledWith('/gate/api/models', { credentials: 'same-origin' })
  })

  it('states the multiplier only where there is one', async () => {
    const lines = async (ratioX1000: number) =>
      (await fetchModelHints(t, fetchStub(ok({ models: [{ ...FLASH, ratioX1000 }] }))))[0]?.lines
    // A rate of exactly 1.000 adds nothing a reader does not already see.
    await expect(lines(1000)).resolves.toHaveLength(1)
    // A discount is as much a multiplier as a markup.
    await expect(lines(500)).resolves.toEqual([
      '官方输入 $0.4400 / 1M · 输出 $1.3200 / 1M · 缓存命中 $0.0140 / 1M',
      '倍率 ×0.500 → 实际输入 $0.2200 / 输出 $0.6600',
    ])
  })

  it('drops a row that names no model or carries no complete price, and keeps its neighbours', async () => {
    const f = fetchStub(ok({
      models: [
        null,
        'not a row',
        { ...FLASH, model: 7 },
        { ...FLASH, route: null },
        { ...FLASH, hitMicros: null },
        { ...FLASH, missMicros: null },
        { ...FLASH, outMicros: null },
        { ...FLASH, ratioX1000: null },
        { ...FLASH, missMicros: Number.NaN },
        FLASH,
      ],
    }))
    await expect(fetchModelHints(t, f)).resolves.toEqual([
      {
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        lines: ['官方输入 $0.4400 / 1M · 输出 $1.3200 / 1M · 缓存命中 $0.0140 / 1M'],
      },
    ])
  })

  it('shows no price at all when the gate refuses, is unreachable, or answers something else', async () => {
    await expect(fetchModelHints(t, fetchStub({ ok: false, json: async () => ({}) }))).resolves.toEqual([])
    await expect(fetchModelHints(t, fetchStub(new Error('offline')))).resolves.toEqual([])
    await expect(fetchModelHints(t, fetchStub(ok(null)))).resolves.toEqual([])
    await expect(fetchModelHints(t, fetchStub(ok('not an object')))).resolves.toEqual([])
    await expect(fetchModelHints(t, fetchStub(ok({ models: 'not an array' })))).resolves.toEqual([])
  })

  it('reaches the global fetch when the caller names none', async () => {
    vi.stubGlobal('fetch', fetchStub(ok({ models: [FLASH] })))
    await expect(fetchModelHints(t)).resolves.toHaveLength(1)
    vi.unstubAllGlobals()
  })
})
