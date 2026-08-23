/**
 * The seam's one error type. Every refusal a provider makes deliberately
 * carries a code, so a Consumer can tell a duplicate address from a rate limit
 * without matching on message text.
 * @module @deepseek-ai/dsh-auth/error
 */

/**
 * Why an auth operation refused.
 *
 * `unauthenticated` is deliberately absent: a failed credential check is a
 * value (`LoginOutcome`, or `undefined` from `authenticateToken`), not an
 * error, because it is an expected outcome of a working system and must not be
 * distinguishable from any other failed attempt.
 */
export type AuthErrorCode =
  /** The e-mail address is already registered. */
  | 'duplicate-email'
  /** A group already has that name. */
  | 'duplicate-group-name'
  /** No account, group, or token row exists for the given id. */
  | 'unknown-subject'
  /** The operation is refused on a builtin group. */
  | 'builtin-group'
  /** A fixed security limit refused the attempt; `retryAfterMs` says for how long. */
  | 'rate-limited'
  /** The database was written by an incompatible build. */
  | 'schema-version'
  /** Configuration this provider cannot run under. */
  | 'invalid-config'

/** A refusal from an auth provider, carrying a machine-readable {@link AuthErrorCode}. */
export class AuthError extends Error {
  /**
   * @param code - why the operation refused.
   * @param message - operator-facing detail; never contains a password, code, or token.
   * @param retryAfterMs - for `rate-limited`, how long until the attempt is worth repeating.
   */
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
