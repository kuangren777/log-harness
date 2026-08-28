/**
 * Checked readers over `JSON.parse` output. Each one appends one message naming
 * the field path it was given and returns `undefined` on failure, so a caller
 * validates every sibling field in the same pass instead of stopping at the
 * first defect.
 * @module @deepseek-ai/dsh-sci-manifest/fields
 */

/** A parsed JSON object with unknown member types. */
export type JsonObject = Record<string, unknown>

/** The manifest `version` discriminator all three kinds carry. */
export const MANIFEST_VERSION = 1

// Any scheme-qualified prefix: `https:`, `file:`, and a Windows drive letter alike.
const SCHEME_OR_DRIVE = /^[A-Za-z][A-Za-z0-9+.-]*:/
// Format check only, not a calendar-validity check: the platform writes these
// timestamps, so a manifest that carries the wrong shape is the real defect.
const UTC_TIMESTAMP = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/

/**
 * Narrow a parsed JSON value to an object.
 * @param value - any parsed JSON value.
 * @returns whether the value is a non-null, non-array object.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Require a JSON object at one location.
 * @param value - the value found there.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 * @returns the object, or `undefined` when it was not one.
 */
export function requireObject(value: unknown, path: string, errors: string[]): JsonObject | undefined {
  if (isJsonObject(value)) return value
  errors.push(`${path} must be a JSON object`)
  return undefined
}

/**
 * Require a non-empty string member.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 * @returns the string, or `undefined` when it was missing, blank, or another type.
 */
export function requireString(parent: JsonObject, key: string, path: string, errors: string[]): string | undefined {
  const value = parent[key]
  if (typeof value === 'string' && value.length > 0) return value
  errors.push(`${path} must be a non-empty string`)
  return undefined
}

/**
 * Accept an absent member, and require a non-empty string when it is present.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 */
export function optionalString(parent: JsonObject, key: string, path: string, errors: string[]): void {
  const value = parent[key]
  if (value === undefined) return
  if (typeof value === 'string' && value.length > 0) return
  errors.push(`${path} must be a non-empty string when present`)
}

/**
 * Require a finite number member.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 */
export function requireFiniteNumber(parent: JsonObject, key: string, path: string, errors: string[]): void {
  const value = parent[key]
  if (typeof value === 'number' && Number.isFinite(value)) return
  errors.push(`${path} must be a finite number`)
}

/**
 * Require a finite number member greater than zero.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 */
export function requirePositiveNumber(parent: JsonObject, key: string, path: string, errors: string[]): void {
  const value = parent[key]
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return
  errors.push(`${path} must be a number greater than 0`)
}

/**
 * Require an array member, without constraining its rows.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 * @returns the array, or `undefined` when the member was another type.
 */
export function requireArray(parent: JsonObject, key: string, path: string, errors: string[]): readonly unknown[] | undefined {
  const value = parent[key]
  // Array.isArray narrows `unknown` to `any[]`; the rows stay unknown to callers.
  if (Array.isArray(value)) return value as readonly unknown[]
  errors.push(`${path} must be an array`)
  return undefined
}

/**
 * Require the manifest `version` discriminator.
 * @param manifest - the manifest root.
 * @param path - manifest path prefix quoted in the failure message.
 * @param errors - accumulator appended on failure.
 */
export function requireVersion(manifest: JsonObject, path: string, errors: string[]): void {
  if (manifest['version'] === MANIFEST_VERSION) return
  errors.push(`${path}.version must be ${MANIFEST_VERSION}`)
}

/**
 * Require an ISO-8601 UTC timestamp member such as `2026-07-23T08:00:00Z`.
 * @param parent - object holding the member.
 * @param key - member name.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 */
export function requireUtcTimestamp(parent: JsonObject, key: string, path: string, errors: string[]): void {
  const value = parent[key]
  if (typeof value === 'string' && UTC_TIMESTAMP.test(value)) return
  errors.push(`${path} must be an ISO-8601 UTC timestamp such as 2026-07-23T08:00:00Z`)
}

/**
 * Require a path that stays inside the bundle or workspace directory holding
 * the manifest: not a URL, not drive-qualified, not absolute, and free of `..`.
 * @param value - the path exactly as written in the manifest.
 * @param path - field path quoted in the failure message.
 * @param errors - accumulator appended on failure.
 * @returns whether the path is usable, so a caller can skip follow-up checks.
 */
export function requireContainedPath(value: string, path: string, errors: string[]): boolean {
  if (SCHEME_OR_DRIVE.test(value)) {
    errors.push(`${path} must be a bundle-relative path, not a URL or drive-qualified path: ${JSON.stringify(value)}`)
    return false
  }
  if (value.startsWith('/') || value.startsWith('\\')) {
    errors.push(`${path} must be a bundle-relative path, not an absolute path: ${JSON.stringify(value)}`)
    return false
  }
  if (value.split(/[/\\]/).includes('..')) {
    errors.push(`${path} must stay inside the bundle; ${JSON.stringify(value)} escapes it with ".."`)
    return false
  }
  return true
}

/**
 * Require an `entry` member naming a runnable file inside the bundle.
 * @param manifest - the manifest root.
 * @param path - field path quoted in the failure message.
 * @param extensions - lowercase extensions the workbench or render script accepts.
 * @param errors - accumulator appended on failure.
 */
export function requireEntry(manifest: JsonObject, path: string, extensions: readonly string[], errors: string[]): void {
  const entry = requireString(manifest, 'entry', path, errors)
  if (entry === undefined) return
  if (!requireContainedPath(entry, path, errors)) return
  const lowercase = entry.toLowerCase()
  if (extensions.some(extension => lowercase.endsWith(extension))) return
  errors.push(`${path} must name a file with one of these extensions: ${extensions.join(', ')} (got ${JSON.stringify(entry)})`)
}
