import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { MailMessage } from '../src/index.ts'
import { MemoryMailProvider } from './memory.ts'

const MESSAGE: MailMessage = {
  to: 'recipient@example.com',
  subject: 'Your sign-in code',
  text: 'Your code is 314159.',
}

describe('the mail seam through the memory provider', () => {
  it('mounts as ctx.mail and hands the message to the provider unchanged', async () => {
    const ctx = new Context()
    const provider = new MemoryMailProvider(ctx)

    await ctx.mail.send(MESSAGE)
    await ctx.mail.send({ ...MESSAGE, html: '<p>Your code is 314159.</p>' })

    expect(provider.outbox).toEqual([
      MESSAGE,
      { ...MESSAGE, html: '<p>Your code is 314159.</p>' },
    ])
  })

  it('removes the service with its fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryMailProvider)
    expect(ctx.get('mail')).toBeDefined()

    await fiber.dispose()

    expect(ctx.get('mail')).toBeUndefined()
  })
})
