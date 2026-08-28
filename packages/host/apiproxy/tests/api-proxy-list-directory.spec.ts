/**
 * `workspace.listDirectory` serves one directory level from the filesystem seam
 * a session's tools run in: directories sort ahead of everything else, symlinks
 * report what they resolve to while keeping their own row path, the session's
 * own cwd is the containment fence, and the deployment's entry cap refuses an
 * oversized level instead of truncating it. Composed over a real SessionStore
 * plus the local filesystem backend rooted at a temporary directory, so the
 * listings are real listings.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import type { ApiProxy, WorkspaceDirectoryListing } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`list-directory-${String(nextRpc++)}`), payload }
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

const SESSION = SessionId('list-directory-session')

/**
 * Create a named pipe: the portable neither-file-nor-directory entry a POSIX
 * test can make without privileges. A socket or device node reaches the same
 * `kind: 'other'` arm.
 */
function makeSpecialFile(path: string): void {
  execFileSync('mkfifo', [path])
}

/**
 * Compose the gateway over a real SessionStore and, unless `fs` replaces it,
 * the real local filesystem backend rooted at the session's project directory.
 * The session is entered directly: listing resolves its cwd from the header and
 * never acquires an Agent.
 */
async function harness(options: {
  listDirectoryMaxEntries?: number
  /** Enter the session with a cwd-less header (a pre-project legacy log). */
  withoutCwd?: boolean
  fs?: 'absent' | { resolve: unknown }
} = {}): Promise<{ api: ApiProxy; root: string; ctx: Context }> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-list-dir-')))
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
    ...options.listDirectoryMaxEntries === undefined
      ? {}
      : { listDirectoryMaxEntries: options.listDirectoryMaxEntries },
  })
  return { api, root, ctx }
}

/** List one path under the harness session with a fresh, un-aborted carrier signal. */
function list(
  api: ApiProxy,
  path: string,
  sessionId: SessionId = SESSION,
  signal: AbortSignal = new AbortController().signal,
): Promise<RpcResponse<WorkspaceDirectoryListing>> {
  return api.workspace.listDirectory(request({ sessionId, path }), signal)
}

describe('workspace.listDirectory level', () => {
  it('lists the project directory for an empty path, dotfiles included, directories first then by name', async () => {
    const { api, root } = await harness()
    mkdirSync(join(root, 'out'))
    mkdirSync(join(root, '.cache'))
    writeFileSync(join(root, 'notes.md'), 'x\n')
    writeFileSync(join(root, '.env'), 'K=v\n')
    writeFileSync(join(root, 'a-report.pdf'), 'pdf')
    const value = expectOk(await list(api, ''))
    expect(value.path).toBe(root)
    expect(value.entries).toEqual([
      { name: '.cache', path: join(root, '.cache'), kind: 'directory' },
      { name: 'out', path: join(root, 'out'), kind: 'directory' },
      { name: '.env', path: join(root, '.env'), kind: 'file', size: 4 },
      { name: 'a-report.pdf', path: join(root, 'a-report.pdf'), kind: 'file', size: 3 },
      { name: 'notes.md', path: join(root, 'notes.md'), kind: 'file', size: 2 },
    ])
  })

  it('answers an empty level for an empty directory', async () => {
    const { api, root } = await harness()
    mkdirSync(join(root, 'out'))
    expect(expectOk(await list(api, 'out'))).toEqual({ path: join(root, 'out'), entries: [] })
  })

  it('lists a nested relative path and the same directory addressed absolutely', async () => {
    const { api, root } = await harness()
    mkdirSync(join(root, 'out', 'figures'), { recursive: true })
    writeFileSync(join(root, 'out', 'figures', 'fig1.png'), Uint8Array.from([1, 2]))
    const relative = expectOk(await list(api, 'out/figures'))
    const absolute = expectOk(await list(api, join(root, 'out', 'figures')))
    expect(relative).toEqual(absolute)
    expect(relative.entries).toEqual([
      { name: 'fig1.png', path: join(root, 'out', 'figures', 'fig1.png'), kind: 'file', size: 2 },
    ])
  })

  it('resolves a symlink for kind while the row keeps the entry path, and reports a dangling one as other', async () => {
    const { api, root } = await harness()
    mkdirSync(join(root, 'real-dir'))
    writeFileSync(join(root, 'real-file.txt'), 'abc')
    symlinkSync(join(root, 'real-dir'), join(root, 'link-dir'))
    symlinkSync(join(root, 'real-file.txt'), join(root, 'link-file'))
    symlinkSync(join(root, 'gone.txt'), join(root, 'link-dangling'))
    const byName = new Map(expectOk(await list(api, '')).entries.map(entry => [entry.name, entry]))
    expect(byName.get('link-dir')).toEqual({ name: 'link-dir', path: join(root, 'link-dir'), kind: 'directory' })
    expect(byName.get('link-file')).toEqual({
      name: 'link-file', path: join(root, 'link-file'), kind: 'file', size: 3,
    })
    expect(byName.get('link-dangling')).toEqual({
      name: 'link-dangling', path: join(root, 'link-dangling'), kind: 'other',
    })
  })

  it('reports a special file as other', async () => {
    const { api, root } = await harness()
    makeSpecialFile(join(root, 'pipe'))
    expect(expectOk(await list(api, '')).entries).toEqual([
      { name: 'pipe', path: join(root, 'pipe'), kind: 'other' },
    ])
  })
})

describe('workspace.listDirectory scope fence', () => {
  it('refuses a relative escape, an unrelated absolute path, and a symlink leaving the project', async () => {
    const { api, root } = await harness()
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-list-dir-outside-')))
    mkdirSync(join(outside, 'secrets'))
    symlinkSync(join(outside, 'secrets'), join(root, 'link-out'))
    for (const path of ['../secrets', join(outside, 'secrets'), 'link-out']) {
      const error = expectError(await list(api, path))
      expect(error.code).toBe('path-out-of-scope')
      expect(error.details).toEqual({ path, cwd: root })
    }
  })
})

describe('workspace.listDirectory refusals', () => {
  it('answers not-a-directory for a regular file and for a special file', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'notes.md'), 'x\n')
    makeSpecialFile(join(root, 'pipe'))
    for (const path of ['notes.md', 'pipe']) {
      const error = expectError(await list(api, path))
      expect(error.code).toBe('not-a-directory')
      expect(error.message).toContain('not a directory')
      expect(error.details).toEqual({ path })
    }
  })

  it('answers file-not-found for an absent target and for a path through a regular file', async () => {
    const { api, root } = await harness()
    writeFileSync(join(root, 'notes.md'), 'x\n')
    expect(expectError(await list(api, 'missing')).code).toBe('file-not-found')
    const throughFile = expectError(await list(api, 'notes.md/child'))
    expect(throughFile.code).toBe('file-not-found')
    expect(throughFile.details).toEqual({ path: 'notes.md/child' })
  })

  it('lists a level at the exact cap but refuses one entry more', async () => {
    const { api, root } = await harness({ listDirectoryMaxEntries: 3 })
    mkdirSync(join(root, 'exact'))
    for (const name of ['a', 'b', 'c']) writeFileSync(join(root, 'exact', name), '')
    expect(expectOk(await list(api, 'exact')).entries).toHaveLength(3)
    writeFileSync(join(root, 'exact', 'd'), '')
    const error = expectError(await list(api, 'exact'))
    expect(error.code).toBe('too-many-entries')
    expect(error.message).toContain('4 entries')
    expect(error.details).toEqual({ path: 'exact', maxEntries: 3 })
  })

  it('answers session-not-found for a session that is not attached', async () => {
    const { api } = await harness()
    const error = expectError(await list(api, '', SessionId('nobody')))
    expect(error.code).toBe('session-not-found')
    expect(error.details).toEqual({ sessionId: 'nobody' })
  })

  it('answers internal for a session header without a project cwd', async () => {
    const { api } = await harness({ withoutCwd: true })
    const error = expectError(await list(api, ''))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('has no project cwd')
  })

  it('answers internal when the composition mounts no filesystem backend', async () => {
    const { api } = await harness({ fs: 'absent' })
    const error = expectError(await list(api, ''))
    expect(error.code).toBe('internal')
    expect(error.message).toContain('mounts no @deepseek-ai/dsh-fs backend')
  })

  it('answers cancelled when the carrier signal is already aborted', async () => {
    const { api } = await harness()
    const controller = new AbortController()
    controller.abort()
    expect(expectError(await list(api, '', SESSION, controller.signal)).code).toBe('cancelled')
  })

  it('folds an untyped backend failure into internal', async () => {
    // Structural stand-in for a backend whose transport breaks: the gateway
    // must not turn an unclassified throw into a business code it defined.
    const { api } = await harness({ fs: { resolve: () => Promise.reject(new Error('backend offline')) } })
    const error = expectError(await list(api, 'out'))
    expect(error.code).toBe('internal')
    expect(error.message).toBe('listing "out" failed: backend offline')
  })

  it('folds a non-Error rejection into internal without losing its text', async () => {
    // A worker or IPC backend can fail with a plain value; the diagnostic still
    // has to name something.
    const reason: unknown = 'socket closed'
    const { api } = await harness({ fs: { resolve: () => { throw reason } } })
    const error = expectError(await list(api, 'out'))
    expect(error.code).toBe('internal')
    expect(error.message).toBe('listing "out" failed: socket closed')
  })
})
