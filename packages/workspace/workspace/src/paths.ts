/**
 * Path canonicalization for workspace identity, performed in the filesystem
 * the session's tools execute in.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */

import { realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
// Named type import: `FileSystem` types the seam-backed world AND the same
// module declaration merge resolves `ctx.get('fs')` to it.
import type { FileSystem } from '@deepseek-ai/dsh-fs'

/**
 * Canonicalize a directory path via `fs.realpath`: trailing slashes, `..`
 * segments, and symlinks are all resolved. The Host half of the canon; a path
 * that does not exist rejects with the original `ENOENT`.
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
export async function realpathNormalize(path: string): Promise<string> {
  return await realpath(path)
}

/** One canonicalized existing path with the directory fact the caller decides on. */
export interface CanonicalPath {
  /** The canonical absolute path in the world that produced it. */
  readonly path: string
  /** Whether that canonical path names a directory right now. */
  readonly directory: boolean
}

/**
 * The filesystem workspace paths are canonicalized and checked in — the ONE
 * uniqueness canon of the package. Workspace paths are stored canonicalized,
 * uniqueness is string equality of canonicalized paths (a symlink to an
 * existing workspace's directory collides), and attach-time session `cwd`
 * checks go through the same canon, so every path a record is compared against
 * must come from the same world that stamped it.
 */
export interface PathWorld {
  /**
   * Canonicalize an existing path and report whether it is a directory.
   * @param path - The path to canonicalize, in any spelling.
   * @returns the canonical path and its directory fact.
   * @throws when the path does not exist in this world, or cannot be probed.
   */
  canonicalize(path: string): Promise<CanonicalPath>
}

/** The Host process filesystem: `realpath` for the canon, `stat` for the directory fact. */
const hostPathWorld: PathWorld = {
  async canonicalize(path: string): Promise<CanonicalPath> {
    const canonical = await realpathNormalize(path)
    return { path: canonical, directory: (await stat(canonical)).isDirectory() }
  },
}

/**
 * The composed filesystem backend's world. `resolve` supplies the canonical
 * identity and `processPath` its absolute path there; the seam has no
 * `realpath`, and `resolve` succeeds for a path that does not exist yet, so
 * `stat` is what decides existence — an absent target is this world's `ENOENT`.
 */
const seamPathWorld = (fs: FileSystem): PathWorld => ({
  async canonicalize(path: string): Promise<CanonicalPath> {
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (info === undefined) throw new Error(`the filesystem backend has no such path '${path}'`)
    return { path: fs.processPath(target), directory: info.type === 'directory' }
  },
})

/**
 * The world a composition's workspace paths live in: the filesystem service's
 * when one is mounted (its backend runs the tools, and a sandboxed backend's
 * paths are not Host paths), the Host process filesystem otherwise. Read per
 * call, never cached, because a composition may mount or dispose its
 * filesystem while the registry runs.
 * @param ctx - Context whose optional `fs` service names the execution world.
 * @returns the world every workspace path is canonicalized and checked in.
 */
export function pathWorld(ctx: Context): PathWorld {
  const fs = ctx.get('fs')
  return fs === undefined ? hostPathWorld : seamPathWorld(fs)
}
