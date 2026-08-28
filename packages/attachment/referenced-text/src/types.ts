/** Referenced-text vocabulary. @module @deepseek-ai/dsh-referenced-text/types */

/**
 * Durable, serializable reference to one immutable UTF-8 text object.
 *
 * The session log stores this reference instead of the text, and
 * `ReferencedTextRegistry.read` verifies `sha256` against the bytes a store
 * returns, so a logged reference names exactly one text forever.
 */
export interface ReferencedTextRef {
  /** Registered store name that owns the text. */
  readonly store: string
  /** Store-local identifier; opaque to the registry. */
  readonly id: string
  /** Lowercase hex SHA-256 of the UTF-8 encoding of the exact text. */
  readonly sha256: string
}

/** Content block that carries a text reference until model-request resolution replaces it with a `text` block. */
export interface ReferencedTextBlock extends ReferencedTextRef {
  type: 'referenced-text'
}

/** One named source of referenced text, contributed through `ReferencedTextRegistry.registerStore`. */
export interface ReferencedTextStore {
  /**
   * Return the exact UTF-8 text the reference names; the registry verifies sha256.
   * @param ref - the reference to read, including this store's own name.
   * @param signal - optional cancellation for the read.
   * @returns the stored text, or a rejection carrying `ReferencedTextError` code `NOT_FOUND` when the id is unknown.
   */
  readonly read: (ref: ReferencedTextRef, signal?: AbortSignal) => Promise<string>
}

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    /** A content-addressed text reference resolved into a `text` block at model-request time. */
    'referenced-text': ReferencedTextBlock
  }
}
