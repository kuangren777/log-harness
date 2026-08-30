/**
 * The `/library-api` prefix route: the browser's only way to put bytes into the
 * sandbox, and the only way to read a stored file back at full size.
 *
 * Both halves exist because the surfaces beside them cannot do this. The
 * workspace API over `/api` is read-only, the attachment store takes images
 * only and keeps them on host disk where no sandbox tool can reach them, and
 * `workspace.readFile` caps a read at 8 MiB — under which a 30 MB dataset
 * uploads fine and then cannot be fetched back.
 *
 * The browser-trust fence runs before anything touches the body: this route
 * writes files into the user's sandbox, so it carries the same DNS-rebinding
 * and cross-site defence the RPC channel applies to `/api` rather than trusting
 * whatever reached the socket.
 * @module @deepseek-ai/dsh-sci-library/src/upload-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { LibraryError, libraryErrorCode } from './error.ts'
import type { LibraryErrorCode } from './error.ts'
import { LIBRARY_KINDS } from './entries.ts'
import { readSingleFileUpload } from './multipart.ts'
import type { LibraryEntry, LibraryFile, LibraryKind, UploadedFile } from './types.ts'

/** Prefix the whole knowledge-base HTTP surface is registered under. */
export const LIBRARY_ROUTE_PREFIX = '/library-api'

/** Path one file is uploaded to. */
export const UPLOAD_PATH = `${LIBRARY_ROUTE_PREFIX}/upload`

/** Path one stored file is read back from. */
export const FILE_PATH = `${LIBRARY_ROUTE_PREFIX}/file`

/** The `entryId` value that asks for a new entry rather than naming one. */
export const NEW_ENTRY = 'new'

/** Body an untrusted request is answered with, carrying no detail about the fence. */
export const FORBIDDEN_BODY = { ok: false, code: 'FORBIDDEN', message: 'request origin is not trusted' }

/** Whether one request passes the deployment's browser-trust fence. */
export type RequestTrustCheck = (headers: IncomingMessage['headers']) => boolean

/** What the route needs from the library runtime; nothing else of it is reachable here. */
export interface LibraryRouteHost {
  /** Inclusive byte cap on one uploaded or downloaded file. */
  readonly maxFileBytes: number
  /**
   * Store one uploaded file, creating the entry when the caller asked for a new one.
   * @param entryId - the entry to attach to, or {@link NEW_ENTRY}.
   * @param kind - the kind a new entry takes; ignored when the entry exists.
   * @param file - the parsed upload.
   * @returns the entry carrying the stored file.
   */
  upload: (entryId: string, kind: LibraryKind | undefined, file: UploadedFile) => Promise<LibraryEntry>
  /**
   * Read one stored file back.
   * @param entryId - the owning entry.
   * @param name - the stored file name.
   * @returns the file record and its bytes.
   */
  download: (entryId: string, name: string) => Promise<{ file: LibraryFile; bytes: Uint8Array }>
}

/**
 * The HTTP status one failure answers with.
 * @param code - the library failure class.
 * @returns the status the browser sees.
 */
export function statusForCode(code: LibraryErrorCode): number {
  switch (code) {
    case 'LIBRARY_TOO_LARGE': return 413
    case 'LIBRARY_UNSUPPORTED_TYPE': return 415
    case 'LIBRARY_NOT_FOUND': return 404
    case 'LIBRARY_INVALID_REQUEST':
    case 'LIBRARY_INVALID_UPLOAD': return 400
    default: return 502
  }
}

/**
 * Send a JSON response with no browser cache.
 * @param response - the open server response.
 * @param status - HTTP status to write.
 * @param value - body to serialize.
 */
export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

/**
 * Read the `kind` query parameter.
 * @param raw - the parameter as the URL carried it, or null when absent.
 * @returns the kind, or undefined when the caller named none.
 * @throws LibraryError `LIBRARY_INVALID_REQUEST` for a value that is not a kind.
 */
export function parseKind(raw: string | null): LibraryKind | undefined {
  if (raw === null || raw === '') return undefined
  const kind = LIBRARY_KINDS.find(candidate => candidate === raw)
  if (kind === undefined) {
    throw new LibraryError(`kind must be one of ${LIBRARY_KINDS.join(', ')}, got ${JSON.stringify(raw)}`, 'LIBRARY_INVALID_REQUEST')
  }
  return kind
}

/**
 * Read one required query parameter.
 * @param raw - the parameter as the URL carried it.
 * @param name - the parameter's name, for the message.
 * @returns the non-empty value.
 * @throws LibraryError `LIBRARY_INVALID_REQUEST` when it is absent or empty.
 */
export function requireParam(raw: string | null, name: string): string {
  if (raw === null || raw === '') {
    throw new LibraryError(`${name} is required`, 'LIBRARY_INVALID_REQUEST')
  }
  return raw
}

/**
 * Serve one stored file as a download.
 * @param response - the open server response.
 * @param file - the stored-file record.
 * @param bytes - the file's content.
 */
function sendFile(response: ServerResponse, file: LibraryFile, bytes: Uint8Array): void {
  response.writeHead(200, {
    'content-type': file.mediaType,
    'content-length': String(bytes.byteLength),
    'content-disposition': `inline; filename="${file.name}"`,
    'cache-control': 'no-store',
  })
  response.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

/**
 * Create the `/library-api` HTTP dispatcher.
 * @param host - the library runtime the two routes call.
 * @param isTrusted - the deployment's browser-trust fence.
 * @returns the request handler the host webserver registers.
 */
export function createLibraryRouter(
  host: LibraryRouteHost,
  isTrusted: RequestTrustCheck,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!isTrusted(request.headers)) {
      sendJson(response, 403, FORBIDDEN_BODY)
      return
    }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'POST' && url.pathname === UPLOAD_PATH) {
        const entryId = requireParam(url.searchParams.get('entryId'), 'entryId')
        const kind = parseKind(url.searchParams.get('kind'))
        const file = await readSingleFileUpload(request, request.headers['content-type'], host.maxFileBytes)
        sendJson(response, 200, { ok: true, entry: await host.upload(entryId, kind, file) })
        return
      }
      if (request.method === 'GET' && url.pathname === FILE_PATH) {
        const entryId = requireParam(url.searchParams.get('entryId'), 'entryId')
        const name = requireParam(url.searchParams.get('name'), 'name')
        const found = await host.download(entryId, name)
        sendFile(response, found.file, found.bytes)
        return
      }
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, code: 'LIBRARY_NOT_FOUND', message: 'no such library route' }))
    } catch (error: unknown) {
      const code = libraryErrorCode(error)
      const status = error instanceof LibraryError ? statusForCode(code) : 500
      sendJson(response, status, {
        ok: false,
        code: error instanceof LibraryError ? code : 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
