/**
 * Service Definition for the outbound mail capability seam (`ctx.mail`). A consumer composes a
 * finished {@link MailMessage} and hands it over; the mounted provider owns the
 * transport, the sender identity, and every credential the delivery needs, so
 * composition files never carry an SMTP endpoint or a secret to send one
 * message.
 *
 * @module @deepseek-ai/dsh-mail
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { MailMessage } from './types.ts'

export type { MailMessage } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mail: MailService
  }
}

/**
 * Abstract outbound mail service: one delivery operation over one configured
 * sender.
 *
 * The seam owns no address grammar. `to` reaches the provider as the caller
 * typed it, and the transport behind the provider — an SMTP server's `RCPT
 * TO`, a file the tests read back — is the boundary that accepts or rejects
 * it. A same-process caller already satisfies {@link MailMessage} by type, and
 * a second address parser here would only disagree with the transport that
 * decides.
 *
 * The sender identity is provider configuration, never part of a message: one
 * mounted provider sends as one `from`, so a consumer cannot spoof another
 * sender by composing a different record.
 */
export abstract class MailService extends Service {
  /**
   * Register the mail service on the owning context.
   * @param ctx - Cordis context that owns the provider.
   */
  constructor(ctx: Context) {
    super(ctx, 'mail')
  }

  /**
   * Deliver one message. The returned promise settles after the provider
   * accepted the message for delivery — an SMTP server acknowledged it, a file
   * write reached the mailbox — which is the strongest fact a sender can
   * report; nothing downstream of that handoff is observable here.
   * @param message - the finished message to deliver.
   * @returns a promise resolving once the provider accepted the message, rejecting when delivery failed.
   */
  abstract send(message: MailMessage): Promise<void>
}

export default MailService
