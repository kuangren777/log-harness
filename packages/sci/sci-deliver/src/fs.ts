/**
 * The `ctx.fs` adapter every other module in this package is written against.
 *
 * Keeping the seam behind a small path-shaped interface is what lets the
 * validation chain, the snapshot copy, and the spool round all be pure
 * functions with injected filesystem access, and it confines the two facts this
 * package must work around — `FileSystem` resolves targets rather than paths,
 * and it offers no binary write, no copy, and no removal.
 * @module @deepseek-ai/dsh-sci-deliver/src/fs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SnapshotFileSystem } from './snapshot.ts'
import type { SpoolFileSystem } from './spool.ts'

/** Everything this package asks of the sandbox filesystem. */
export interface DeliveryFileSystem extends SnapshotFileSystem, SpoolFileSystem {
  /**
   * Resolve a requester-supplied path to its canonical sandbox path.
   * @param path - the path as the model or the `sci` command wrote it.
   * @param cwd - the session working directory relative paths resolve against.
   * @returns the canonical absolute path in the filesystem's execution world.
   */
  readonly resolve: (path: string, cwd?: string) => Promise<string>
  /**
   * Whether anything exists at this path.
   * @param path - a canonical sandbox path.
   * @returns whether the path resolves to an existing entry.
   */
  readonly exists: (path: string) => Promise<boolean>
  /**
   * Whether this path is a regular file.
   * @param path - a canonical sandbox path.
   * @returns whether the entry is a regular file.
   */
  readonly isFile: (path: string) => Promise<boolean>
  /**
   * List the files under a directory as paths relative to it, so a canvas
   * node's `src` can be checked without the validator touching the filesystem.
   * @param path - absolute path of the directory; an absent directory lists empty.
   * @param depth - how many directory levels to descend, counting the listed directory as one.
   * @returns every relative file path found, slash-separated.
   */
  readonly listAssets: (path: string, depth: number) => Promise<ReadonlySet<string>>
}

/**
 * Collect the files below one directory as relative paths.
 * @param fs - the mounted filesystem.
 * @param path - absolute path of the directory to walk.
 * @param depth - remaining directory levels, including this one.
 * @param into - accumulator the walk adds to.
 */
async function collectAssets(fs: FileSystem, path: string, depth: number, into: Set<string>): Promise<void> {
  const target = await fs.resolve(path)
  const info = await fs.stat(target)
  if (info?.type !== 'directory') return
  for (const entry of await fs.listDir(target)) {
    if (entry.type !== 'directory') {
      into.add(entry.name)
      continue
    }
    if (depth <= 1) continue
    const nested = new Set<string>()
    await collectAssets(fs, `${path}/${entry.name}`, depth - 1, nested)
    for (const relativePath of nested) into.add(`${entry.name}/${relativePath}`)
  }
}

/**
 * Adapt the mounted `ctx.fs` to this package's path-shaped interface.
 * @param ctx - the plugin context carrying the filesystem service.
 * @returns the adapter every other module in this package consumes.
 */
export function createDeliveryFileSystem(ctx: Context): DeliveryFileSystem {
  const fs: FileSystem = ctx.fs
  return {
    resolve: async (path, cwd) => fs.processPath(await fs.resolve(path, cwd === undefined ? {} : { cwd })),
    exists: async path => await fs.stat(await fs.resolve(path)) !== undefined,
    isFile: async path => (await fs.stat(await fs.resolve(path)))?.type === 'file',
    readText: async path => await fs.readText(await fs.resolve(path)),
    readBytes: async (path, maxBytes) => await fs.readBytes(await fs.resolve(path), undefined, maxBytes),
    writeText: async (path, content) => {
      await fs.writeText(await fs.resolve(path), content)
    },
    listFiles: async (path) => {
      const target = await fs.resolve(path)
      const info = await fs.stat(target)
      if (info?.type !== 'directory') return []
      return (await fs.listDir(target)).filter(entry => entry.type === 'file').map(entry => entry.name)
    },
    listAssets: async (path, depth) => {
      const found = new Set<string>()
      await collectAssets(fs, path, depth, found)
      return found
    },
  }
}
