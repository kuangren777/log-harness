/**
 * Deployment-varying choices for credit metering: which gate keeps the ledger,
 * which token addresses it, what happens when it cannot be reached, how long a
 * balance answer may be reused, where the rate card comes from, where an
 * undelivered charge waits, and which page a refused user is sent to.
 * @module @deepseek-ai/dsh-sci-credit/config
 */

import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { CONFIGURED_PRICE_VERSION, DEFAULT_PEAK_SCHEDULE } from './pricing.ts'
import type { PriceRow, PriceTable } from './types.ts'

/** What metering does when the gate cannot answer whether the tenant has credit. */
export type FailMode = 'closed' | 'open'

/** Where the rate card comes from: the gate's published price list, or configuration. */
export type PricingSource = 'gate' | PriceRow[]

/** Default gate endpoint: the loopback port the VM's own gate listens on. */
export const DEFAULT_GATE_URL = 'http://127.0.0.1:3079'

/** Default balance-cache lifetime, long enough to cover one tool loop's rapid steps. */
export const DEFAULT_BALANCE_TTL_MS = 2000

/** Default rate-card refresh interval. */
export const DEFAULT_PRICING_REFRESH_MS = 600_000

/** Default HTTP deadline for one gate call. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000

/** Default first spool-retry delay. */
export const DEFAULT_SPOOL_RETRY_BASE_MS = 1000

/** Default ceiling the doubling spool-retry delay stops at. */
export const DEFAULT_SPOOL_RETRY_MAX_MS = 60_000

/** Default page a refused user is sent to; served by the gate under its own prefix. */
export const DEFAULT_CREDIT_URL = '/gate/credit'

/** Default throttle for the fail-open degraded-metering warning. */
export const DEFAULT_DEGRADED_LOG_INTERVAL_MS = 60_000

/** Harness-home-relative directory holding this profile's local state. */
export const SPOOL_DIR_NAME = '.sci'

/** File name of the undelivered-charge spool. */
export const SPOOL_FILE_NAME = 'credit-spool.jsonl'

/** Deployment-varying choices for credit metering. */
export interface Config {
  /** Base URL of the gate that keeps this tenant's ledger. */
  gateUrl: string
  /**
   * Bearer token identifying this VM to the gate. Required and has no default:
   * it names WHOSE ledger every charge lands in, and a guess would bill another
   * tenant. A deployment with no gate removes this row rather than blanking it.
   */
  vmToken: string
  /**
   * What happens when the balance cannot be read. `closed` refuses the model
   * call, `open` runs it unmetered-but-charged and logs. Deployments that would
   * rather lose a request than lose money keep the default.
   */
  failMode: FailMode
  /**
   * How long one balance answer may be reused. A tool loop issues many model
   * calls a second apart, and asking the gate for each would add a round trip
   * per step to answer the same question.
   */
  balanceTtlMs: number
  /**
   * `gate` fetches the published price list at boot and refreshes it, falling
   * back to the built-in official table when the fetch fails. An explicit row
   * list prices from configuration alone and never asks the gate.
   */
  pricing: PricingSource
  /** How often a `gate` rate card is re-fetched. */
  pricingRefreshMs: number
  /** HTTP deadline for one gate call, after which it counts as unreachable. */
  requestTimeoutMs: number
  /** Delay before the first spool-drain retry; each further attempt doubles it. */
  spoolRetryBaseMs: number
  /** Ceiling the doubling spool-retry delay stops at. */
  spoolRetryMaxMs: number
  /**
   * How often `failMode: 'open'` may report that it is admitting calls
   * unmetered. Fail-open metering admits every call while the gate is down, so
   * one line per model call would bury the outage in its own symptoms; a
   * deployment that wants each occurrence lowers this to zero.
   */
  degradedLogIntervalMs: number
  /**
   * File the undelivered charges wait in. Omitted resolves to
   * `$DSH_HOME/.sci/credit-spool.jsonl` through {@link resolveSpoolPath}, which
   * reads the harness home at mount time rather than at module load.
   */
  spoolPath?: string
  /** Page the refusal message sends the user to; a gate-relative path or an absolute URL. */
  creditUrl: string
}

const priceRow: z<PriceRow> = z.object({
  model: z.string().required(),
  hitMicros: z.number().step(1).min(0).required(),
  missMicros: z.number().step(1).min(0).required(),
  outMicros: z.number().step(1).min(0).required(),
  peakMultiplierX1000: z.number().step(1).min(1).default(1000),
  ratioX1000: z.number().step(1).min(1).default(1000),
})

/** Schemastery schema for credit metering. */
export const Config: z<Config> = z.object({
  gateUrl: z.string().default(DEFAULT_GATE_URL),
  vmToken: z.string().required(),
  failMode: z.union(['closed', 'open'] as const).default('closed'),
  balanceTtlMs: z.number().step(1).min(0).default(DEFAULT_BALANCE_TTL_MS),
  pricing: z.union([z.const('gate' as const), z.array(priceRow)]).default('gate'),
  pricingRefreshMs: z.number().step(1).min(1000).default(DEFAULT_PRICING_REFRESH_MS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  spoolRetryBaseMs: z.number().step(1).min(1).default(DEFAULT_SPOOL_RETRY_BASE_MS),
  spoolRetryMaxMs: z.number().step(1).min(1).default(DEFAULT_SPOOL_RETRY_MAX_MS),
  degradedLogIntervalMs: z.number().step(1).min(0).default(DEFAULT_DEGRADED_LOG_INTERVAL_MS),
  spoolPath: z.string(),
  creditUrl: z.string().default(DEFAULT_CREDIT_URL),
})

/**
 * Place the undelivered-charge spool.
 * @param configured - the configured path, or `undefined` to use the harness home.
 * @returns the absolute spool path.
 */
export function resolveSpoolPath(configured: string | undefined): string {
  return configured ?? dshHomePath(SPOOL_DIR_NAME, SPOOL_FILE_NAME)
}

/**
 * Turn a configured row list into a complete rate card.
 *
 * A configured table carries the built-in peak schedule: the schedule is the
 * provider's published rule rather than a per-deployment choice, and a row list
 * that restated it would let a deployment silently double every price.
 * @param models - the configured rows.
 * @returns the rate card, stamped {@link CONFIGURED_PRICE_VERSION}.
 */
export function configuredPriceTable(models: readonly PriceRow[]): PriceTable {
  return { version: CONFIGURED_PRICE_VERSION, models, peak: DEFAULT_PEAK_SCHEDULE }
}
