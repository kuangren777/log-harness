import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import FileMailProvider from '../src/index.ts'
import * as MailFileInvariant from '../src/invariant.ts'

describe('mail-file invariant companion', () => {
  it('reserves the package name and leaves the mounted provider working', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mail-file-invariant-'))
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(MailFileInvariant)
    await ctx.plugin(FileMailProvider, { path: join(root, 'outbox.jsonl') })

    await expect(ctx.mail.send({ to: 'a@example.com', subject: 's', text: 't' })).resolves.toBeUndefined()
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-mail-file', () => {})
    }).toThrow(/already registered/)

    await rm(root, { recursive: true, force: true })
  })
})
