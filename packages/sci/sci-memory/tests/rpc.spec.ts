// The two recall endpoints over a real session corpus: `sci.recall.index`
// returns one row per session and `sci.recall.session` returns one clean
// dialogue. Both read through the mounted `ctx.sessionQuery` backend, so the
// index reflects what the corpus actually holds rather than a seeded fixture.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SciMemoryService, { DEFAULT_MEMORY_TOOLS, RECALL_NAMESPACE, SERVICE_KEY } from '@deepseek-ai/dsh-sci-memory'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Compose the service over a real session store and query backend.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-memory-rpc-'))
  await mkdir(join(root, 'sci', 'memory'), { recursive: true })
  await mkdir(join(root, 'storage'), { recursive: true })
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: join(root, 'sci') })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionQuerySqlite, { path: join(root, 'query.sqlite') })
  await ctx.plugin(SciMemoryService, { memoryDir: join(root, 'sci', 'memory'), memoryTools: [...DEFAULT_MEMORY_TOOLS], openingRequestLimit: 20 })
  await ctx.fiber.await()
  return ctx
}

/**
 * Append one human message.
 * @param session - the session to append to.
 * @param text - the visible request text.
 */
function userSays(session: Session, text: string): void {
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

/**
 * Append one model reply.
 * @param session - the session to append to.
 * @param text - the visible reply text.
 */
function assistantSays(session: Session, text: string): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

describe('sci.recall endpoints', () => {
  it('exports both endpoints under the sci.recall namespace', async () => {
    const ctx = await boot()
    const binding = ctx.sciMemory.typertRemote
    expect(binding.serviceKey).toBe(SERVICE_KEY)
    expect(binding.namespace).toBe(RECALL_NAMESPACE)
    expect(remoteMethods(ctx.sciMemory).map(marker => marker.exportName ?? marker.method)).toEqual(['index', 'session'])
  })

  it('returns one index row per session in the corpus', async () => {
    const ctx = await boot()
    const first = ctx.sessions.create()
    userSays(first, 'Survey agent fuzzing thoroughly')
    assistantSays(first, 'Starting.')
    const second = ctx.sessions.create()
    userSays(second, 'Plot it.')

    const value = await ctx.sciMemory.index()
    const rows = new Map(value.sessions.map(row => [row.sessionId, row]))
    expect(rows.size).toBe(2)
    expect(rows.get(first.id)?.openingRequest).toBe('Survey agent fuzzin…')
    expect(rows.get(second.id)?.openingRequest).toBe('Plot it.')
    expect(rows.get(second.id)?.startedAt).toBe(second.header.createdAt)
    expect(rows.get(first.id)?.deliveries).toEqual([])
  })

  it('transcribes one session and strips its tool traffic', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()
    userSays(session, 'Plot it.')
    assistantSays(session, 'Rendering.')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const result = await ctx.sciMemory.session({ sessionId: session.id })
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.entries.map(entry => entry.kind === 'message' ? entry.text : entry.kind))
      .toEqual(['Plot it.', 'Rendering.'])
  })

  it('reports session-not-found for an id the corpus does not hold', async () => {
    const ctx = await boot()
    const sessionId = SessionId('deadbeef-0000-0000-0000-000000000000')
    await expect(ctx.sciMemory.session({ sessionId })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', sessionId },
    })
  })

  it('propagates a query failure that is not an absent session', async () => {
    const ctx = await boot()
    const failure = new Error('sqlite is gone')
    ctx.sessionQuery.readSession = () => Promise.reject(failure)
    await expect(ctx.sciMemory.session({ sessionId: SessionId('x') })).rejects.toBe(failure)
  })

  it('has no index rows and no timing score before any session exists', async () => {
    const ctx = await boot()
    await expect(ctx.sciMemory.index()).resolves.toEqual({ sessions: [] })
    expect(ctx.sciMemory.timingScore()).toBeUndefined()
  })

  it('removes the service when its fiber is disposed', async () => {
    const ctx = await boot()
    expect(ctx.get(SERVICE_KEY)).toBeDefined()
    await ctx.fiber.dispose()
    expect(ctx.get(SERVICE_KEY)).toBeUndefined()
    context = undefined
  })
})
