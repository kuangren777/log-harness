/**
 * Path arithmetic the tree and the preview share. Both separators are
 * accepted because the paths come from whichever filesystem world the
 * session's tools run in, and the browser never learns which one that is.
 */

/** Directory name the sci workspace keeps append-only; the tree tags it read-only. */
const VERSIONS_DIRECTORY = 'versions'

/** The one extension the Univer state route accepts, routed to the office frame. */
const UNIVER_EXTENSION = '.univer'

/** Office formats the Viewer cannot open directly; `univer_import` converts them. */
const CONVERTIBLE_OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(['.xlsx', '.docx', '.pptx'])

/** Split positions of both path separators. */
const SEPARATORS = /[/\\]/

/**
 * Trailing segment of a path, the part that names the file at a glance.
 * @param path - separator-joined path.
 * @returns the final non-empty segment, or the whole string when there is none.
 */
export function fileName(path: string): string {
  const segments = path.split(SEPARATORS).filter(segment => segment.length > 0)
  return segments.length === 0 ? path : segments[segments.length - 1] as string
}

/**
 * Lowercased extension of a path, dot included.
 * @param path - separator-joined path.
 * @returns the extension, or '' when the final segment carries none.
 */
export function extensionOf(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * Whether a path is a `.univer` unit the office frame renders. Routing on the
 * extension keeps the SQLite container off the read RPC entirely: the frame
 * streams it from the Gateway instead. ONLY `.univer` qualifies — the state
 * route refuses every other extension, so sending a `.docx` here dead-ends in
 * a runtime-unavailable notice (the production defect this split fixed).
 * @param path - separator-joined path.
 * @returns true for `.univer`.
 */
export function isOfficePath(path: string): boolean {
  return extensionOf(path) === UNIVER_EXTENSION
}

/**
 * Whether a path is an office format the Viewer cannot open until
 * `univer_import` converts it into a `.univer` unit. These read as ordinary
 * bytes (download still works) with a conversion hint instead of a frame.
 * @param path - separator-joined path.
 * @returns true for `.xlsx`, `.docx`, and `.pptx`.
 */
export function isConvertibleOfficePath(path: string): boolean {
  return CONVERTIBLE_OFFICE_EXTENSIONS.has(extensionOf(path))
}

/**
 * Whether a directory row is an append-only `versions/` archive. Any depth
 * qualifies: the sci workspace mints one under every paper and sciplot slug,
 * and the tag says the same thing at each of them.
 * @param entryName - the row's base name.
 * @returns true for the archive directory name.
 */
export function isVersionsDirectory(entryName: string): boolean {
  return entryName === VERSIONS_DIRECTORY
}

/**
 * Whether a listing row is hidden by the POSIX dot convention. The tree hides
 * these outright, matching the workspace directory picker's default.
 * @param entryName - the row's base name.
 * @returns true for a dot-prefixed name.
 */
export function isHiddenName(entryName: string): boolean {
  return entryName.startsWith('.')
}

/**
 * Directories that must be open for a path to be visible in a tree rooted at
 * `root`, from the root inward. A path outside the root, or the root itself,
 * has no ancestry to open and yields nothing.
 *
 * `root` is a session project directory, never the filesystem root: a root
 * that is itself just a separator shares that separator with the remainder
 * and reads as containing nothing.
 * @param path - the file or directory the tree must reveal.
 * @param root - the tree's root directory.
 * @returns the root and each intermediate directory, outermost first.
 */
export function ancestorsOf(path: string, root: string): readonly string[] {
  const normalizedRoot = stripTrailingSeparators(root)
  const relative = relativeTo(path, normalizedRoot)
  if (relative === undefined) return []
  const segments = relative.split(SEPARATORS).filter(segment => segment.length > 0)
  const ancestors = [normalizedRoot]
  // The final segment is the target itself, never one of its ancestors.
  for (let index = 0; index + 1 < segments.length; index += 1) {
    ancestors.push(`${ancestors[index] as string}/${segments[index] as string}`)
  }
  return ancestors
}

/** The part of `path` below `root`, or undefined when `path` is not under it. */
function relativeTo(path: string, root: string): string | undefined {
  if (!path.startsWith(root)) return undefined
  // Longer than the separator alone: a remainder that is only a separator is
  // the root spelled with a trailing one, which contains nothing.
  const rest = path.slice(root.length)
  return rest.length > 1 && SEPARATORS.test(rest.charAt(0)) ? rest : undefined
}

/** Drop trailing separators so a root spelled with one joins the same way. */
function stripTrailingSeparators(root: string): string {
  let end = root.length
  while (end > 1 && SEPARATORS.test(root.charAt(end - 1))) end -= 1
  return root.slice(0, end)
}
