/**
 * USD credit metering for the science-research profile: the harness side of the
 * self-owned billing seam whose ledger lives in the multi-tenant gate.
 *
 * `apply` owns exactly one contribution, an `llm/stream` waterfall listener,
 * because `llm/stream` is the single seam every model call passes through
 * (`packages/llm/llm/src/index.ts`). The listener does three things in order:
 *
 * - Reads the tenant's balance from the gate, reusing an answer younger than
 *   `balanceTtlMs`. A tenant whose plan and purchased pools are both spent is
 *   refused HERE, before `next()` is called at all, so the refusal costs no
 *   provider tokens. A gate that cannot answer refuses too under the default
 *   `failMode: 'closed'`.
 * - Passes every downstream chunk through unchanged, keeping the last `usage`
 *   chunk the adapter emitted.
 * - Prices that usage against the rate card in force and posts the charge to
 *   the gate, spooling it locally and retrying with backoff if the post fails.
 *   Neither the post nor the spool is ever awaited by the stream.
 *
 * Tool calls are deliberately not metered: a spent tenant is stopped at the
 * model boundary, and the tools it already asked for cost nothing to finish.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-credit
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'
import { CreditMeter } from './meter.ts'
// Type-only: merges the `llm/stream` waterfall and the session store this
// plugin's listener reaches, and the `sci/credit-charged` event it appends.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from './types.ts'

export {
  configuredPriceTable,
  DEFAULT_BALANCE_TTL_MS,
  DEFAULT_CREDIT_URL,
  DEFAULT_DEGRADED_LOG_INTERVAL_MS,
  DEFAULT_GATE_URL,
  DEFAULT_PRICING_REFRESH_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SPOOL_RETRY_BASE_MS,
  DEFAULT_SPOOL_RETRY_MAX_MS,
  resolveSpoolPath,
  SPOOL_DIR_NAME,
  SPOOL_FILE_NAME,
} from './config.ts'
export type { FailMode, PricingSource } from './config.ts'
export { GATE_UNAVAILABLE_CODE, GateClient, GateUnavailableError } from './gate.ts'
export type { GateClientOptions } from './gate.ts'
export {
  CREDIT_EXHAUSTED_CODE,
  CREDIT_GATE_UNAVAILABLE_CODE,
  CreditMeter,
  exhaustedMessage,
  gateUnavailableMessage,
} from './meter.ts'
export type { MeterDeps } from './meter.ts'
export {
  completeUsage,
  CONFIGURED_PRICE_VERSION,
  DEFAULT_PEAK_SCHEDULE,
  DEFAULT_PRICE_TABLE,
  divideRoundHalfUp,
  isPeak,
  quoteCharge,
  resolvePriceRow,
} from './pricing.ts'
export type { ResolvedPriceRow } from './pricing.ts'
export { ChargeSpool, retryDelayMs } from './spool.ts'
export type { DrainReport } from './spool.ts'
export type {
  ChargeOutcome,
  ChargePayload,
  ChargeQuote,
  CreditBalance,
  PeakSchedule,
  PeakWindow,
  PriceRow,
  PriceTable,
  SciCreditChargedData,
} from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'sci-credit'

/**
 * The model-call waterfall this listener joins, and the session store the
 * charge record is appended to.
 */
export const inject = ['llm', 'sessions']

/**
 * Register credit metering on the mounting context.
 * @param ctx - the mounting context, carrying `llm` and `sessions`.
 * @param config - the resolved deployment configuration.
 * @throws Error when `vmToken` is blank, which would charge no ledger at all,
 *   or when an inline rate card lists no model, which could price no call.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.vmToken.trim().length === 0) {
    throw new Error('sci-credit: vmToken must be a non-empty gate VM token')
  }
  if (config.pricing !== 'gate' && config.pricing.length === 0) {
    throw new Error('sci-credit: an inline pricing table must list at least one model, or set pricing to "gate"')
  }
  new CreditMeter(ctx, config).install()
}
