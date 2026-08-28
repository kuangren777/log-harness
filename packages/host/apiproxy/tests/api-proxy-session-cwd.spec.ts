/**
 * sessions.create ensures its project directory in the execution world the
 * session's tools will see: through the composed filesystem seam when there is
 * one (a sandboxed backend's paths are not Host paths), on the Host filesystem
 * only when the composition has no filesystem at all. The filesystem fake is
 * structural because the gateway calls exactly two methods on the seam, and the
 * seam-backed cases prove absence on the Host filesystem by pointing the cwd at
 * a path under the temporary root that nothing creates.
 */

import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { FsInfo } from '@deepseek-ai/dsh-fs'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`cwd-${String(nextRpc++)}`), payload }
}

function expectError<T>(response: RpcResponse<T>): { code: string; message: string } {
  expect(response.result.ok).toBe(false)
  if (response.result.ok) throw new Error('unreachable')
  return { code: response.result.error.code, message: response.result.error.message }
}

/**
 * Filesystem fake recording every path the gateway probes. `stat` answers from
 * `entries` keyed by the resolved path; an absent key is an absent target.
 */
function fakeFs(entries: Record<string, FsInfo['type']>) {
  const resolved: string[] = []
  const statted: string[] = []
  const service = {
    resolve: (path: string) => {
      resolved.push(path)
      return Promise.resolve({ targetKey: path, displayPath: path })
    },
    stat: (target: { targetKey: string }) => {
      statted.push(target.targetKey)
      const type = entries[target.targetKey]
      return Promise.resolve(type === undefined ? undefined : { version: 'v1', type })
    },
  }
  return { service, entries, resolved, statted }
}

/** Compose the gateway over a real SessionStore/AgentRegistry with an optional filesystem seam. */
async function harness(fs?: { resolve: unknown; stat: unknown }) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-session-cwd-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (fs !== undefined) ctx.provide('fs', fs as never)
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: no session is persisted here')),
  })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { api, ctx, root }
}

describe('sessions.create project directory', () => {
  it('ensures the cwd through the composed filesystem seam, leaving the Host filesystem untouched', async () => {
    const fs = fakeFs({})
    const { api, ctx, root } = await harness(fs.service)
    // The seam's world is not this process's: the directory exists there and
    // nowhere on the Host, the sci deployment's arrangement in miniature.
    const sandboxCwd = join(root, 'sandbox', 'projects')
    fs.entries[sandboxCwd] = 'directory'

    const created = await api.sessions.create(request({ sessionId: SessionId('sandbox-cwd'), cwd: sandboxCwd }))
    expect(created.result).toEqual({ ok: true, value: { sessionId: SessionId('sandbox-cwd') } })
    expect(fs.resolved).toEqual([sandboxCwd])
    expect(fs.statted).toEqual([sandboxCwd])
    expect(ctx.sessions.get(SessionId('sandbox-cwd'))?.header.cwd).toBe(sandboxCwd)
    // A Host mkdir of a path that only the backend has is the defect itself.
    expect(existsSync(sandboxCwd)).toBe(false)
  })

  it('refuses a cwd the filesystem backend does not have instead of creating one on the Host', async () => {
    const fs = fakeFs({})
    const { api, ctx, root } = await harness(fs.service)
    const missing = join(root, 'sandbox-only', 'projects')

    const response = await api.sessions.create(request({ sessionId: SessionId('absent-cwd'), cwd: missing }))
    const error = expectError(response)
    expect(error.code).toBe('internal')
    expect(error.message).toContain(`failed to ensure project directory "${missing}": `)
    expect(error.message).toContain('the filesystem backend has no such directory')
    expect(existsSync(missing)).toBe(false)
    expect(ctx.sessions.get(SessionId('absent-cwd'))).toBeUndefined()
  })

  it('refuses a cwd the filesystem backend reports as a non-directory', async () => {
    const fs = fakeFs({})
    const { api, root } = await harness(fs.service)
    const notes = join(root, 'notes.md')
    fs.entries[notes] = 'file'

    const response = await api.sessions.create(request({ sessionId: SessionId('file-cwd'), cwd: notes }))
    const error = expectError(response)
    expect(error.message).toContain(`failed to ensure project directory "${notes}": `)
    expect(error.message).toContain('reports a file, not a directory')
  })

  it('creates the directory recursively on the Host filesystem with no filesystem service composed', async () => {
    const { api, root } = await harness()
    const hostCwd = join(root, 'host-created', 'nested')

    const created = await api.sessions.create(request({ sessionId: SessionId('host-cwd'), cwd: hostCwd }))
    expect(created.result).toEqual({ ok: true, value: { sessionId: SessionId('host-cwd') } })
    expect(existsSync(hostCwd)).toBe(true)
  })

  it('reports a Host mkdir failure under the same ensure-failure message', async () => {
    const { api, root } = await harness()
    // A regular file where a path segment must be a directory: ENOTDIR from the
    // Host mkdir, the failure the fallback branch has to surface.
    const blocked = join(root, 'blocking-file', 'project')
    writeFileSync(join(root, 'blocking-file'), '')

    const response = await api.sessions.create(request({ sessionId: SessionId('blocked-cwd'), cwd: blocked }))
    const error = expectError(response)
    expect(error.message).toContain(`failed to ensure project directory "${blocked}": `)
  })
})
