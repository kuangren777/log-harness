/**
 * Narrowing helpers for the four indexes' replies and the query-string builder
 * every adapter uses.
 *
 * A reply crosses a wire boundary, so nothing about it is guaranteed by the
 * type system: each accessor answers `undefined` for a field that is absent,
 * null, of the wrong type, or empty, and the adapters build records only out of
 * what survived. Empty counts as absent throughout — one index returns `""` for
 * a venue it does not know, and an empty venue on a record reads as a fact.
 * @module @deepseek-ai/dsh-sci-literature/src/wire
 */

/**
 * Narrow one reply node to a plain object.
 * @param value - the untrusted node.
 * @returns the object, or `undefined` for null, an array, or a non-object.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * Narrow one reply node to an array.
 * @param value - the untrusted node.
 * @returns the array, or `undefined` when the node is not one.
 */
export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? (value as readonly unknown[]) : undefined
}

/**
 * Narrow one reply node to a non-empty string.
 * @param value - the untrusted node.
 * @returns the string, or `undefined` when it is absent, not a string, or blank.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Narrow one reply node to a non-negative integer.
 * @param value - the untrusted node.
 * @returns the integer, or `undefined` when it is absent, not a number, negative, or fractional.
 */
export function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * Narrow one reply node to a four-digit publication year.
 * @param value - the untrusted node.
 * @returns the year, or `undefined` when it is absent or outside 1000..9999.
 */
export function asYear(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999 ? value : undefined
}

/**
 * Build one absolute request URL, dropping every parameter with no value.
 * @param base - the endpoint URL with no query string.
 * @param params - query parameters; entries whose value is `undefined` or empty are omitted.
 * @returns the encoded URL.
 */
export function buildUrl(base: string, params: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, value)
  }
  const search = query.toString()
  return search === '' ? base : `${base}?${search}`
}

/**
 * The `<from>-<to>` bound the OpenAlex and Semantic Scholar year filters take.
 * @param yearFrom - inclusive lower bound, when the request set one.
 * @param yearTo - inclusive upper bound, when the request set one.
 * @returns the range, or `undefined` when the request bounded neither end.
 */
export function yearRange(yearFrom: number | undefined, yearTo: number | undefined): string | undefined {
  if (yearFrom === undefined && yearTo === undefined) return undefined
  return `${yearFrom ?? ''}-${yearTo ?? ''}`
}
