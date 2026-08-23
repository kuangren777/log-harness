import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SmtpMailProvider from '../src/index.ts'
import * as MailSmtpInvariant from '../src/invariant.ts'
import { MemoryCredentials, recordingTransports } from './doubles.ts'

describe('mail-smtp invariant companion', () => {
  it('reserves the package name and leaves the mounted provider working', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MailSmtpInvariant)
    await ctx.plugin(MemoryCredentials, { DSH_SMTP_USER: 'mailer@example.com', DSH_SMTP_PASSWORD: 'secret' })
    const { factory, opened } = recordingTransports()
    await ctx.plugin((child: Context) => {
      new SmtpMailProvider(child, {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'no-reply@example.com',
        userRef: 'DSH_SMTP_USER',
        passwordRef: 'DSH_SMTP_PASSWORD',
      }, factory)
    })

    await expect(ctx.mail.send({ to: 'a@example.com', subject: 's', text: 't' })).resolves.toBeUndefined()
    expect(opened).toHaveLength(1)
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-mail-smtp', () => {})
    }).toThrow(/already registered/)
  })
})
