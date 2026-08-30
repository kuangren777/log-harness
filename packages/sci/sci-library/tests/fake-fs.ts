/** An in-memory `LibraryFs` for the suites that do not need a real filesystem. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { LibraryFs } from '../src/files.ts'

/** A `LibraryFs` backed by a `Map` of absolute path to content. */
export class FakeFs implements LibraryFs {
  /** Written content by absolute path. */
  readonly written = new Map<string, Uint8Array>()

  /**
   * @param path - the absolute sandbox path.
   * @returns a target whose key is the path itself.
   */
  resolve(path: string): Promise<FsTarget> {
    return Promise.resolve({ targetKey: FsTargetKey(path), displayPath: path })
  }

  /**
   * @param target - the resolved target.
   * @returns file metadata when something was written there.
   */
  stat(target: FsTarget): Promise<FsInfo | undefined> {
    const bytes = this.written.get(target.displayPath)
    return Promise.resolve(bytes === undefined
      ? undefined
      : { version: FsVersion('v1'), type: 'file', size: bytes.byteLength })
  }

  /**
   * @param target - the resolved target.
   * @param _signal - unused; the store answers synchronously.
   * @param maxBytes - inclusive cap; a larger file rejects like the real seam.
   * @returns the stored bytes.
   */
  readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const bytes = this.written.get(target.displayPath)
    if (bytes === undefined) return Promise.reject(new Error(`fake fs: nothing at ${target.displayPath}`))
    if (bytes.byteLength > maxBytes) return Promise.reject(new Error('FS_TOO_LARGE'))
    return Promise.resolve(bytes)
  }

  /**
   * @param target - the resolved target.
   * @param data - the bytes to store.
   */
  writeBytes(target: FsTarget, data: Uint8Array): Promise<void> {
    this.written.set(target.displayPath, data)
    return Promise.resolve()
  }
}

/**
 * The same in-memory filesystem, published on a context as `ctx.fs`.
 *
 * Not `LocalFileSystem`: the binary write this package needs is a seam addition
 * landing beside it, so a unit suite that mounted the real backend would be
 * testing that absence rather than the runtime.
 */
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
   * @param path - the absolute sandbox path.
   * @returns a target whose key is the path itself.
   */
  resolve(path: string): Promise<FsTarget> {
    return this.store.resolve(path)
  }

  /**
   * @param target - the resolved target.
   * @returns file metadata when something was written there.
   */
  stat(target: FsTarget): Promise<FsInfo | undefined> {
    return this.store.stat(target)
  }

  /**
   * @param target - the resolved target.
   * @param signal - aborts the read.
   * @param maxBytes - inclusive cap on the content.
   * @returns the stored bytes.
   */
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.store.readBytes(target, signal, maxBytes)
  }

  /**
   * @param target - the resolved target.
   * @param data - the bytes to store.
   */
  writeBytes(target: FsTarget, data: Uint8Array): Promise<void> {
    return this.store.writeBytes(target, data)
  }
}
