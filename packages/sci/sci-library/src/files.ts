/**
 * Where an entry's bytes live, what may be stored there, and the narrow
 * filesystem seam the rest of the package writes them through.
 *
 * Two rules hold every path here together. A file name never becomes a path:
 * the browser chooses it, so it is reduced to one safe basename before it can
 * name a directory. And an entry id never becomes a path either: ids look like
 * `doi:10.1103/physrevb.91.205201`, and a slash in one would scatter an entry's
 * files across two directories no listing walks.
 * @module @deepseek-ai/dsh-sci-library/src/files
 */

import { createHash } from 'node:crypto'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { LibraryError } from './error.ts'
import type { LibraryFile } from './types.ts'

/**
 * Everything the knowledge base asks of `ctx.fs`.
 *
 * Declared structurally rather than imported as `FileSystem` because the binary
 * write this package needs — `writeBytes` — is a seam addition landing beside
 * it; a structural shape lets the library compile against the method's contract
 * without waiting for the abstract class to carry it.
 */
export interface LibraryFs {
  /**
   * Resolve a path into a stable target.
   * @param path - the absolute sandbox path.
   * @param opts - optional cwd override and cancellation.
   * @returns the stable target.
   */
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  /**
   * Read target metadata.
   * @param target - the resolved target.
   * @param signal - aborts the round-trip.
   * @returns the metadata, or undefined when nothing is there.
   */
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  /**
   * Read the whole file as raw bytes.
   * @param target - the resolved target.
   * @param signal - aborts the read.
   * @param maxBytes - inclusive byte cap on the complete content.
   * @returns the file's bytes.
   */
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  /**
   * Atomically create or replace a file's raw bytes, creating parent directories.
   * @param target - the resolved target.
   * @param data - the full new file content.
   * @param signal - aborts before atomic publication takes effect.
   */
  writeBytes(target: FsTarget, data: Uint8Array, signal: AbortSignal | undefined): Promise<void>
}

/** Every extension the upload route accepts, and the media type it serves back. */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  parquet: 'application/vnd.apache.parquet',
  txt: 'text/plain',
  md: 'text/markdown',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

/** Characters a stored name or directory segment may contain. */
const UNSAFE_SEGMENT = /[^A-Za-z0-9._-]+/g

/** Longest stored file name, so one long browser name cannot exhaust a path budget. */
export const MAX_FILE_NAME_CHARS = 120

/**
 * Reduce a browser-supplied file name to one safe basename.
 *
 * Every directory separator is dropped before anything else, so `../../etc` and
 * `C:\Windows\x` both reduce to their last component rather than reaching one.
 * @param name - the name as the browser sent it.
 * @returns a bare name of allowed characters, never empty.
 * @throws LibraryError `LIBRARY_INVALID_UPLOAD` when nothing usable remains.
 */
export function sanitizeFileName(name: string): string {
  // `split` always yields at least one element, so the last component is never absent.
  const base = name.split(/[\\/]/).pop() as string
  const cleaned = base.replace(UNSAFE_SEGMENT, '-').replace(/^[.-]+/, '').slice(0, MAX_FILE_NAME_CHARS)
  if (cleaned === '' || cleaned === '.') {
    throw new LibraryError(`upload file name ${JSON.stringify(name)} has no usable characters`, 'LIBRARY_INVALID_UPLOAD')
  }
  return cleaned
}

/**
 * The lowercase extension of one stored name.
 * @param name - a sanitized file name.
 * @returns the extension without its dot, or an empty string when there is none.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The media type one stored name is served as.
 * @param name - a sanitized file name.
 * @returns the allowlisted media type.
 * @throws LibraryError `LIBRARY_UNSUPPORTED_TYPE` when the extension is not allowlisted.
 */
export function mediaTypeOf(name: string): string {
  const media = ALLOWED_EXTENSIONS[extensionOf(name)]
  if (media === undefined) {
    throw new LibraryError(
      `file type ${JSON.stringify(extensionOf(name))} is not accepted; allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`,
      'LIBRARY_UNSUPPORTED_TYPE',
    )
  }
  return media
}

/**
 * The directory name one entry's files live in.
 *
 * The id itself where it is already path-safe, so `arxiv:2607.09182` reads as
 * `arxiv-2607.09182` on disk and the model can find it from the id the tool
 * printed.
 * @param id - the entry id.
 * @returns one path-safe directory segment.
 */
export function entryDirName(id: string): string {
  const cleaned = id.replace(UNSAFE_SEGMENT, '-').replace(/^[.-]+/, '').slice(0, MAX_FILE_NAME_CHARS)
  return cleaned === '' ? createHash('sha256').update(id).digest('hex').slice(0, 32) : cleaned
}

/**
 * The library-relative path one stored file answers to.
 * @param id - the owning entry's id.
 * @param name - the sanitized file name.
 * @returns the slash-separated path relative to `Config.libraryRoot`.
 */
export function entryFilePath(id: string, name: string): string {
  return `${entryDirName(id)}/${name}`
}

/**
 * The absolute sandbox path of one stored file.
 * @param libraryRoot - the configured library root.
 * @param id - the owning entry's id.
 * @param name - the sanitized file name.
 * @returns the absolute path a skill or the `read` tool opens.
 */
export function entryFileAbsolutePath(libraryRoot: string, id: string, name: string): string {
  return `${libraryRoot.replace(/\/+$/, '')}/${entryFilePath(id, name)}`
}

/**
 * Lowercase hex SHA-256 of one file's bytes.
 * @param bytes - the file content.
 * @returns the 64-character digest.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Write one file into its entry's directory and describe what was stored.
 * @param fs - the mounted filesystem seam.
 * @param libraryRoot - the configured library root.
 * @param id - the owning entry's id.
 * @param name - the sanitized file name.
 * @param bytes - the file content.
 * @param now - epoch milliseconds of the write.
 * @param signal - aborts the write.
 * @returns the stored-file record the entry keeps.
 */
export async function writeEntryFile(
  fs: LibraryFs,
  libraryRoot: string,
  id: string,
  name: string,
  bytes: Uint8Array,
  now: number,
  signal?: AbortSignal,
): Promise<LibraryFile> {
  const mediaType = mediaTypeOf(name)
  const target = await fs.resolve(entryFileAbsolutePath(libraryRoot, id, name), { ...signal === undefined ? {} : { signal } })
  await fs.writeBytes(target, bytes, signal)
  return {
    path: entryFilePath(id, name),
    name,
    size: bytes.byteLength,
    mediaType,
    sha256: sha256Hex(bytes),
    addedAt: now,
  }
}

/**
 * Read one stored file back for the download route.
 * @param fs - the mounted filesystem seam.
 * @param libraryRoot - the configured library root.
 * @param id - the owning entry's id.
 * @param file - the stored-file record naming it.
 * @param maxBytes - inclusive byte cap on the content.
 * @param signal - aborts the read.
 * @returns the file's bytes.
 */
export async function readEntryFile(
  fs: LibraryFs,
  libraryRoot: string,
  id: string,
  file: LibraryFile,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const target = await fs.resolve(entryFileAbsolutePath(libraryRoot, id, file.name), { ...signal === undefined ? {} : { signal } })
  return fs.readBytes(target, signal, maxBytes)
}
