/**
 * The filesystem half of the scan: which files the pool is built from.
 *
 * Everything here goes through the same `ctx.fs` seam the model's own `read`
 * tool uses, so the workspace gate's decisions apply unchanged and this layer
 * gains no path the model does not already have. The walk is bounded in three
 * independent ways — a depth limit, a skip list, and a per-file byte cap —
 * because the tree it walks is a user's project directory and nothing in it is
 * under this package's control.
 *
 * `versions/` is skipped along with `node_modules` and `.git`: it is the
 * harness-managed append-only archive of a paper bundle, so counting citations
 * in it would report every past draft's uses on top of the current one.
 * @module @deepseek-ai/dsh-sci-citations/src/fs-scan
 */

import { Buffer } from 'node:buffer'
import type { FsDirEntry, FsInfo, FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { SCAN_EXTENSIONS, SCAN_MAX_DEPTH, SCAN_SKIP_DIRS } from './config.ts'
import type { ScannedFile } from './types.ts'

/**
 * The filesystem capabilities this package uses.
 *
 * Named structurally rather than imported as the `FileSystem` class so a test
 * can stand up a five-method fake, and so the package never depends on which
 * backend a deployment mounted.
 */
export interface CitationFileSystem {
  /**
   * Resolve a path into a stable target.
   * @param path - the absolute path to resolve.
   * @param opts - optional working directory and cancellation.
   * @returns the stable target.
   */
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  /**
   * Metadata of one target.
   * @param target - the resolved target.
   * @param signal - aborts the probe.
   * @returns the metadata, or `undefined` when the target is absent.
   */
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  /**
   * Direct children of a directory, in stable name order.
   * @param target - the resolved directory target.
   * @param signal - aborts the listing.
   * @returns one entry per direct child.
   */
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  /**
   * Full decoded content of one text file.
   * @param target - the resolved target.
   * @param signal - aborts the read.
   * @returns the decoded content.
   */
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  /**
   * Create or replace one text file.
   * @param target - the resolved target.
   * @param content - the full new content.
   * @returns the write outcome.
   */
  writeText(target: FsTarget, content: string): Promise<FsWriteOutcome>
}

/** The bounds one recursive scan runs under. */
export interface ScanLimits {
  /** Largest file the scan reads, in UTF-8 bytes. */
  maxBytes: number
  /** How many directory levels below the root are visited. */
  maxDepth?: number
  /** Extensions the scan reads, lowercase and dot-prefixed. */
  extensions?: readonly string[]
  /** Directory names never descended into. */
  skipDirs?: readonly string[]
}

/**
 * Join path segments the way the POSIX sandbox spells them.
 * @param segments - the segments, none of which may be absolute after the first.
 * @returns the joined path with no duplicated separators.
 */
export function joinPath(...segments: readonly string[]): string {
  const [head = '', ...rest] = segments
  const tail = rest.map(segment => segment.replace(/^\/+|\/+$/g, '')).filter(segment => segment !== '')
  const base = head.replace(/\/+$/, '')
  return tail.length === 0 ? base : `${base}/${tail.join('/')}`
}

/**
 * Whether a file name is one the scan reads.
 * @param name - the base name.
 * @param extensions - the accepted extensions, lowercase and dot-prefixed.
 * @returns whether the name ends in one of them.
 */
export function hasScannedExtension(name: string, extensions: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return extensions.some(extension => lower.endsWith(extension))
}

/**
 * Metadata of one path, without failing when it is absent.
 * @param fs - the filesystem seam.
 * @param path - the absolute path to probe.
 * @param signal - aborts the probe.
 * @returns the metadata, or `undefined` when nothing is there.
 */
export async function statPath(
  fs: CitationFileSystem,
  path: string,
  signal?: AbortSignal,
): Promise<FsInfo | undefined> {
  return fs.stat(await fs.resolve(path, { ...signal === undefined ? {} : { signal } }), signal)
}

/**
 * Direct children of a directory that may not exist.
 * @param fs - the filesystem seam.
 * @param path - the absolute directory path.
 * @param signal - aborts the listing.
 * @returns the entries, or an empty list when the path is absent or not a directory.
 */
export async function listDirEntries(
  fs: CitationFileSystem,
  path: string,
  signal?: AbortSignal,
): Promise<FsDirEntry[]> {
  const target = await fs.resolve(path, { ...signal === undefined ? {} : { signal } })
  const info = await fs.stat(target, signal)
  if (info === undefined || info.type !== 'directory') return []
  return fs.listDir(target, signal)
}

/**
 * Read one text file that may not exist.
 * @param fs - the filesystem seam.
 * @param path - the absolute file path.
 * @param signal - aborts the read.
 * @returns the content, or `undefined` when the path is absent or not a regular file.
 */
export async function readTextIfPresent(
  fs: CitationFileSystem,
  path: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const target = await fs.resolve(path, { ...signal === undefined ? {} : { signal } })
  const info = await fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') return undefined
  return fs.readText(target, signal)
}

/**
 * Create or replace one text file.
 * @param fs - the filesystem seam.
 * @param path - the absolute file path.
 * @param content - the full new content.
 * @returns nothing once the write is durable.
 */
export async function writeTextFile(fs: CitationFileSystem, path: string, content: string): Promise<void> {
  await fs.writeText(await fs.resolve(path), content)
}

/**
 * Read every scannable text file under one root.
 *
 * A file whose reported size exceeds the cap is skipped without being read; a
 * file the backend reports no size for is read and then dropped if its decoded
 * content turns out to be larger. A read that fails is NOT swallowed: `.md`
 * and `.tex` under a project are the profile's own outputs, and a scan that
 * silently omitted one would report a citation as unused.
 * @param fs - the filesystem seam.
 * @param root - the absolute directory to walk; absence yields an empty list.
 * @param limits - the byte cap and the optional depth, extension, and skip overrides.
 * @param signal - aborts the walk between operations.
 * @returns one entry per file read, in directory-listing order.
 */
export async function scanTextFiles(
  fs: CitationFileSystem,
  root: string,
  limits: ScanLimits,
  signal?: AbortSignal,
): Promise<ScannedFile[]> {
  const maxDepth = limits.maxDepth ?? SCAN_MAX_DEPTH
  const extensions = limits.extensions ?? SCAN_EXTENSIONS
  const skipDirs = limits.skipDirs ?? SCAN_SKIP_DIRS
  const files: ScannedFile[] = []

  /**
   * Walk one directory level.
   * @param path - absolute path of the directory being listed.
   * @param depth - how many levels below the root its children sit.
   * @returns nothing once the level and everything under it is read.
   */
  const walk = async (path: string, depth: number): Promise<void> => {
    for (const entry of await listDirEntries(fs, path, signal)) {
      const childPath = joinPath(path, entry.name)
      if (entry.type === 'directory') {
        if (depth >= maxDepth || skipDirs.includes(entry.name)) continue
        await walk(childPath, depth + 1)
        continue
      }
      if (entry.type !== 'file' || !hasScannedExtension(entry.name, extensions)) continue
      if (entry.size !== undefined && entry.size > limits.maxBytes) continue
      const text = await fs.readText(entry.target, signal)
      if (entry.size === undefined && Buffer.byteLength(text, 'utf8') > limits.maxBytes) continue
      files.push({ path: childPath, text })
    }
  }

  await walk(root, 1)
  return files
}
