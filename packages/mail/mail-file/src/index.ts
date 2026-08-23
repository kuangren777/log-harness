/**
 * File-backed mail provider: every delivered message becomes one JSON line
 * appended to a configured mailbox file. The line format is the package's
 * contract — tests, keyless snapshots, and browser journeys read the mailbox
 * back to recover what was sent — so {@link MailFileRecord} changes only with
 * its consumers.
 *
 * @module @deepseek-ai/dsh-mail-file
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { MailService, type MailMessage } from '@deepseek-ai/dsh-mail'

/**
 * Mailbox permissions. A delivered message can carry a sign-in link or a
 * one-time code, so the file is owner-only from the moment it exists; this is
 * a security invariant, not a deployment choice.
 */
const MAILBOX_MODE = 0o600

/** Plugin config: where the mailbox file lives. */
export interface Config {
  /** Mailbox path; a relative path resolves against the process working directory, and missing parent directories are created. */
  path: string
}

/**
 * One mailbox line, written as compact JSON followed by `\n`. Fields are
 * exactly the delivered message plus the acceptance timestamp: `html` is
 * present only when the message carried one, and no other key is ever emitted.
 */
export interface MailFileRecord {
  /** ISO-8601 UTC instant at which the provider accepted the message. */
  ts: string
  /** Recipient address, verbatim from {@link MailMessage.to}. */
  to: string
  /** Subject line, verbatim from {@link MailMessage.subject}. */
  subject: string
  /** Plain-text body, verbatim from {@link MailMessage.text}. */
  text: string
  /** HTML body, present only when the message carried one. */
  html?: string
}

/**
 * Mail provider that appends each message to a local JSON-lines mailbox.
 *
 * One append-mode file handle serves every send and closes with the owning
 * fiber. Sends are serialized through one queue, so mailbox order is the
 * order in which the provider accepted the messages even when a consumer
 * sends concurrently, and disposal waits for the in-flight write before
 * closing the handle.
 */
export class FileMailProvider extends MailService {
  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  private readonly path: string
  private handle: FileHandle | undefined
  /** Tail of the write chain; never rejects, so disposal can await it. */
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  /**
   * Create the provider and bind the mailbox handle to the owning fiber.
   * @param ctx - Cordis context that owns the provider.
   * @param config - mailbox location.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.path = resolve(config.path)
    ctx.effect(() => () => this.closeMailbox(), 'mailFile.closeMailbox()')
  }

  /**
   * Append one message to the mailbox.
   * @param message - the message to record.
   * @returns a promise resolving once the line reached the file.
   */
  override send(message: MailMessage): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error(`mail-file: the mailbox ${this.path} is closed; its plugin fiber was disposed`))
    }
    const write = this.queue.then(() => this.append(record(message)))
    this.queue = write.catch(() => undefined)
    return write
  }

  /** Write one record as a single line, opening the mailbox on first use. */
  private async append(entry: MailFileRecord): Promise<void> {
    this.handle ??= await this.openMailbox()
    await this.handle.write(`${JSON.stringify(entry)}\n`)
  }

  /** Create the parent directory and open the mailbox owner-only in append mode. */
  private async openMailbox(): Promise<FileHandle> {
    await mkdir(dirname(this.path), { recursive: true })
    const handle = await open(this.path, 'a', MAILBOX_MODE)
    // The create mode applies only to a file this open created, and a mailbox
    // left behind by an earlier run may be group- or world-readable.
    await handle.chmod(MAILBOX_MODE)
    return handle
  }

  /**
   * Close the mailbox after every already-accepted write settles: disposal
   * reaches quiescence rather than requesting it, so a send issued before
   * teardown still reaches the file while a send issued after it is refused. A
   * second call finds nothing left to close.
   */
  private async closeMailbox(): Promise<void> {
    this.closed = true
    await this.queue
    const handle = this.handle
    this.handle = undefined
    await handle?.close()
  }
}

/** Project one message into its mailbox line, omitting `html` when the message had none. */
function record(message: MailMessage): MailFileRecord {
  return {
    ts: new Date().toISOString(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...message.html === undefined ? {} : { html: message.html },
  }
}

export default FileMailProvider
