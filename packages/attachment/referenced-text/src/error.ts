/** Referenced-text failure class. @module @deepseek-ai/dsh-referenced-text/error */

/**
 * Stable referenced-text failure codes used for protocol error routing.
 *
 * `STORE_MISSING` and `DIGEST_MISMATCH` are raised by the registry;
 * `NOT_FOUND` is raised by a store whose content no longer holds the id.
 */
export type ReferencedTextErrorCode = 'STORE_MISSING' | 'DIGEST_MISMATCH' | 'NOT_FOUND'

/**
 * Stable failures suitable for host RPC error mapping.
 *
 * Deliberately re-implements the `HarnessError` fields instead of extending
 * it: the base lives in `@deepseek-ai/dsh-llm`, whose `ContentBlockMap` this
 * package augments, so importing the runtime class would tie a types-only
 * dependency to that package's runtime. Consumers route on `code`, never on
 * the prototype chain.
 */
export class ReferencedTextError extends Error {
  /** Stable machine-routing failure code. */
  readonly code: ReferencedTextErrorCode

  /**
   * @param message - human-readable failure description without stored text or host paths.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: ReferencedTextErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReferencedTextError'
    this.code = code
  }
}
