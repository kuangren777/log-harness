import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SmtpMailProvider from '../src/index.ts'
import { MemoryCredentials } from './doubles.ts'

/**
 * Real-SMTP delivery against a server the operator supplies. The suite skips
 * entirely without the four connection variables; `DSH_SMTP_TEST_TO` picks the
 * recipient and defaults to the authenticating user, whose own mailbox is the
 * safest destination for a probe message.
 */
const host = process.env.DSH_SMTP_TEST_HOST
const port = process.env.DSH_SMTP_TEST_PORT
const user = process.env.DSH_SMTP_TEST_USER
const password = process.env.DSH_SMTP_TEST_PASSWORD
const configured = [host, port, user, password].every(value => value !== undefined && value !== '')

describe.skipIf(!configured)('mail-smtp e2e (real SMTP server)', () => {
  it('delivers one message over the configured server', async () => {
    const portNumber = Number(port)
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials, {
      DSH_SMTP_TEST_USER: user as string,
      DSH_SMTP_TEST_PASSWORD: password as string,
    })
    await ctx.plugin(SmtpMailProvider, {
      host: host as string,
      port: portNumber,
      secure: portNumber === 465,
      from: process.env.DSH_SMTP_TEST_FROM ?? (user as string),
      userRef: 'DSH_SMTP_TEST_USER',
      passwordRef: 'DSH_SMTP_TEST_PASSWORD',
    })

    await expect(ctx.mail.send({
      to: process.env.DSH_SMTP_TEST_TO ?? (user as string),
      subject: 'deepseek-harness mail-smtp e2e',
      text: 'Delivered by the dsh-mail-smtp end-to-end test.',
      html: '<p>Delivered by the <code>dsh-mail-smtp</code> end-to-end test.</p>',
    })).resolves.toBeUndefined()
  })
})
