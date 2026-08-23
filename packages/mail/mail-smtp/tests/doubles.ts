import type { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { MailTransport, MailTransportFactory, SmtpSendMailOptions, SmtpTransportOptions } from '../src/index.ts'

/**
 * In-memory credentials provider for the SMTP suite: one always-writable
 * `memory` source whose values a test rotates between sends.
 */
export class MemoryCredentials extends CredentialProvider {
  private readonly store = new Map<string, string>()

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    for (const [key, value] of Object.entries(seed)) this.store.set(key, value)
  }

  /** Replace one stored value the way a rotation outside the harness would. */
  rotate(ref: string, value: string): void {
    this.store.set(ref, value)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = this.store.has(ref)
    return Promise.resolve({ configured, ...configured ? { source: 'memory' } : {}, writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.store.set(ref, value)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    this.store.delete(ref)
    return Promise.resolve()
  }

  override readRecord(): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override deleteRecord(): Promise<void> {
    return Promise.resolve()
  }
}

/** One transport the factory double opened, with everything it was asked to do. */
export interface RecordedTransport extends MailTransport {
  /** Connection parameters this transport was created with. */
  readonly options: SmtpTransportOptions
  /** Messages handed to this transport, in order. */
  readonly sent: SmtpSendMailOptions[]
  /** How often `close()` was called on it. */
  readonly closeCount: () => number
}

/** A transport factory that records every transport it opens instead of reaching SMTP. */
export function recordingTransports(): { factory: MailTransportFactory; opened: RecordedTransport[] } {
  const opened: RecordedTransport[] = []
  const factory: MailTransportFactory = (options) => {
    const sent: SmtpSendMailOptions[] = []
    let closes = 0
    const transport: RecordedTransport = {
      options,
      sent,
      closeCount: () => closes,
      sendMail(message) {
        sent.push(message)
        return Promise.resolve({ accepted: [message.to] })
      },
      close() {
        closes += 1
      },
    }
    opened.push(transport)
    return transport
  }
  return { factory, opened }
}
