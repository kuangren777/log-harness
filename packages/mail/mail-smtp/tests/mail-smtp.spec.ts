import { describe, expect, it } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { MailMessage } from '@deepseek-ai/dsh-mail'
import SmtpMailProvider, {
  createSmtpTransport,
  resolveSpec,
  type Config,
  type MailTransportFactory,
} from '../src/index.ts'
import { MemoryCredentials, recordingTransports, type RecordedTransport } from './doubles.ts'

const PASSWORD = 'correct-horse-battery-staple'

const ANONYMOUS: Config = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  from: 'Harness <no-reply@example.com>',
}

const CONFIG: Config = {
  ...ANONYMOUS,
  userRef: 'DSH_SMTP_USER',
  passwordRef: 'DSH_SMTP_PASSWORD',
}

const MESSAGE: MailMessage = {
  to: 'recipient@example.com',
  subject: 'Your sign-in code',
  text: 'Your code is 314159.',
}

interface Mounted {
  ctx: Context
  fiber: Fiber
  provider: SmtpMailProvider
  credentials: MemoryCredentials
  opened: RecordedTransport[]
}

/** Mount the credentials double and the provider on their own fibers. */
async function mount(config: Config = CONFIG, seed: Record<string, string> = {
  DSH_SMTP_USER: 'mailer@example.com',
  DSH_SMTP_PASSWORD: PASSWORD,
}): Promise<Mounted> {
  const ctx = new Context()
  let credentials: MemoryCredentials | undefined
  await ctx.plugin((child: Context) => {
    credentials = new MemoryCredentials(child, seed)
  })
  const { factory, opened } = recordingTransports()
  let provider: SmtpMailProvider | undefined
  const fiber = await ctx.plugin((child: Context) => {
    provider = new SmtpMailProvider(child, config, factory)
  })
  if (credentials === undefined || provider === undefined) throw new Error('the test doubles did not mount')
  return { ctx, fiber, provider, credentials, opened }
}

describe('resolveSpec', () => {
  it('brands both credential references', () => {
    expect(resolveSpec(CONFIG)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'Harness <no-reply@example.com>',
      userRef: 'DSH_SMTP_USER',
      passwordRef: 'DSH_SMTP_PASSWORD',
    })
  })

  it('accepts an unauthenticated relay with neither reference', () => {
    expect(resolveSpec(ANONYMOUS)).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'Harness <no-reply@example.com>',
    })
  })

  it('rejects a half-configured login at load', () => {
    expect(() => resolveSpec({ ...ANONYMOUS, userRef: 'DSH_SMTP_USER' }))
      .toThrow(/userRef and passwordRef must be configured together/)
    expect(() => resolveSpec({ ...ANONYMOUS, passwordRef: 'DSH_SMTP_PASSWORD' }))
      .toThrow(/userRef and passwordRef must be configured together/)
  })

  it('rejects a reference outside the credential grammar at load', () => {
    expect(() => resolveSpec({ ...CONFIG, passwordRef: 'not a ref' })).toThrow(TypeError)
  })
})

describe('the SMTP mail provider', () => {
  it('mounts as ctx.mail and sends the resolved message over one authenticated transport', async () => {
    const { ctx, opened } = await mount()

    await ctx.mail.send({ ...MESSAGE, html: '<p>Your code is 314159.</p>' })

    expect(opened).toHaveLength(1)
    expect(opened[0]?.options).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer@example.com', pass: PASSWORD },
    })
    expect(opened[0]?.sent).toEqual([{
      from: 'Harness <no-reply@example.com>',
      to: 'recipient@example.com',
      subject: 'Your sign-in code',
      text: 'Your code is 314159.',
      html: '<p>Your code is 314159.</p>',
    }])
  })

  it('omits auth entirely for an unauthenticated relay', async () => {
    const { ctx, opened } = await mount(ANONYMOUS, {})

    await ctx.mail.send(MESSAGE)

    expect(opened[0]?.options).toEqual({ host: 'smtp.example.com', port: 587, secure: false })
    expect(opened[0]?.sent[0]?.html).toBeUndefined()
  })

  it('reuses the unauthenticated transport across sends', async () => {
    const { ctx, opened } = await mount(ANONYMOUS, {})

    await ctx.mail.send(MESSAGE)
    await ctx.mail.send(MESSAGE)

    expect(opened).toHaveLength(1)
  })

  it('reuses one transport while the resolved login is unchanged', async () => {
    const { ctx, opened } = await mount()

    await ctx.mail.send(MESSAGE)
    await ctx.mail.send({ ...MESSAGE, subject: 'second' })

    expect(opened).toHaveLength(1)
    expect(opened[0]?.sent.map(message => message.subject)).toEqual(['Your sign-in code', 'second'])
  })

  it('retires the transport when the credential rotates between sends', async () => {
    const { ctx, credentials, opened } = await mount()

    await ctx.mail.send(MESSAGE)
    credentials.rotate('DSH_SMTP_PASSWORD', 'rotated-secret')
    await ctx.mail.send(MESSAGE)

    expect(opened).toHaveLength(2)
    expect(opened[0]?.closeCount()).toBe(1)
    expect(opened[1]?.options.auth).toEqual({ user: 'mailer@example.com', pass: 'rotated-secret' })
  })

  it('fails loud naming an unresolvable reference', async () => {
    const { ctx, opened } = await mount(CONFIG, { DSH_SMTP_USER: 'mailer@example.com' })

    await expect(ctx.mail.send(MESSAGE)).rejects
      .toThrow('mail-smtp: credential reference "DSH_SMTP_PASSWORD" is not configured; store it through the credentials service')
    expect(opened).toHaveLength(0)
  })

  it('fails loud naming the reference when no credentials service is mounted', async () => {
    const ctx = new Context()
    const { factory, opened } = recordingTransports()
    await ctx.plugin((child: Context) => {
      new SmtpMailProvider(child, CONFIG, factory)
    })

    await expect(ctx.mail.send(MESSAGE)).rejects
      .toThrow('mail-smtp: credential reference "DSH_SMTP_USER" cannot be resolved because no credentials service is mounted')
    expect(opened).toHaveLength(0)
  })

  it('never writes a resolved secret to the logger', async () => {
    const { ctx } = await mount()
    const logged: string[] = []
    ctx.logger.exporter({
      // Everything down to debug, so the transport diagnostic is captured too.
      levels: { default: 3 },
      export(message) {
        logged.push(message.args.map(arg => String(arg)).join(' '))
      },
    })

    await ctx.mail.send(MESSAGE)

    const text = logged.join('\n')
    expect(text).toContain('DSH_SMTP_USER')
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain('mailer@example.com')
  })

  it('closes the live transport with its fiber and refuses later sends, twice over', async () => {
    const { ctx, fiber, provider, opened } = await mount()
    await provider.send(MESSAGE)

    await fiber.dispose()
    await fiber.dispose()

    expect(ctx.get('mail')).toBeUndefined()
    expect(opened[0]?.closeCount()).toBe(1)
    await expect(provider.send(MESSAGE)).rejects.toThrow(/transport to smtp.example.com is closed/)
  })

  it('closes cleanly when no transport was ever opened', async () => {
    const { fiber, opened } = await mount()

    await fiber.dispose()

    expect(opened).toHaveLength(0)
  })
})

describe('createSmtpTransport', () => {
  it('opens a real nodemailer transport without connecting', () => {
    const factory: MailTransportFactory = createSmtpTransport
    const transport = factory({ host: '127.0.0.1', port: 2525, secure: false })

    expect(typeof transport.sendMail).toBe('function')
    transport.close()
  })
})
