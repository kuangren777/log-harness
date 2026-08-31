/**
 * Pure path taxonomy of the science sandbox: which of the thirteen
 * {@link PathClass} regions a path falls in, plus the normalization and
 * resolution the taxonomy and the shell pre-screen share.
 *
 * Classification is textual by design. It runs before dispatch on a path the
 * filesystem seam already resolved, so it must not touch the disk, and a
 * symlink that escapes a region is caught by sandbox ownership rather than
 * here.
 * @module @deepseek-ai/dsh-sci-workspace/paths
 */

import { isManifestPath } from '@deepseek-ai/dsh-sci-manifest'
import type { PathClass } from './types.ts'

/** Every path class, in the order the workspace contract's table lists them. */
export const PATH_CLASSES: readonly PathClass[] = [
  'workspace',
  'tmp',
  'paper-src',
  'paper-manifest',
  'paper-versions',
  'sciplot-code',
  'sciplot-manifest',
  'sciplot-versions',
  'references',
  'skills',
  'spool-pending',
  'private',
  'other',
]

/** The region layout one classification reads; a subset of the plugin config. */
export interface PathLayout {
  /** Absolute directory holding one subdirectory per project. */
  readonly projectRoot: string
  /** Project-relative directory that is the only delivery area. */
  readonly deliveryDir: string
  /** Project-relative directory for intermediate products. */
  readonly scratchDir: string
  /** Project-relative directories holding the two bundle kinds. */
  readonly bundleDirs: { readonly papers: string; readonly sciplots: string }
  /** Sandbox-root-relative directory the harness synchronizes skills into. */
  readonly skillsDir: string
  /** Sandbox-root-relative directory owned by the harness user. */
  readonly privateDir: string
  /** Sandbox-root-relative directory shell deliveries are queued in. */
  readonly spoolPendingDir: string
}

/**
 * Split a path into its meaningful segments, folding `.` and `..` away.
 * Both separators are accepted so a Windows-shaped backend path classifies the
 * same as the POSIX path the sandbox uses.
 * @param path - any absolute or relative path.
 * @returns the resolved segments, without the leading root marker.
 */
export function pathSegments(path: string): string[] {
  const segments: string[] = []
  for (const raw of path.split(/[\\/]+/)) {
    if (raw === '' || raw === '.') continue
    if (raw === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop()
      else segments.push(raw)
      continue
    }
    segments.push(raw)
  }
  return segments
}

/**
 * Whether a path names a filesystem root rather than a location relative to the
 * caller's working directory.
 * @param path - any path.
 * @returns whether the path starts at a POSIX root or a Windows drive.
 */
export function isAbsolutePath(path: string): boolean {
  return /^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Normalize a path to slash-separated form with `.` and `..` folded away.
 * @param path - any absolute or relative path.
 * @returns the normalized path, keeping a leading `/` for a POSIX-absolute input.
 */
export function normalizePath(path: string): string {
  const joined = pathSegments(path).join('/')
  return /^[\\/]/.test(path) ? `/${joined}` : joined
}

/**
 * Resolve one operand against a working directory.
 * @param cwd - absolute working directory the operand is relative to.
 * @param operand - the path as it appeared on the command line.
 * @returns the normalized absolute path the operand names.
 */
export function resolveAgainst(cwd: string, operand: string): string {
  return isAbsolutePath(operand) ? normalizePath(operand) : normalizePath(`${cwd}/${operand}`)
}

/**
 * Locate a path inside a root.
 * @param rootSegments - resolved segments of the containing directory.
 * @param segments - resolved segments of the candidate path.
 * @returns the segments below the root, `[]` for the root itself, or `undefined` when the path is outside it.
 */
export function segmentsUnder(rootSegments: readonly string[], segments: readonly string[]): string[] | undefined {
  if (segments.length < rootSegments.length) return undefined
  for (const [index, segment] of rootSegments.entries()) {
    if (segments[index] !== segment) return undefined
  }
  return segments.slice(rootSegments.length)
}

/**
 * Classify the part of a project that is not a bundle directory.
 * @param tail - project-relative segments after the project id.
 * @param layout - the configured region layout.
 * @returns the class, or `undefined` when the path is not in a flat project region.
 */
function classifyFlatRegion(tail: readonly string[], layout: PathLayout): PathClass | undefined {
  if (tail[0] === layout.deliveryDir) return 'workspace'
  if (tail[0] === layout.scratchDir) return 'tmp'
  return undefined
}

/**
 * Classify a path inside `papers/<slug>/`.
 * @param head - first segment below the bundle slug directory.
 * @param depth - how many segments below the slug directory the path is.
 * @param path - the normalized path, read for its extension.
 * @returns the class of that location.
 */
function classifyPaperBundle(head: string, depth: number, path: string): PathClass {
  if (head === 'src') return 'paper-src'
  if (head === 'versions') return 'paper-versions'
  if (depth === 1 && isManifestPath(head) === 'paper') return 'paper-manifest'
  // A PDF that is neither a build product under src/ nor an archived version is
  // someone else's paper; papers/ holds only manuscripts written for the user.
  if (path.endsWith('.pdf')) return 'references'
  return 'other'
}

/**
 * Classify a path inside `sciplots/<slug>/`.
 * @param head - first segment below the bundle slug directory.
 * @param depth - how many segments below the slug directory the path is.
 * @returns the class of that location.
 */
function classifySciplotBundle(head: string, depth: number): PathClass {
  if (head === 'code') return 'sciplot-code'
  if (head === 'versions') return 'sciplot-versions'
  if (depth === 1 && isManifestPath(head) === 'sciplot') return 'sciplot-manifest'
  return 'other'
}

/**
 * Classify a path inside one project directory.
 * @param tail - project-relative segments after the project id.
 * @param layout - the configured region layout.
 * @param path - the normalized path, read for its extension.
 * @returns the class, or `undefined` when no project region matches.
 */
function classifyInProject(tail: readonly string[], layout: PathLayout, path: string): PathClass | undefined {
  const flat = classifyFlatRegion(tail, layout)
  if (flat !== undefined) return flat
  // A bundle needs its group directory, its slug, and something inside it; the
  // group directory and a bare slug directory carry no rule of their own.
  const head = tail[2]
  if (head === undefined) return undefined
  const depth = tail.length - 2
  if (tail[0] === layout.bundleDirs.papers) return classifyPaperBundle(head, depth, path)
  if (tail[0] === layout.bundleDirs.sciplots) return classifySciplotBundle(head, depth)
  return undefined
}

/**
 * Classify a path inside the sandbox home but outside every project.
 * @param rel - sandbox-root-relative segments.
 * @param layout - the configured region layout.
 * @returns the class, or `undefined` when the location carries no rule.
 */
function classifyInSandbox(rel: readonly string[], layout: PathLayout): PathClass | undefined {
  // The spool sits inside the private directory and must be tested first: it is
  // the one location under it the model may create files in.
  if (segmentsUnder(pathSegments(layout.spoolPendingDir), rel) !== undefined) return 'spool-pending'
  if (rel[0] === layout.skillsDir) return 'skills'
  if (rel[0] === layout.privateDir) return 'private'
  return undefined
}

/**
 * Classify one absolute sandbox path.
 *
 * A relative path, or a path outside both the project tree and the sandbox
 * home, is `other`: the workspace contract governs the science regions and
 * leaves the rest of the machine to the sandbox's own permissions.
 * @param path - the path the filesystem seam resolved for this call.
 * @param layout - the configured region layout.
 * @returns the class governing this location.
 */
export function classifyPath(path: string, layout: PathLayout): PathClass {
  if (!isAbsolutePath(path)) return 'other'
  const segments = pathSegments(path)
  const projectRootSegments = pathSegments(layout.projectRoot)
  const projectRel = segmentsUnder(projectRootSegments, segments)
  if (projectRel !== undefined && projectRel.length >= 2) {
    const inProject = classifyInProject(projectRel.slice(1), layout, path)
    if (inProject !== undefined) return inProject
  }
  const sandboxRel = segmentsUnder(projectRootSegments.slice(0, -1), segments)
  if (sandboxRel !== undefined) {
    const inSandbox = classifyInSandbox(sandboxRel, layout)
    if (inSandbox !== undefined) return inSandbox
  }
  return 'other'
}

/**
 * The sandbox-home regions a delegated agent may still reach outside its own
 * project: the skill tree it runs from and the harness-private state it may
 * read and spool into.
 */
const DELEGATION_SHARED_CLASSES: ReadonlySet<PathClass> = new Set<PathClass>(['skills', 'spool-pending', 'private'])

/**
 * The sandbox home: the directory holding the project root, the skill tree,
 * and the harness-private directory.
 * @param layout - the configured region layout.
 * @returns the home's segments.
 */
export function sandboxHomeSegments(layout: PathLayout): string[] {
  return pathSegments(layout.projectRoot).slice(0, -1)
}

/**
 * Whether a path lies outside the project a delegated agent was delegated into.
 *
 * The check is by location, not by class: a sibling project's `workspace/`
 * classifies as `workspace` exactly like the agent's own, so the class alone
 * cannot separate them. A path outside the sandbox home altogether (`/usr`,
 * `/tmp`) is not this rule's concern; the sandbox's own permissions govern it.
 * @param path - the resolved path.
 * @param cwd - the delegated session's working directory, which is its project.
 * @param layout - the configured region layout.
 * @returns whether the path is inside the sandbox home but outside both the
 *   agent's project and the shared regions.
 */
export function isOutsideDelegationScope(path: string, cwd: string, layout: PathLayout): boolean {
  if (!isAbsolutePath(path)) return false
  const segments = pathSegments(path)
  if (segmentsUnder(sandboxHomeSegments(layout), segments) === undefined) return false
  if (segmentsUnder(pathSegments(cwd), segments) !== undefined) return false
  return !DELEGATION_SHARED_CLASSES.has(classifyPath(path, layout))
}
