/**
 * The delivery-area predicate: which sandbox paths may reach the user at all.
 *
 * The studied platform enforced this as one hardcoded check ("`sandboxPath`
 * must be inside the delivery workspace") plus prose in three skill bodies for
 * the manifest exceptions. Here the whole rule is one pure function over a
 * configured layout, so the tool path and the shell spool cannot drift apart
 * and a deployment that renames the delivery directory renames it once.
 *
 * Both separators are accepted, matching `isManifestPath` in
 * `@deepseek-ai/dsh-sci-manifest`: the sandbox is Linux, but these functions
 * also run on a host filesystem in tests, and treating a backslash as a
 * separator costs only the ability to deliver a Linux file whose NAME contains
 * one.
 * @module @deepseek-ai/dsh-sci-deliver/src/paths
 */

import { isManifestPath } from '@deepseek-ai/dsh-sci-manifest'
import type { DeliveryKind } from './types.ts'

/** Directory names of the two bundle trees inside one project. */
export interface BundleDirs {
  /** Directory holding `<slug>/<slug>.paper` manuscript bundles. */
  readonly papers: string
  /** Directory holding `<slug>/<slug>.sciplot` figure bundles. */
  readonly sciplots: string
}

/** The project layout the delivery predicate is evaluated against. */
export interface DeliveryPathConfig {
  /** Absolute sandbox path holding one directory per project. */
  readonly projectRoot: string
  /** Directory name of the delivery area inside one project. */
  readonly deliveryDir: string
  /** Directory names of the two bundle trees inside one project. */
  readonly bundleDirs: BundleDirs
}

/** Depth of a bundle manifest below its bundle directory: `<slug>/<name>.<ext>`. */
const MANIFEST_DEPTH = 2

/** Either path separator, so a host path in a test behaves like a sandbox path. */
const SEPARATOR = /[\\/]/

/**
 * Split a path into its meaningful segments, resolving `.` and `..`
 * textually. A `..` that would escape the accumulated prefix is dropped, so the
 * result never starts above the path it came from and a traversal can only ever
 * land the caller OUTSIDE a configured root, never inside one it did not name.
 * @param path - an absolute or relative path, with either separator.
 * @returns the resolved segments, without empty or `.` members.
 */
export function normalizeSegments(path: string): string[] {
  const segments: string[] = []
  for (const segment of path.split(SEPARATOR)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments
}

/**
 * The last segment of a path — the file's own name.
 * @param path - an absolute or relative path, with either separator.
 * @returns the trailing segment, or the whole path when it has no separator.
 */
export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The directory a path sits in, without a trailing separator.
 * @param path - an absolute path, with either separator.
 * @returns the leading part of the path, or the empty string when it has no separator.
 */
export function directoryName(path: string): string {
  return path.slice(0, Math.max(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))))
}

/**
 * Take the part of `segments` below `root`.
 * @param root - the root's normalized segments.
 * @param segments - the candidate path's normalized segments.
 * @returns the segments below the root, or `undefined` when the candidate is not under it.
 */
function below(root: readonly string[], segments: readonly string[]): string[] | undefined {
  if (segments.length <= root.length) return undefined
  if (root.some((segment, index) => segments[index] !== segment)) return undefined
  return segments.slice(root.length)
}

/**
 * Classify a path as a deliverable, without touching the filesystem.
 *
 * Exactly two shapes are deliverable: anything inside a project's delivery
 * directory, and a `.paper` or `.sciplot` manifest sitting directly in its own
 * bundle directory (`<papers>/<slug>/<name>.paper`). A `.canvas` board is NOT a
 * third exception — it is authored in the delivery directory already, so it is
 * deliverable through the first rule and carries its manifest kind from there.
 * @param path - the path to classify, absolute in the sandbox or relative to it.
 * @param config - the project layout to evaluate against.
 * @returns the delivery kind, or `undefined` when the path may not be delivered.
 */
export function isDeliverablePath(path: string, config: DeliveryPathConfig): DeliveryKind | undefined {
  const segments = below(normalizeSegments(config.projectRoot), normalizeSegments(path))
  // `[projectId, area, ...inner]` with at least one inner segment: an area
  // directory itself is not a file and cannot be delivered.
  if (segments === undefined || segments.length < 3) return undefined
  const area = segments[1]
  const inner = segments.length - 2
  const manifest = isManifestPath(path)
  if (area === config.deliveryDir) return manifest ?? 'file'
  if (area === config.bundleDirs.papers && inner === MANIFEST_DEPTH && manifest === 'paper') return 'paper'
  if (area === config.bundleDirs.sciplots && inner === MANIFEST_DEPTH && manifest === 'sciplot') return 'sciplot'
  return undefined
}
