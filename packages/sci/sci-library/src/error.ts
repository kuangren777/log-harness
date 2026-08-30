/**
 * The one error type this package throws, and the codes that route it.
 *
 * The codes are what the upload route turns into a status and what the browser
 * view turns into a message, so each one names a decision the caller can act on
 * — the file was too big, the type is not accepted, the URL did not answer a
 * PDF — and never the transport detail behind it. A refused download reads as
 * "the link did not answer a PDF", because the address the harness could not
 * reach is not something a user needs.
 * @module @deepseek-ai/dsh-sci-library/src/error
 */

/** Stable machine-routable failure classes of the knowledge base. */
export type LibraryErrorCode =
  /** The request named a field the library refuses: a blank title, an unknown kind. */
  | 'LIBRARY_INVALID_REQUEST'
  /** The upload or download exceeded `maxFileBytes`. */
  | 'LIBRARY_TOO_LARGE'
  /** The file name's extension is not on the allowlist. */
  | 'LIBRARY_UNSUPPORTED_TYPE'
  /** The multipart body was malformed, empty, or carried more than one file. */
  | 'LIBRARY_INVALID_UPLOAD'
  /** The named entry or file is not in the library. */
  | 'LIBRARY_NOT_FOUND'
  /** The URL is not `https:`, or its host is local or on a private network. */
  | 'LIBRARY_BLOCKED_URL'
  /** The download followed its redirect budget without reaching a document. */
  | 'LIBRARY_TOO_MANY_REDIRECTS'
  /** The URL answered, but with something that is not a PDF. */
  | 'LIBRARY_NOT_PDF'
  /** The URL did not answer, or answered a non-success status. */
  | 'LIBRARY_FETCH_FAILED'

/** A knowledge-base failure carrying the code its caller routes on. */
export class LibraryError extends Error {
  /** Stable machine-routable failure class. */
  readonly code: LibraryErrorCode

  /**
   * @param message - human-readable detail; carries no credential and no internal host.
   * @param code - the failure class the caller routes on.
   * @param options - standard error options, carrying the cause when there is one.
   */
  constructor(message: string, code: LibraryErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LibraryError'
    this.code = code
  }
}

/**
 * The code one thrown value carries, for a caller that must answer every failure.
 * @param error - the thrown value.
 * @returns the library code, or `LIBRARY_FETCH_FAILED` for anything else.
 */
export function libraryErrorCode(error: unknown): LibraryErrorCode {
  return error instanceof LibraryError ? error.code : 'LIBRARY_FETCH_FAILED'
}
