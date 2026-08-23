import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MailInvariant from '../src/invariant.ts'
import { MemoryMailProvider } from './memory.ts'

describe('mail invariant companion', () => {
  it('reserves the package name and leaves a mounted provider working', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MailInvariant)
    await ctx.plugin(MemoryMailProvider)

    await expect(ctx.mail.send({ to: 'a@example.com', subject: 's', text: 't' })).resolves.toBeUndefined()
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-mail', () => {})
    }).toThrow(/already registered/)
  })
})
