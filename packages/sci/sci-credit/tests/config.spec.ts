// The two explicit resolution steps: where the spool goes when configuration
// names no path, and what a configured row list becomes as a rate card.
import { describe, expect, it } from 'vitest'
import { DSH_HOME_ENV } from '@deepseek-ai/dsh-home-paths'
import {
  Config,
  configuredPriceTable,
  DEFAULT_CREDIT_URL,
  DEFAULT_GATE_URL,
  resolveSpoolPath,
  SPOOL_FILE_NAME,
} from '../src/config.ts'
import { CONFIGURED_PRICE_VERSION, DEFAULT_PEAK_SCHEDULE } from '../src/pricing.ts'

describe('resolveSpoolPath', () => {
  it('keeps a path the deployment named', () => {
    expect(resolveSpoolPath('/var/lib/sci/spool.jsonl')).toBe('/var/lib/sci/spool.jsonl')
  })

  it('places the spool under the harness home read at resolution time', () => {
    const previous = process.env[DSH_HOME_ENV]
    process.env.DSH_HOME = '/tmp/dsh-sci-credit-home-probe'
    try {
      expect(resolveSpoolPath(undefined)).toBe(`/tmp/dsh-sci-credit-home-probe/.sci/${SPOOL_FILE_NAME}`)
    } finally {
      // A blank value reads as unset (`resolveDshHome`), which is what an
      // absent original means to every later resolution in this process.
      process.env.DSH_HOME = previous ?? ''
    }
  })
})

describe('configuredPriceTable', () => {
  it('stamps the configured version and carries the built-in peak schedule', () => {
    const rows = [{ model: 'm', hitMicros: 1, missMicros: 2, outMicros: 3, peakMultiplierX1000: 1000, ratioX1000: 1000 }]

    expect(configuredPriceTable(rows)).toEqual({
      version: CONFIGURED_PRICE_VERSION,
      models: rows,
      peak: DEFAULT_PEAK_SCHEDULE,
    })
  })
})

describe('the Config schema', () => {
  it('defaults every field a VM deployment does not state', () => {
    expect(Config({ vmToken: 'vm-token-placeholder' } as unknown as Config)).toMatchObject({
      gateUrl: DEFAULT_GATE_URL,
      failMode: 'closed',
      balanceTtlMs: 2000,
      pricing: 'gate',
      pricingRefreshMs: 600_000,
      requestTimeoutMs: 5000,
      spoolRetryBaseMs: 1000,
      spoolRetryMaxMs: 60_000,
      degradedLogIntervalMs: 60_000,
      creditUrl: DEFAULT_CREDIT_URL,
    })
  })

  it('defaults an inline row to the undiscounted peak and resale multipliers', () => {
    const resolved = Config({
      vmToken: 'vm-token-placeholder',
      pricing: [{ model: 'm', hitMicros: 1, missMicros: 2, outMicros: 3 }],
    } as unknown as Config)

    expect(resolved.pricing).toEqual([
      { model: 'm', hitMicros: 1, missMicros: 2, outMicros: 3, peakMultiplierX1000: 1000, ratioX1000: 1000 },
    ])
  })

  it.each([
    { label: 'no VM token', config: {} },
    { label: 'a fractional balance lifetime', config: { vmToken: 'v', balanceTtlMs: 1.5 } },
    { label: 'a negative balance lifetime', config: { vmToken: 'v', balanceTtlMs: -1 } },
    { label: 'a refresh interval below one second', config: { vmToken: 'v', pricingRefreshMs: 999 } },
    { label: 'an unknown fail mode', config: { vmToken: 'v', failMode: 'ajar' } },
    { label: 'a negative price', config: { vmToken: 'v', pricing: [{ model: 'm', hitMicros: -1, missMicros: 1, outMicros: 1 }] } },
    { label: 'a row with no model id', config: { vmToken: 'v', pricing: [{ hitMicros: 1, missMicros: 1, outMicros: 1 }] } },
    {
      label: 'a zero peak multiplier',
      config: { vmToken: 'v', pricing: [{ model: 'm', hitMicros: 1, missMicros: 1, outMicros: 1, peakMultiplierX1000: 0 }] },
    },
    {
      label: 'a zero resale multiplier',
      config: { vmToken: 'v', pricing: [{ model: 'm', hitMicros: 1, missMicros: 1, outMicros: 1, ratioX1000: 0 }] },
    },
  ])('rejects $label', ({ config }) => {
    expect(() => Config(config as unknown as Config)).toThrow()
  })
})
