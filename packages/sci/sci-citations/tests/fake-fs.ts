/** An in-memory `CitationFileSystem` for the suites that do not need real files. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { FsDirEntry, FsInfo, FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { CitationFileSystem } from '../src/fs-scan.ts'

/** Fixed version token; nothing in this package reads freshness. */
const VERSION = FsVersion('v1')

/**
 * A `CitationFileSystem` backed by a `Map` of absolute path to text.
 *
 * Directories are implied by the paths of the files in them, which is what the
 * real backend reports too: a scan only ever asks what is under a path.
 */
export class FakeFs implements CitationFileSystem {
  /** File content by absolute path. */
  readonly files = new Map<string, string>()

  /** Absolute directory paths that exist while holding no file. */
  readonly dirs = new Set<string>()

  /** Whether directory listings report a size, as a real backend usually does. */
  reportSizes = true

  /** Paths whose listing rejects, standing in for a permission or race failure. */
  readonly unreadable = new Set<string>()

  /**
   * @param path - the absolute path to resolve.
   * @returns a target whose key is the path itself.
   */
  resolve(path: string): Promise<FsTarget> {
    return Promise.resolve({ targetKey: FsTargetKey(path), displayPath: path })
  }

  /**
   * @param target - the resolved target.
   * @returns metadata when a file or an implied directory is there.
   */
  stat(target: FsTarget): Promise<FsInfo | undefined> {
    const path = target.displayPath
    const text = this.files.get(path)
    if (text !== undefined) {
      return Promise.resolve({ version: VERSION, type: 'file', size: Buffer.byteLength(text, 'utf8') })
    }
    if (this.isDirectory(path)) return Promise.resolve({ version: VERSION, type: 'directory' })
    return Promise.resolve(undefined)
  }

  /**
   * @param target - the resolved directory target.
   * @returns one entry per direct child, in sorted name order.
   */
  listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const path = target.displayPath
    if (this.unreadable.has(path)) return Promise.reject(new Error(`fake fs: cannot list ${path}`))
    const prefix = `${path}/`
    const names = new Map<string, 'file' | 'directory'>()
    for (const candidate of [...this.files.keys(), ...this.dirs]) {
      if (!candidate.startsWith(prefix)) continue
      const rest = candidate.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      names.set(name, slash === -1 && this.files.has(candidate) ? 'file' : 'directory')
    }
    return Promise.resolve([...names].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, type]) => {
      const childPath = `${prefix}${name}`
      const text = this.files.get(childPath)
      return {
        name,
        type,
        target: { targetKey: FsTargetKey(childPath), displayPath: childPath },
        ...!this.reportSizes || text === undefined ? {} : { size: Buffer.byteLength(text, 'utf8') },
      }
    }))
  }

  /**
   * @param target - the resolved target.
   * @returns the stored text.
   */
  readText(target: FsTarget): Promise<string> {
    const text = this.files.get(target.displayPath)
    if (text === undefined) return Promise.reject(new Error(`fake fs: nothing at ${target.displayPath}`))
    return Promise.resolve(text)
  }

  /**
   * @param target - the resolved target.
   * @param content - the full new content.
   * @returns the write outcome the real seam reports.
   */
  writeText(target: FsTarget, content: string): Promise<FsWriteOutcome> {
    const before = this.files.get(target.displayPath) ?? null
    this.files.set(target.displayPath, content)
    return Promise.resolve({
      operation: before === null ? 'create' : 'update',
      version: VERSION,
      before,
      after: content,
    })
  }

  /**
   * Whether anything is stored under one path.
   * @param path - the absolute directory path.
   * @returns whether the path was declared or holds a file.
   */
  private isDirectory(path: string): boolean {
    if (this.dirs.has(path)) return true
    const prefix = `${path}/`
    for (const candidate of [...this.files.keys(), ...this.dirs]) {
      if (candidate.startsWith(prefix)) return true
    }
    return false
  }
}

/** The same in-memory filesystem, published on a context as `ctx.fs`. */
export class FakeFsService extends Service {
  /** The store every call reads and writes. */
  readonly store = new FakeFs()

  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  /**
   * @param path - the absolute path to resolve.
   * @returns the resolved target.
   */
  resolve(path: string): Promise<FsTarget> {
    return this.store.resolve(path)
  }

  /**
   * @param target - the resolved target.
   * @returns the metadata, or `undefined` when nothing is there.
   */
  stat(target: FsTarget): Promise<FsInfo | undefined> {
    return this.store.stat(target)
  }

  /**
   * @param target - the resolved directory target.
   * @returns one entry per direct child.
   */
  listDir(target: FsTarget): Promise<FsDirEntry[]> {
    return this.store.listDir(target)
  }

  /**
   * @param target - the resolved target.
   * @returns the stored text.
   */
  readText(target: FsTarget): Promise<string> {
    return this.store.readText(target)
  }

  /**
   * @param target - the resolved target.
   * @param content - the full new content.
   * @returns the write outcome.
   */
  writeText(target: FsTarget, content: string): Promise<FsWriteOutcome> {
    return this.store.writeText(target, content)
  }
}
