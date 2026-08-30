/**
 * The delivery snapshot: the delivered bytes are copied aside at delivery time
 * so a later edit to the source file cannot change what the user already
 * received.
 *
 * The copy goes through `ctx.fs` and predates `FileSystem.writeBytes` (see
 * the README's Known Limitations for the deferred migration). A snapshot of
 * bytes that are not valid UTF-8 is therefore written base64-encoded under a
 * `.base64` suffix; the digest and size in the session event always describe
 * the ORIGINAL bytes, never the encoding.
 * @module @deepseek-ai/dsh-sci-deliver/src/snapshot
 */

import { createHash } from 'node:crypto'
import { baseName } from './paths.ts'
import type { DeliveryId } from './types.ts'

/** Suffix marking a snapshot whose content is the base64 of the delivered bytes. */
export const BASE64_SNAPSHOT_SUFFIX = '.base64'

/** Write side of one snapshot round: the sandbox filesystem, or a test double. */
export interface SnapshotFileSystem {
  /**
   * Read a whole file as raw bytes.
   * @param path - absolute path in the sandbox.
   * @param maxBytes - inclusive byte cap; a larger file fails rather than truncating.
   * @returns the complete content.
   */
  readonly readBytes: (path: string, maxBytes: number) => Promise<Uint8Array>
  /**
   * Create or replace one file, creating parent directories.
   * @param path - absolute path in the sandbox.
   * @param content - the full new content.
   */
  readonly writeText: (path: string, content: string) => Promise<void>
}

/** What one snapshot round produced. */
export interface DeliverySnapshot {
  /** Lowercase hex sha256 of the original bytes. */
  readonly sha256: string
  /** Byte length of the original bytes. */
  readonly size: number
  /** Absolute path the snapshot was written to. */
  readonly snapshotPath: string
}

/** Everything one snapshot round needs. */
export interface SnapshotRequest {
  /** Absolute path of the file being delivered. */
  readonly path: string
  /** Identity of this delivery; it names the snapshot's own directory. */
  readonly deliveryId: DeliveryId
  /** Absolute path of the directory holding one subdirectory per delivery. */
  readonly snapshotDir: string
  /** Inclusive byte cap on a deliverable file. */
  readonly maxBytes: number
}

/**
 * Choose the lossless text encoding for a snapshot's bytes.
 * @param bytes - the delivered file's raw content.
 * @returns the file-name suffix and the text to write; the suffix is empty when
 *   the bytes are valid UTF-8 and survive the round trip unchanged.
 */
export function encodeSnapshot(bytes: Uint8Array): { readonly suffix: string; readonly text: string } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = buffer.toString('utf8')
  if (Buffer.from(text, 'utf8').equals(buffer)) return { suffix: '', text }
  return { suffix: BASE64_SNAPSHOT_SUFFIX, text: buffer.toString('base64') }
}

/**
 * Copy one delivered file into its own snapshot directory and describe the
 * original bytes.
 * @param fs - the sandbox filesystem, or a test double.
 * @param request - the file, the delivery identity, the snapshot root, and the byte cap.
 * @returns the original bytes' digest and size plus the path the copy landed on.
 */
export async function snapshotDelivery(fs: SnapshotFileSystem, request: SnapshotRequest): Promise<DeliverySnapshot> {
  const bytes = await fs.readBytes(request.path, request.maxBytes)
  const encoded = encodeSnapshot(bytes)
  const snapshotPath = `${request.snapshotDir}/${request.deliveryId}/${baseName(request.path)}${encoded.suffix}`
  await fs.writeText(snapshotPath, encoded.text)
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    snapshotPath,
  }
}
