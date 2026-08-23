/**
 * SMTP mail provider over nodemailer. Composition files carry the endpoint and
 * the *names* of the credentials — never their values — and the provider
 * resolves those references through `ctx.credentials` on every send, so a
 * rotated password reaches the next message without restarting the harness.
 *
 * @module @deepseek-ai/dsh-mail-smtp
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createTransport } from 'nodemailer'
import { credentialRef, type CredentialProvider, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MailService, type MailMessage } from '@deepseek-ai/dsh-mail'

/** Plugin config: the SMTP endpoint, the sender identity, and the credential references that authenticate it. */
export interface Config {
  /** SMTP server hostname. */
  host: string
  /** SMTP server port. */
  port: number
  /** Whether the connection starts in TLS (implicit TLS, normally port 465) rather than upgrading with STARTTLS. */
  secure: boolean
  /** `From` address every message is sent as. */
  from: string
  /**
   * Name of the credential reference holding the SMTP username; omitted
   * together with {@link passwordRef} for a relay that accepts unauthenticated
   * mail.
   */
  userRef?: string
  /** Name of the credential reference holding the SMTP password. */
  passwordRef?: string
}

/** Connection parameters one nodemailer transport is created with. */
export interface SmtpTransportOptions {
  /** SMTP server hostname. */
  host: string
  /** SMTP server port. */
  port: number
  /** Whether the connection starts in TLS. */
  secure: boolean
  /** Resolved SMTP credentials; absent sends unauthenticated. */
  auth?: SmtpAuth
}

/** One resolved SMTP login. Values live in memory for the lifetime of the transport they opened and are never logged. */
export interface SmtpAuth {
  /** Resolved SMTP username. */
  user: string
  /** Resolved SMTP password. */
  pass: string
}

/** The message fields this provider hands to a transport. */
export interface SmtpSendMailOptions {
  /** Sender identity taken from {@link Config.from}. */
  from: string
  /** Recipient address. */
  to: string
  /** Subject line. */
  subject: string
  /** Plain-text body. */
  text: string
  /** HTML body, present only when the message carried one. */
  html?: string
}

/**
 * The transport surface this provider uses. Narrower than nodemailer's
 * `Transporter` so a suite can supply a double without a live SMTP server, and
 * so the provider states exactly which two operations it depends on.
 */
export interface MailTransport {
  /**
   * Deliver one message over this connection.
   * @param message - the addressed message fields.
   * @returns a promise settling once the server accepted or rejected the message.
   */
  sendMail(message: SmtpSendMailOptions): Promise<unknown>
  /** Release the connection pool; calling it twice on one transport is nodemailer's own no-op. */
  close(): void
}

/** Opens one {@link MailTransport} for a set of connection parameters. */
export type MailTransportFactory = (options: SmtpTransportOptions) => MailTransport

/** Fully resolved provider parameters; defaulting and reference branding happen here, never inside `send`. */
export interface SmtpSpec {
  /** SMTP server hostname. */
  host: string
  /** SMTP server port. */
  port: number
  /** Whether the connection starts in TLS. */
  secure: boolean
  /** `From` address every message is sent as. */
  from: string
  /** Branded reference to the SMTP username, absent for an unauthenticated relay. */
  userRef?: CredentialRef
  /** Branded reference to the SMTP password, absent for an unauthenticated relay. */
  passwordRef?: CredentialRef
}

/**
 * Open a real nodemailer SMTP transport. Creating it opens no socket:
 * nodemailer connects on the first `sendMail`.
 * @param options - connection parameters.
 * @returns the live transport.
 */
export const createSmtpTransport: MailTransportFactory = options => createTransport(options)

/**
 * Resolve plugin config into the provider's runtime parameters, branding both
 * credential references. A reference outside the credential grammar, or a
 * half-configured login, fails here — at load, where the composition file that
 * carries the mistake is still the thing being read.
 * @param config - raw plugin config.
 * @returns the resolved endpoint, sender, and branded references.
 * @throws Error when exactly one of `userRef` and `passwordRef` is configured.
 */
export function resolveSpec(config: Config): SmtpSpec {
  const { userRef, passwordRef } = config
  if ((userRef === undefined) !== (passwordRef === undefined)) {
    throw new Error('mail-smtp: userRef and passwordRef must be configured together; SMTP AUTH needs both halves')
  }
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    ...userRef === undefined ? {} : { userRef: credentialRef(userRef) },
    ...passwordRef === undefined ? {} : { passwordRef: credentialRef(passwordRef) },
  }
}

/** The transport currently open, with the login it was created for. */
interface LiveTransport {
  auth: SmtpAuth | undefined
  transport: MailTransport
}

/**
 * SMTP mail provider.
 *
 * One transport — and therefore one connection pool — serves every send whose
 * resolved login is unchanged. Because resolution happens per send, a rotated
 * credential produces a different login, which retires the open transport and
 * opens the next one; disposal closes whichever transport is live, and a
 * second disposal finds none.
 */
export class SmtpMailProvider extends MailService {
  static Config: z<Config> = z.object({
    host: z.string().required(),
    port: z.natural().max(65535).required(),
    secure: z.boolean().required(),
    from: z.string().required(),
    userRef: z.string(),
    passwordRef: z.string(),
  })

  private readonly spec: SmtpSpec
  private readonly createTransport: MailTransportFactory
  private live: LiveTransport | undefined
  private closed = false

  /**
   * Create the provider and bind its transport to the owning fiber.
   * @param ctx - Cordis context that owns the provider.
   * @param config - endpoint, sender, and credential references.
   * @param createTransport - transport factory; a suite passes a double instead of opening SMTP connections.
   */
  constructor(ctx: Context, config: Config, createTransport: MailTransportFactory = createSmtpTransport) {
    super(ctx)
    this.spec = resolveSpec(config)
    this.createTransport = createTransport
    ctx.effect(() => () => { this.closeTransport() }, 'mailSmtp.closeTransport()')
  }

  /**
   * Deliver one message over SMTP, resolving the configured credential
   * references first.
   * @param message - the message to deliver.
   * @returns a promise resolving once the server accepted the message.
   */
  override async send(message: MailMessage): Promise<void> {
    if (this.closed) {
      throw new Error(`mail-smtp: the transport to ${this.spec.host} is closed; its plugin fiber was disposed`)
    }
    const auth = await this.resolveAuth()
    const transport = this.useTransport(auth)
    await transport.sendMail({
      from: this.spec.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...message.html === undefined ? {} : { html: message.html },
    })
  }

  /** Resolve both references, or `undefined` when this relay takes unauthenticated mail. */
  private async resolveAuth(): Promise<SmtpAuth | undefined> {
    const { userRef, passwordRef } = this.spec
    if (userRef === undefined || passwordRef === undefined) return undefined
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new Error(
        `mail-smtp: credential reference "${userRef}" cannot be resolved because no credentials service is mounted`,
      )
    }
    return {
      user: await resolveRef(credentials, userRef),
      pass: await resolveRef(credentials, passwordRef),
    }
  }

  /** Reuse the open transport while its login still matches, otherwise retire it and open the next one. */
  private useTransport(auth: SmtpAuth | undefined): MailTransport {
    const live = this.live
    if (live !== undefined) {
      if (sameAuth(live.auth, auth)) return live.transport
      live.transport.close()
    }
    const transport = this.createTransport({
      host: this.spec.host,
      port: this.spec.port,
      secure: this.spec.secure,
      ...auth === undefined ? {} : { auth },
    })
    this.ctx.logger.debug(
      'mail-smtp: opened a transport to %s:%d as %s',
      this.spec.host,
      this.spec.port,
      this.spec.userRef ?? 'an unauthenticated sender',
    )
    this.live = { auth, transport }
    return transport
  }

  /** Close the live transport, if any; a second call has nothing left to close. */
  private closeTransport(): void {
    this.closed = true
    const live = this.live
    this.live = undefined
    live?.transport.close()
  }
}

/**
 * Resolve one reference or fail loud naming it. The reference name is safe to
 * report; the value it stands for never appears in a message or a log.
 */
async function resolveRef(credentials: CredentialProvider, ref: CredentialRef): Promise<string> {
  const hit = await credentials.resolve(ref)
  if (hit === undefined) {
    throw new Error(`mail-smtp: credential reference "${ref}" is not configured; store it through the credentials service`)
  }
  return hit.value
}

/** Whether two resolved logins authorize the same connection. */
function sameAuth(current: SmtpAuth | undefined, next: SmtpAuth | undefined): boolean {
  if (current === undefined || next === undefined) return current === next
  return current.user === next.user && current.pass === next.pass
}

export default SmtpMailProvider
