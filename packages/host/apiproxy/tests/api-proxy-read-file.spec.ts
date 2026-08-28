/**
 * `workspace.readFile` serves one file's complete content from the filesystem
 * seam a session's tools run in: text media types decode as UTF-8 and
 * everything else rides base64, the session's own cwd is the containment
 * fence, and the deployment's byte cap refuses an oversized file instead of
 * truncating it. Composed over a real SessionStore plus the local filesystem
 * backend rooted at a temporary directory, so the reads are real reads.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ApiProxy, WorkspaceFileContent } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`read-file-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function expectError<T>(response: RpcResponse<T>): { code: string; message: string; details: unknown } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  const { code, message, details } = response.result.error
  return { code, message, details }
}

const SESSION = SessionId('read-file-session')

/**
 * Compose the gateway over a real SessionStore and, unless `fs` replaces it,
 * the real local filesystem backend rooted at the session's project directory.
 * The session is entered directly: reading resolves its cwd from the header
 * and never acquires an Agent.
 */
async function harness(options: {
  readFileMaxBytes?: number
  /** Enter the session with a cwd-less header (a pre-project legacy log). */
  withoutCwd?: boolean
  fs?: 'absent' | { resolve: unknown }
} = {}): Promise<{ api: ApiProxy; root: string; ctx: Context }> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-read-file-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (options.fs === undefined) await ctx.plugin(LocalFileSystem, { cwd: root })
  else if (options.fs !== 'absent') ctx.provide('fs', options.fs as never)
  ctx.sessions.create(SESSION, options.withoutCwd === true ? {} : { meta: { cwd: root } })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
    ...options.readFileMaxBytes === undefined ? {} : { readFileMaxBytes: options.readFileMaxBytes },
  })
  return { api, root, ctx }
}

/** Read one path under the harness session with a fresh, un-aborted carrier signal. */
function read(
  api: ApiProxy,
  path: string,
  sessionId: SessionId = SESSION,
  signal: AbortSignal = new AbortController().signal,
): Promise<RpcResponse<WorkspaceFileContent>> {
  return api.workspace.readFile(request({ sessionId, path }), signal)
}

describe('workspace.readFile content', () => {
  it('decodes a text file as UTF-8 and reports its extension media type and canonical path', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'notes.md'), '# Findings\n\n结果良好\n')
    const value = expectOk(await read(api, 'notes.md'))
    expect(value).toEqual({
      path: join(root, 'notes.md'),
      size: Buffer.byteLength('# Findings\n\n结果良好\n'),
      mediaType: 'text/markdown',
      encoding: 'utf8',
      content: '# Findings\n\n结果良好\n',
    })
  })

  it('treats JSON as text even though its media type is not text/*', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'run.json'), '{"ok":true}')
    const value = expectOk(await read(api, 'run.json'))
    expect(value.mediaType).toBe('application/json')
    expect(value.encoding).toBe('utf8')
    expect(value.content).toBe('{"ok":true}')
  })

  it('base64-encodes a binary file under its image media type', async () => {
    const { api, root } = await harness()
    const png = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    writeFileSync(join(root, 'figure.PNG'), png)
    const value = expectOk(await read(api, 'figure.PNG'))
    expect(value.mediaType).toBe('image/png')
    expect(value.encoding).toBe('base64')
    expect(value.size).toBe(8)
    expect(Uint8Array.from(Buffer.from(value.content, 'base64'))).toEqual(png)
  })

  it('serves an unlisted extension as opaque bytes', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'model.bin'), Uint8Array.from([0, 1, 2]))
    const value = expectOk(await read(api, 'model.bin'))
    expect(value.mediaType).toBe('application/octet-stream')
    expect(value.encoding).toBe('base64')
  })

  it('reads an absolute path inside the project directory and a nested relative one', async () => {
    const { api, root } = await harness()
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'out', 'table.csv'), 'a,b\n1,2\n')
    expect(expectOk(await read(api, join(root, 'out', 'table.csv'))).mediaType).toBe('text/csv')
    expect(expectOk(await read(api, 'out/table.csv')).content).toBe('a,b\n1,2\n')
  })
})

describe('workspace.readFile scope fence', () => {
  it('refuses a relative escape, an unrelated absolute path, and a symlink leaving the project', async () => {
    const { api, root } = await harness()
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-read-file-outside-')))
    writeFileSync(join(outside, 'secret.md'), 'not yours\n')
    symlinkSync(join(outside, 'secret.md'), join(root, 'link.md'))
    for (const path of ['../secret.md', join(outside, 'secret.md'), 'link.md']) {
      const error = expectError(await read(api, path))
      expect(error.code).toBe('path-out-of-scope')
      expect(error.details).toEqual({ path, cwd: root })
    }
  })

  it('reads the project directory itself only as a directory refusal', async () => {
    const { api, root } = await harness()
    const error = expectError(await read(api, root))
    expect(error.code).toBe('not-a-file')
    expect(error.message).toContain('is a directory')
  })
})

describe('workspace.readFile refusals', () => {
  it('answers file-not-found for an absent target and for a path through a regular file', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'notes.md'), 'x\n')
    expect(expectError(await read(api, 'missing.md')).code).toBe('file-not-found')
    const throughFile = expectError(await read(api, 'notes.md/child.txt'))
    expect(throughFile.code).toBe('file-not-found')
    expect(throughFile.details).toEqual({ path: 'notes.md/child.txt' })
  })

  it('reads a file at the exact cap but refuses one byte more', async () => {
    const { api, root } = await harness({ readFileMaxBytes: 16 })
    writeFileSync(join(root, 'exact.txt'), 'x'.repeat(16))
    expect(expectOk(await read(api, 'exact.txt')).size).toBe(16)
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(17))
    const error = expectError(await read(api, 'big.txt'))
    expect(error.code).toBe('file-too-large')
    expect(error.details).toEqual({ path: 'big.txt', maxBytes: 16 })
    expect(error.message).toContain('17 bytes')
  })

  it('answers session-not-found for a session that is not attached', async () => {
    const { api } = await harness()
    const error = expectError(await read(api, 'notes.md', SessionId('nobody')))
    expect(error.code).toBe('session-not-found')
    expect(error.details).toEqual({ sessionId: 'nobody' })
  })

  it('answers internal for a session header without a project cwd', async () => {
    const { api } = await harness({ withoutCwd: true })
    const error = expectError(await read(api, 'notes.md'))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('has no project cwd')
  })

  it('answers internal when the composition mounts no filesystem backend', async () => {
    const { api } = await harness({ fs: 'absent' })
    const error = expectError(await read(api, 'notes.md'))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('mounts no @deepseek-ai/dsh-fs backend')
  })

  it('answers cancelled when the carrier signal is already aborted', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'notes.md'), 'x\n')
    const controller = new AbortController()
    controller.abort()
    expect(expectError(await read(api, 'notes.md', SESSION, controller.signal)).code).toBe('cancelled')
  })

  it('folds an untyped backend failure into internal', async () => {
    // Structural stand-in for a backend whose transport breaks: the gateway
    // must not turn an unclassified throw into a business code it defined.
    const { api } = await harness({ fs: { resolve: () => Promise.reject(new Error('backend offline')) } })
    const error = expectError(await read(api, 'notes.md'))
    expect(error.code).toBe('internal')
    expect(error.message).toBe('reading "notes.md" failed: backend offline')
  })
})
