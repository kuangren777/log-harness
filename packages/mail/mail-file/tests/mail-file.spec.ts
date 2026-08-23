import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { MailMessage } from '@deepseek-ai/dsh-mail'
import FileMailProvider, { type MailFileRecord } from '../src/index.ts'

const MESSAGE: MailMessage = {
  to: 'recipient@example.com',
  subject: 'Your sign-in code',
  text: 'Your code is 314159.',
}

const roots: string[] = []

async function mailbox(...segments: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mail-file-'))
  roots.push(root)
  return join(root, ...segments)
}

/** Mount the provider on its own fiber, keeping the instance the disposal tests call after teardown. */
async function mount(ctx: Context, path: string): Promise<{ fiber: Fiber; provider: FileMailProvider }> {
  let provider: FileMailProvider | undefined
  const fiber = await ctx.plugin((child: Context) => {
    provider = new FileMailProvider(child, { path })
  })
  if (provider === undefined) throw new Error('the provider plugin did not construct')
  return { fiber, provider }
}

async function lines(path: string): Promise<MailFileRecord[]> {
  const text = await readFile(path, 'utf8')
  expect(text.endsWith('\n')).toBe(true)
  return text.split('\n').slice(0, -1).map(line => JSON.parse(line) as MailFileRecord)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('the file mail provider', () => {
  it('writes one JSON line per message, creating the parent directory', async () => {
    const path = await mailbox('nested', 'deeper', 'outbox.jsonl')
    const ctx = new Context()
    await ctx.plugin(FileMailProvider, { path })

    await ctx.mail.send(MESSAGE)
    await ctx.mail.send({ ...MESSAGE, subject: 'Second', html: '<p>Your code is 314159.</p>' })

    const written = await lines(path)
    expect(written).toEqual([
      { ts: expect.any(String) as unknown as string, to: MESSAGE.to, subject: 'Your sign-in code', text: MESSAGE.text },
      {
        ts: expect.any(String) as unknown as string,
        to: MESSAGE.to,
        subject: 'Second',
        text: MESSAGE.text,
        html: '<p>Your code is 314159.</p>',
      },
    ])
    expect(new Date(written[0]?.ts ?? '').toISOString()).toBe(written[0]?.ts)
  })

  it('appends to an existing mailbox in acceptance order under concurrent sends', async () => {
    const path = await mailbox('outbox.jsonl')
    await writeFile(path, `${JSON.stringify({ ts: 'earlier', to: 'a@example.com', subject: 'prior', text: 'kept' })}\n`)
    const ctx = new Context()
    await ctx.plugin(FileMailProvider, { path })

    await Promise.all([
      ctx.mail.send({ ...MESSAGE, subject: 'first' }),
      ctx.mail.send({ ...MESSAGE, subject: 'second' }),
      ctx.mail.send({ ...MESSAGE, subject: 'third' }),
    ])

    expect((await lines(path)).map(entry => entry.subject)).toEqual(['prior', 'first', 'second', 'third'])
  })

  it('keeps the mailbox owner-only, including one an earlier run left readable', async () => {
    const path = await mailbox('outbox.jsonl')
    await writeFile(path, '', { mode: 0o644 })
    const ctx = new Context()
    await ctx.plugin(FileMailProvider, { path })

    await ctx.mail.send(MESSAGE)

    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('creates a new mailbox owner-only', async () => {
    const path = await mailbox('outbox.jsonl')
    const ctx = new Context()
    await ctx.plugin(FileMailProvider, { path })

    await ctx.mail.send(MESSAGE)

    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects the send when the mailbox path cannot be opened', async () => {
    const path = await mailbox('outbox.jsonl')
    await mkdir(path)
    const ctx = new Context()
    await ctx.plugin(FileMailProvider, { path })

    await expect(ctx.mail.send(MESSAGE)).rejects.toThrow(/EISDIR|illegal operation on a directory/)
    // The failed open left no handle behind, so the next send retries it.
    await expect(ctx.mail.send(MESSAGE)).rejects.toThrow(/EISDIR|illegal operation on a directory/)
  })

  it('closes the mailbox with its fiber and refuses later sends, twice over', async () => {
    const path = await mailbox('outbox.jsonl')
    const ctx = new Context()
    const { fiber, provider } = await mount(ctx, path)
    await provider.send(MESSAGE)

    await fiber.dispose()
    await fiber.dispose()

    expect(ctx.get('mail')).toBeUndefined()
    await expect(provider.send(MESSAGE)).rejects.toThrow(/mailbox .* is closed/)
    expect((await lines(path)).length).toBe(1)
  })

  it('flushes a send accepted before teardown', async () => {
    const path = await mailbox('outbox.jsonl')
    const ctx = new Context()
    const { fiber, provider } = await mount(ctx, path)

    const inFlight = provider.send(MESSAGE)
    await fiber.dispose()
    await inFlight

    expect((await lines(path)).length).toBe(1)
  })
})
