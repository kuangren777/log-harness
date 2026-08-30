/**
 * The `multipart/form-data` reader behind `POST /library-api/upload`.
 *
 * It reads exactly the shape that route accepts and nothing else: one file
 * part, its `filename`, its bytes. Everything a general multipart parser also
 * has to handle — several files, nested multiparts, `content-transfer-encoding`
 * other than binary, a part with no boundary terminator — is a refusal here
 * rather than a feature, because the route has one caller (a `FormData` with
 * one `File` in it) and every additional accepted shape is another way for a
 * browser to put bytes somewhere the entry does not describe.
 *
 * The cap is enforced while reading, so a body that will not fit is refused
 * before it is buffered rather than after. The whole file is then held in
 * memory: `writeBytes` takes a complete `Uint8Array`, so there is no streaming
 * write to hand the chunks to.
 * @module @deepseek-ai/dsh-sci-library/src/multipart
 */

import { LibraryError } from './error.ts'
import { mediaTypeOf, sanitizeFileName } from './files.ts'
import type { UploadedFile } from './types.ts'

/** Headroom over `maxFileBytes` the body may spend on boundaries and part headers. */
export const MULTIPART_OVERHEAD_BYTES = 8 * 1024

/** One parsed part: its raw header block and its content. */
export interface MultipartPart {
  /** The part's header block, verbatim, without the terminating blank line. */
  headers: string
  /** The part's content bytes. */
  content: Buffer
}

/**
 * The boundary one `Content-Type` declares.
 * @param contentType - the request's `Content-Type`, or undefined when it carried none.
 * @returns the boundary token, without the leading dashes.
 * @throws LibraryError `LIBRARY_INVALID_UPLOAD` when the type is not multipart or declares no boundary.
 */
export function boundaryOf(contentType: string | undefined): string {
  const value = contentType ?? ''
  if (!/^multipart\/form-data\s*(;|$)/i.test(value.trim())) {
    throw new LibraryError('the upload must be sent as multipart/form-data', 'LIBRARY_INVALID_UPLOAD')
  }
  const match = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(value)
  const boundary = match?.[1] ?? match?.[2]
  if (boundary === undefined || boundary === '') {
    throw new LibraryError('the upload declared no multipart boundary', 'LIBRARY_INVALID_UPLOAD')
  }
  return boundary
}

/**
 * Buffer one request body under a hard cap.
 * @param stream - the request's chunk iterable.
 * @param maxBytes - inclusive cap on the whole body, boundaries included.
 * @returns the complete body.
 * @throws LibraryError `LIBRARY_TOO_LARGE` as soon as the cap is passed, before the rest arrives.
 */
export async function readCappedBody(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    total += buffer.length
    if (total > maxBytes) {
      throw new LibraryError(`the upload exceeds the ${maxBytes} byte limit`, 'LIBRARY_TOO_LARGE')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

/**
 * Split one buffered body into its parts.
 * @param body - the complete request body.
 * @param boundary - the boundary token the `Content-Type` declared.
 * @returns the parts, in body order; a body with no complete part yields none.
 */
export function splitParts(body: Buffer, boundary: string): MultipartPart[] {
  const delimiter = Buffer.from(`--${boundary}`)
  const offsets: number[] = []
  for (let at = body.indexOf(delimiter); at !== -1; at = body.indexOf(delimiter, at + delimiter.length)) {
    offsets.push(at)
  }
  const parts: MultipartPart[] = []
  for (let index = 0; index + 1 < offsets.length; index += 1) {
    const start = (offsets[index] as number) + delimiter.length
    const end = offsets[index + 1] as number
    if (body.subarray(start, start + 2).toString('latin1') === '--') break
    const segment = body.subarray(start, end)
    const headerEnd = segment.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const content = segment.subarray(headerEnd + 4)
    parts.push({
      headers: segment.subarray(0, headerEnd).toString('utf8').trim(),
      content: content.subarray(0, Math.max(content.length - 2, 0)),
    })
  }
  return parts
}

/**
 * The `filename` one part's `Content-Disposition` claims.
 * @param headers - the part's header block.
 * @returns the claimed name, or undefined when the part carries no file.
 */
export function filenameOf(headers: string): string | undefined {
  const line = headers.split(/\r?\n/).find(header => /^content-disposition\s*:/i.test(header)) ?? ''
  const encoded = /;\s*filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(line)
  if (encoded !== null) return decodeURIComponent((encoded[1] as string).trim())
  const plain = /;\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(line)
  const name = plain?.[1] ?? plain?.[2]
  return name === undefined ? undefined : name.trim()
}

/**
 * Read the one file a `/library-api/upload` request carries.
 * @param stream - the request's chunk iterable.
 * @param contentType - the request's `Content-Type`.
 * @param maxBytes - inclusive cap on the file's own bytes.
 * @returns the sanitized name, the allowlisted media type, and the bytes.
 * @throws LibraryError `LIBRARY_TOO_LARGE` past the cap, `LIBRARY_UNSUPPORTED_TYPE`
 *   for an extension that is not allowlisted, `LIBRARY_INVALID_UPLOAD` for a body
 *   carrying no file part, more than one, or an empty one.
 */
export async function readSingleFileUpload(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  contentType: string | undefined,
  maxBytes: number,
): Promise<UploadedFile> {
  const boundary = boundaryOf(contentType)
  const body = await readCappedBody(stream, maxBytes + MULTIPART_OVERHEAD_BYTES)
  const files = splitParts(body, boundary)
    .map(part => ({ part, filename: filenameOf(part.headers) }))
    .filter((candidate): candidate is { part: MultipartPart; filename: string } => candidate.filename !== undefined)
  if (files.length === 0) throw new LibraryError('the upload carried no file', 'LIBRARY_INVALID_UPLOAD')
  if (files.length > 1) throw new LibraryError('the upload must carry exactly one file', 'LIBRARY_INVALID_UPLOAD')
  const only = files[0] as { part: MultipartPart; filename: string }
  if (only.part.content.length === 0) throw new LibraryError('the uploaded file is empty', 'LIBRARY_INVALID_UPLOAD')
  if (only.part.content.length > maxBytes) {
    throw new LibraryError(`the upload exceeds the ${maxBytes} byte limit`, 'LIBRARY_TOO_LARGE')
  }
  const name = sanitizeFileName(only.filename)
  return {
    name,
    mediaType: mediaTypeOf(name),
    bytes: new Uint8Array(only.part.content.buffer, only.part.content.byteOffset, only.part.content.byteLength),
  }
}
