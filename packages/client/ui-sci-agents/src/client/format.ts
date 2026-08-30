/**
 * The readings the roster, the configuration page, and the log put on screen.
 *
 * Pure functions over the host's numbers: every one of them turns a value the
 * host actually reported into the shape the design reference draws, and none
 * of them invents a value for a fact the host did not report — a stat the
 * host left absent loses its tile rather than reading as a zero.
 */

/** Sequential glyphs the roster cards carry, one per persona in host order. */
const GLYPHS = ['α', 'β', 'γ', 'δ', 'ε', 'ζ'] as const

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000

/** Milliseconds in one minute, above which a duration reads as `m:ss`. */
const MS_PER_MINUTE = 60_000

/** Seconds in one minute, for the padded seconds of an `m:ss` reading. */
const SECONDS_PER_MINUTE = 60

/** Thousands, the first magnitude a token count abbreviates at. */
const THOUSAND = 1000

/** Millions, the second magnitude a token count abbreviates at. */
const MILLION = 1_000_000

/**
 * The card glyph for one roster position.
 * @param index - the persona's position in the host's roster order.
 * @returns the Greek glyph, or the 1-based position past the sixth persona.
 */
export function glyphOf(index: number): string {
  return GLYPHS[index] ?? String(index + 1)
}

/**
 * Pad one number to two digits.
 * @param value - the number to pad.
 * @returns the two-digit reading.
 */
function two(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * One duration, as the design reference reads it: seconds with one decimal
 * up to a minute, `m:ss` above that.
 * @param milliseconds - the host-reported duration.
 * @returns the reading.
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < MS_PER_MINUTE) return `${(milliseconds / MS_PER_SECOND).toFixed(1)}s`
  const total = Math.round(milliseconds / MS_PER_SECOND)
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${two(total % SECONDS_PER_MINUTE)}`
}

/**
 * One token count, abbreviated at thousands and millions.
 * @param tokens - the host-reported count.
 * @returns the reading, with a bare `.0` fraction dropped.
 */
export function formatTokens(tokens: number): string {
  if (tokens < THOUSAND) return String(tokens)
  const scaled = tokens < MILLION
    ? `${(tokens / THOUSAND).toFixed(1)}K`
    : `${(tokens / MILLION).toFixed(1)}M`
  return scaled.replace(/\.0(?=[KM]$)/u, '')
}

/**
 * One call count, grouped in thousands.
 * @param count - the host-reported count.
 * @returns the grouped reading.
 */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(?:\d{3})+$)/gu, ',')
}

/**
 * One delegation's wall-clock time in the reader's own zone.
 * @param timestamp - epoch milliseconds of the call.
 * @returns `MM-DD HH:MM:SS`.
 */
export function formatClock(timestamp: number): string {
  const at = new Date(timestamp)
  const day = `${two(at.getMonth() + 1)}-${two(at.getDate())}`
  return `${day} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}
