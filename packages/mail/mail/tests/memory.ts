import { MailService, type MailMessage } from '../src/index.ts'

/** In-memory mail provider for seam tests: every accepted message stays in {@link outbox}. */
export class MemoryMailProvider extends MailService {
  /** Messages this provider accepted, in acceptance order. */
  readonly outbox: MailMessage[] = []

  override send(message: MailMessage): Promise<void> {
    this.outbox.push(message)
    return Promise.resolve()
  }
}
