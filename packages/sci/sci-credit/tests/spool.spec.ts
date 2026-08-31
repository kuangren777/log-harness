// A spooled charge is money already spent upstream, so the queue's behaviour on
// a killed process, an unreadable line, and a gate that refuses halfway is
// pinned over a real filesystem rather than a mock.
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChargeSpool, retryDelayMs } from '../src/spool.ts'
import type { ChargePayload } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) {
    await chmod(root, 0o700).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})

/** A fresh spool under a fresh temporary directory that does not exist yet. */
async function spool(): Promise<{ spool: ChargeSpool; path: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-credit-spool-'))
  const path = join(root, '.sci', 'credit-spool.jsonl')
  return { spool: new ChargeSpool(path), path }
}

/** One charge payload with the given id. */
function payload(requestId: string, usdMicros = 10): ChargePayload {
  return {
    requestId,
    sessionId: 'session-1',
    model: 'deepseek-v4-pro',
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    usdMicros,
    priceVersion: 1,
    ratioX1000: 1000,
    unknownModel: false,
  }
}

describe('ChargeSpool', () => {
  it('reads back nothing at all before anything has failed', async () => {
    const { spool: queue } = await spool()

    await expect(queue.read()).resolves.toEqual({ payloads: [], discarded: 0 })
  })

  it('creates the owner-only directory and file on the first append', async () => {
    const { spool: queue, path } = await spool()

    await queue.append(payload('req-1'))

    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(payload('req-1'))}\n`)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
  })

  it('keeps appends in order even when they are issued concurrently', async () => {
    const { spool: queue } = await spool()

    await Promise.all([queue.append(payload('req-1')), queue.append(payload('req-2')), queue.append(payload('req-3'))])

    const { payloads } = await queue.read()
    expect(payloads.map(entry => entry.requestId)).toEqual(['req-1', 'req-2', 'req-3'])
  })

  it('drains every payload and removes the file once nothing is left', async () => {
    const { spool: queue, path } = await spool()
    await queue.append(payload('req-1'))
    await queue.append(payload('req-2'))
    const delivered: string[] = []

    const report = await queue.drain((entry) => {
      delivered.push(entry.requestId)
      return Promise.resolve()
    })

    expect(report).toEqual({ delivered: 2, pending: 0, discarded: 0 })
    expect(delivered).toEqual(['req-1', 'req-2'])
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops at the first refusal and keeps the rest in file order', async () => {
    const { spool: queue } = await spool()
    for (const id of ['req-1', 'req-2', 'req-3']) await queue.append(payload(id))
    const seen: string[] = []

    const report = await queue.drain((entry) => {
      seen.push(entry.requestId)
      return entry.requestId === 'req-2' ? Promise.reject(new Error('gate down')) : Promise.resolve()
    })

    expect(report).toEqual({ delivered: 1, pending: 2, discarded: 0 })
    expect(seen).toEqual(['req-1', 'req-2'])
    const { payloads } = await queue.read()
    expect(payloads.map(entry => entry.requestId)).toEqual(['req-2', 'req-3'])
  })

  it('leaves the file untouched when the gate refuses the very first payload', async () => {
    const { spool: queue, path } = await spool()
    await queue.append(payload('req-1'))
    const before = await readFile(path, 'utf8')

    const report = await queue.drain(() => Promise.reject(new Error('gate down')))

    expect(report).toEqual({ delivered: 0, pending: 1, discarded: 0 })
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('discards a truncated tail and lines that are not charge payloads', async () => {
    const { spool: queue, path } = await spool()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, [
      JSON.stringify(payload('req-1')),
      '',
      '{"requestId":"req-2","model":"m"',
      JSON.stringify({ requestId: '', model: 'm', usdMicros: 1, usage: {} }),
      JSON.stringify({ model: 'm', usdMicros: 1, usage: {} }),
      JSON.stringify({ requestId: 'req-3', usdMicros: 1, usage: {} }),
      JSON.stringify({ requestId: 'req-4', model: 'm', usage: {} }),
      JSON.stringify({ requestId: 'req-5', model: 'm', usdMicros: 1 }),
      JSON.stringify({ requestId: 'req-6', model: 'm', usdMicros: 1, usage: null }),
      JSON.stringify('a bare string'),
      'null',
      '',
    ].join('\n'))

    const { payloads, discarded } = await queue.read()

    expect(payloads.map(entry => entry.requestId)).toEqual(['req-1'])
    expect(discarded).toBe(9)
  })

  it('rewrites the file even when it delivered nothing, so a discarded line cannot block it forever', async () => {
    const { spool: queue, path } = await spool()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, `not json\n${JSON.stringify(payload('req-1'))}\n`)

    const report = await queue.drain(() => Promise.reject(new Error('gate down')))

    expect(report).toEqual({ delivered: 0, pending: 1, discarded: 1 })
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify(payload('req-1'))}\n`)
  })

  it('surfaces a read failure that is not mere absence', async () => {
    const { spool: queue, path } = await spool()
    await queue.append(payload('req-1'))
    // A directory in place of the file: reading it fails with EISDIR, which is
    // not the absence the ordinary path treats as an empty queue.
    await rm(path)
    await mkdir(path)

    await expect(queue.read()).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('keeps serving later operations after one of them fails', async () => {
    const { spool: queue, path } = await spool()
    await queue.append(payload('req-1'))
    await rm(path)
    await mkdir(path)

    await expect(queue.read()).rejects.toMatchObject({ code: 'EISDIR' })
    await rm(path, { recursive: true })
    await expect(queue.read()).resolves.toEqual({ payloads: [], discarded: 0 })
  })
})

describe('retryDelayMs', () => {
  it.each([
    { attempt: 0, expected: 1000 },
    { attempt: 1, expected: 1000 },
    { attempt: 2, expected: 2000 },
    { attempt: 3, expected: 4000 },
    { attempt: 7, expected: 60_000 },
    { attempt: 400, expected: 60_000 },
  ])('waits ${expected}ms before attempt $attempt', ({ attempt, expected }) => {
    expect(retryDelayMs(attempt, 1000, 60_000)).toBe(expected)
  })

  it('never exceeds a ceiling below its own base', () => {
    expect(retryDelayMs(1, 5000, 500)).toBe(500)
  })
})
