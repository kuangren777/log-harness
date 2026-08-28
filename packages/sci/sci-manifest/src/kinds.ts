/**
 * Bundle-kind vocabulary shared by the three validators and their consumers.
 * @module @deepseek-ai/dsh-sci-manifest/kinds
 */

/**
 * The three bundle manifest kinds, in the order the sci packages report them.
 * The name predates the `sci-bundle` → `sci-manifest` package rename and stays
 * as the cross-package contract's published constant.
 */
export const BUNDLE_KINDS = ['paper', 'sciplot', 'canvas'] as const

/** One bundle manifest kind. */
export type ManifestKind = (typeof BUNDLE_KINDS)[number]

/**
 * The outcome of validating one manifest. `errors` is non-empty exactly when
 * `ok` is `false`; every message names the offending field path or entity id so
 * a denial reason can quote it without re-deriving the location.
 */
export type ValidationResult =
  | { readonly ok: true; readonly kind: ManifestKind }
  | { readonly ok: false; readonly kind: ManifestKind; readonly errors: readonly string[] }

/** File extension of each manifest kind, matched against the lower-cased extension. */
const MANIFEST_EXTENSIONS = new Map<string, ManifestKind>([
  ['.paper', 'paper'],
  ['.sciplot', 'sciplot'],
  ['.canvas', 'canvas'],
])

/**
 * Close a validation pass over the errors it accumulated.
 * @param kind - the manifest kind that was validated.
 * @param errors - every message the pass produced, in field order.
 * @returns the success or failure result carrying `kind`.
 */
export function toResult(kind: ManifestKind, errors: string[]): ValidationResult {
  if (errors.length === 0) return { ok: true, kind }
  return { ok: false, kind, errors }
}

/**
 * Classify a path by its manifest extension, without touching the filesystem.
 * The extension is matched case-insensitively (`Report.PAPER` is the same file
 * as `Report.paper` on the case-insensitive filesystems the user-side workbench
 * runs on, and `requireEntry` already accepts `a.TEX`), and a non-empty file
 * name must precede it, so a dotfile named `.paper` is not a bundle manifest.
 * @param path - a POSIX or Windows path, absolute or relative.
 * @returns the manifest kind, or `undefined` when the path names anything else.
 */
export function isManifestPath(path: string): ManifestKind | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  return MANIFEST_EXTENSIONS.get(base.slice(dot).toLowerCase())
}
