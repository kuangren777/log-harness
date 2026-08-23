/**
 * Vocabulary of the mail seam: the one outbound message record every provider
 * accepts. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-mail/types
 */

/**
 * One outbound message, addressed and already rendered. Templating, locale
 * selection, and recipient lookup belong to the consumer that composes the
 * message; a provider receives finished content and delivers it.
 */
export interface MailMessage {
  /** Recipient address, in the form the configured provider's transport accepts. */
  readonly to: string
  /** Subject line, sent verbatim. */
  readonly subject: string
  /** Plain-text body, always present so a recipient without HTML still reads the message. */
  readonly text: string
  /** HTML body offered as the richer alternative to {@link text}; absent leaves the message text-only. */
  readonly html?: string
}
