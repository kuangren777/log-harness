/**
 * Content-addressed referenced-text seam (`ctx.referencedText`).
 *
 * A `referenced-text` content block names text by store, id, and SHA-256
 * instead of carrying it, so the session log stays small while every model
 * request remains reconstructable from the log. Request assembly calls
 * {@link ReferencedTextRegistry.resolveMessages} immediately before
 * serialization, which replaces each reference with the verified text.
 *
 * @module @deepseek-ai/dsh-referenced-text
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { ReferencedTextError } from './error.ts'
import type { ReferencedTextRef, ReferencedTextStore } from './types.ts'

export { ReferencedTextError } from './error.ts'
export type { ReferencedTextErrorCode } from './error.ts'
export type { ReferencedTextBlock, ReferencedTextRef, ReferencedTextStore } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    referencedText: ReferencedTextRegistry
  }
}

/** Cache key covering every field that decides which text a reference names. */
function cacheKey(ref: ReferencedTextRef): string {
  return JSON.stringify([ref.store, ref.id, ref.sha256])
}

/** Whether any block in this content, including tool-result content, is a text reference. */
function hasReference(blocks: readonly ContentBlock[]): boolean {
  return blocks.some(block => block.type === 'referenced-text'
    || (block.type === 'tool-result' && hasReference(block.content)))
}

/**
 * Registry of named referenced-text stores plus the model-request resolution
 * that turns `referenced-text` blocks into `text` blocks.
 *
 * The registry owns digest verification for every store: a store returns
 * bytes, and this service decides whether those bytes are the ones the logged
 * reference named.
 */
export class ReferencedTextRegistry extends Service {
  private readonly stores = new Map<string, ReferencedTextStore>()

  constructor(ctx: Context) {
    super(ctx, 'referencedText')
  }

  /**
   * Register one borrowed same-process store under a unique name. Disposing
   * the calling fiber, or calling the returned disposer, removes it.
   * @param name - store name that logged references address; a duplicate throws.
   * @param store - the borrowed store implementation.
   * @returns the disposer that unregisters this store.
   */
  registerStore(name: string, store: ReferencedTextStore): () => void {
    if (this.stores.has(name)) {
      throw new Error(`a referenced-text store named "${name}" is already registered`)
    }
    const dispose = this.ctx.effect(() => {
      this.stores.set(name, store)
      return () => {
        this.stores.delete(name)
      }
    }, 'referencedText.registerStore()')
    return () => void dispose()
  }

  /**
   * Read one reference and verify the returned text against its recorded digest.
   * @param ref - the logged reference to resolve.
   * @param signal - optional cancellation passed to the owning store.
   * @returns the exact stored text.
   * @throws {ReferencedTextError} `STORE_MISSING` when no store owns `ref.store`,
   *   `DIGEST_MISMATCH` when the returned text hashes to another digest, or the
   *   store's own failure, such as `NOT_FOUND`.
   */
  async read(ref: ReferencedTextRef, signal?: AbortSignal): Promise<string> {
    const store = this.stores.get(ref.store)
    if (store === undefined) {
      throw new ReferencedTextError(
        `no referenced-text store named "${ref.store}" is registered`,
        'STORE_MISSING',
      )
    }
    const text = await store.read(ref, signal)
    const digest = createHash('sha256').update(text, 'utf8').digest('hex')
    if (digest !== ref.sha256) {
      throw new ReferencedTextError(
        `referenced text "${ref.id}" in store "${ref.store}" hashes to ${digest}, not the referenced ${ref.sha256}`,
        'DIGEST_MISMATCH',
      )
    }
    return text
  }

  /**
   * Replace every `referenced-text` block, including blocks nested in
   * tool-result content, with the verified `text` block it names. Input
   * messages are never mutated: only messages that carry a reference are
   * rebuilt, and each distinct reference is read once per call.
   * @param messages - the assembled request messages, possibly deep-frozen.
   * @param signal - optional cancellation passed to each owning store.
   * @returns resolved messages, or the exact input array when it holds no reference.
   * @throws the first failure {@link ReferencedTextRegistry.read} raises; no partial result is returned.
   */
  async resolveMessages(messages: readonly Message[], signal?: AbortSignal): Promise<readonly Message[]> {
    if (!messages.some(message => hasReference(message.content))) return messages
    const resolved = new Map<string, string>()
    const output: Message[] = []
    for (const message of messages) {
      if (!hasReference(message.content)) {
        output.push(message)
        continue
      }
      output.push({ ...message, content: await this.resolveContent(message.content, resolved, signal) })
    }
    return output
  }

  /** Resolve one block list, reusing text already read for the same reference in this call. */
  private async resolveContent(
    blocks: readonly ContentBlock[],
    resolved: Map<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<ContentBlock[]> {
    const output: ContentBlock[] = []
    for (const block of blocks) {
      switch (block.type) {
        case 'referenced-text': {
          const key = cacheKey(block)
          let text = resolved.get(key)
          if (text === undefined) {
            text = await this.read(block, signal)
            resolved.set(key, text)
          }
          output.push({ type: 'text', text })
          break
        }
        case 'tool-result':
          output.push(hasReference(block.content)
            ? { ...block, content: await this.resolveContent(block.content, resolved, signal) }
            : block)
          break
        // Merge-extensible union: a block this package does not own reaches the
        // adapter exactly as the log recorded it.
        default:
          output.push(block)
      }
    }
    return output
  }
}

export default ReferencedTextRegistry
