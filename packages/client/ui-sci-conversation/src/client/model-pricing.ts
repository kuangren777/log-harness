/**
 * The price lines the composer's model menu shows on a model row, read from
 * the gate's own catalog.
 *
 * The read is cookie-authenticated against the same origin this page is served
 * from (sci-gate reverse-proxies the harness), so no credential reaches this
 * module, and every failure — an unreachable gate, a session it does not
 * recognize, an answer that is not a catalog — arrives as an empty hint list
 * rather than as a throw: a menu with no prices is the degraded reading, an
 * unusable menu is not.
 *
 * A row's `route` is also its client-side provider id: `dsh-sci-models`
 * registers the gate's `camel-api` route under that provider name and the
 * built-in DeepSeek models under `deepseek-official`, so the two ends share
 * one vocabulary instead of a mapping kept in step by hand. A row on a route
 * this build has no provider for simply matches no menu row.
 *
 * The peak schedule the same answer publishes stays out of the lines: it is a
 * clock-dependent discount off these prices, and a menu that quoted the price
 * of the current minute would read as the price of the model.
 */
import type { ModelHint } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** The catalog read; the gate scopes it to the caller's institution from the session cookie alone. */
const MODELS_URL = '/gate/api/models'

/** The gate's money columns are integer micro-USD per one million tokens. */
const MICROS_PER_USD = 1_000_000

/** The gate states a multiplier as an integer thousandth; 1000 is "no markup". */
const RATIO_ONE = 1000

/** Money digits of every user-visible USD amount in this deployment. */
const MONEY_DIGITS = 4

/** Multiplier digits, which carry the gate's full `ratio_x1000` resolution. */
const RATIO_DIGITS = 3

/** One catalog row that carries a complete price; rows without one are dropped. */
interface PricedModel {
  /** Model id as the provider takes it. */
  readonly model: string
  /** Gate route word, which is also the client-side provider id. */
  readonly route: string
  /** Cached-input price per million tokens. */
  readonly hitMicros: number
  /** Fresh-input price per million tokens. */
  readonly missMicros: number
  /** Output price per million tokens. */
  readonly outMicros: number
  /** The institution's resale multiplier, in thousandths. */
  readonly ratioX1000: number
}

/**
 * One cookie-authenticated GET, reduced to its parsed body or nothing.
 * @param f - fetch implementation (injected in tests).
 * @param url - same-origin gate path.
 * @returns the parsed JSON body, or null.
 */
async function readJson(f: typeof fetch, url: string): Promise<unknown> {
  try {
    const response = await f(url, { credentials: 'same-origin' })
    return response.ok ? await response.json() as unknown : null
  } catch {
    return null
  }
}

/**
 * A finite number field, or null for the gate's `null` on an unpriced row.
 * @param value - the raw field.
 * @returns the number, or null.
 */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One catalog row that can be priced.
 * @param raw - one element of the gate's `models` array.
 * @returns the row, or null when it names no model or carries no complete price.
 */
function priced(raw: unknown): PricedModel | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const model = row['model']
  const route = row['route']
  const hitMicros = num(row['hitMicros'])
  const missMicros = num(row['missMicros'])
  const outMicros = num(row['outMicros'])
  const ratioX1000 = num(row['ratioX1000'])
  if (typeof model !== 'string' || typeof route !== 'string') return null
  if (hitMicros === null || missMicros === null || outMicros === null || ratioX1000 === null) return null
  return { model, route, hitMicros, missMicros, outMicros, ratioX1000 }
}

/**
 * One price as this deployment renders money.
 * @param micros - micro-USD per million tokens.
 * @returns the amount with its currency symbol.
 */
function money(micros: number): string {
  return `$${(micros / MICROS_PER_USD).toFixed(MONEY_DIGITS)}`
}

/**
 * A list price with the institution's multiplier applied. The multiplier lands
 * on the integer micro amount, so the displayed cents are rounded once, at the
 * end, from the same multiplier the charger applies. The charged total is not
 * this number: the charger prices each token component separately, rounds each
 * one, and applies the peak multiplier as well.
 * @param micros - micro-USD per million tokens.
 * @param ratioX1000 - the multiplier in thousandths.
 * @returns the effective price as this deployment renders money.
 */
function effective(micros: number, ratioX1000: number): string {
  return money(micros * ratioX1000 / RATIO_ONE)
}

/**
 * The bubble lines of one priced row: the published prices, and the
 * institution's multiplier with what it charges only when it marks them up.
 * @param row - the priced catalog row.
 * @param t - this package's bound translator.
 * @returns one or two lines, in display order.
 */
function linesOf(row: PricedModel, t: TranslateNS<'sci-conversation'>): readonly string[] {
  const official = t('model.official', {
    input: money(row.missMicros),
    output: money(row.outMicros),
    cached: money(row.hitMicros),
  })
  if (row.ratioX1000 === RATIO_ONE) return [official]
  return [official, t('model.ratio', {
    ratio: (row.ratioX1000 / RATIO_ONE).toFixed(RATIO_DIGITS),
    input: effective(row.missMicros, row.ratioX1000),
    output: effective(row.outMicros, row.ratioX1000),
  })]
}

/**
 * Read the institution's model catalog and turn every priced row into the
 * hint of the menu row that names the same provider and model.
 * @param t - this package's bound translator.
 * @param f - fetch implementation (injected in tests).
 * @returns one hint per priced row, empty when the gate answered with none.
 */
export async function fetchModelHints(
  t: TranslateNS<'sci-conversation'>, f: typeof fetch = fetch,
): Promise<readonly ModelHint[]> {
  const body = await readJson(f, MODELS_URL)
  if (typeof body !== 'object' || body === null) return []
  const rows = (body as Record<string, unknown>)['models']
  if (!Array.isArray(rows)) return []
  const hints: ModelHint[] = []
  for (const raw of rows) {
    const row = priced(raw)
    if (row === null) continue
    hints.push({ provider: row.route, model: row.model, lines: linesOf(row, t) })
  }
  return hints
}
