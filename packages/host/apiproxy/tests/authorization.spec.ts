/**
 * The gateway's authorization layer: the policy every method declares, what
 * each policy admits, and the refusal a denied call earns on the wire.
 *
 * The admin coverage is exhaustive BY CONSTRUCTION: it walks `UNARY_METHODS`,
 * which is derived from the dispatch table itself, so a method added without a
 * deliberate policy cannot slip past this suite.
 */

import { describe, expect, it } from 'vitest'
import { LOCAL_PRINCIPAL, UserId, type Principal } from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  forbiddenError, ownsPayload, permitsPolicy, UNAVAILABLE_OWNERSHIP, type OwnershipLookup,
} from '../src/authorization.ts'
import { policyOf, toFetchHandler, UNARY_METHODS } from '../src/index.ts'
import type { ApiProxy } from '../src/api/index.ts'
import type { RpcMethodMap } from '../src/api/rpc-map.ts'
import { RpcId } from '../src/api/rpc.ts'

const OWNER = UserId('user-owner')
const OTHER = UserId('user-other')

const owner: Principal = { kind: 'user', userId: OWNER, email: 'owner@example.test', groups: [], admin: false }
const other: Principal = { kind: 'user', userId: OTHER, email: 'other@example.test', groups: [], admin: false }
const admin: Principal = { kind: 'user', userId: UserId('user-admin'), email: 'admin@example.test', groups: [], admin: true }

/** Ownership where every recorded session and workspace belongs to {@link OWNER}. */
const ownedByOwner: OwnershipLookup = {
  ownerOfSession: id => Promise.resolve(String(id).startsWith('unowned-') ? undefined : OWNER),
  ownerOfWorkspace: id => Promise.resolve(String(id).startsWith('unowned-') ? undefined : OWNER),
}

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

describe('policy evaluation', () => {
  it('passes the local principal without consulting ownership at all', async () => {
    for (const policy of ['user', 'admin', 'owner'] as const) {
      expect(await permitsPolicy(policy, { sessionId: sid('s-1') }, LOCAL_PRINCIPAL, UNAVAILABLE_OWNERSHIP)).toBe(true)
    }
  })

  it('passes an administrator on every policy, including another account\'s resources', async () => {
    for (const policy of ['user', 'admin', 'owner'] as const) {
      expect(await permitsPolicy(policy, { sessionId: sid('s-1') }, admin, ownedByOwner)).toBe(true)
    }
  })

  it('refuses a non-administrator on an admin row and admits it on a user row', async () => {
    expect(await permitsPolicy('admin', {}, owner, ownedByOwner)).toBe(false)
    expect(await permitsPolicy('user', {}, owner, ownedByOwner)).toBe(true)
  })

  it('resolves every addressed id, and one foreign id refuses the whole call', async () => {
    expect(await permitsPolicy('owner', { sessionId: sid('s-1') }, owner, ownedByOwner)).toBe(true)
    expect(await permitsPolicy('owner', { sessionId: sid('s-1') }, other, ownedByOwner)).toBe(false)
    expect(await permitsPolicy('owner', { workspaceId: wid('w-1') }, owner, ownedByOwner)).toBe(true)
    expect(await permitsPolicy('owner', { workspaceId: wid('w-1') }, other, ownedByOwner)).toBe(false)
    expect(await permitsPolicy(
      'owner',
      { workspaceId: wid('w-1'), sessionId: sid('s-1'), beforeSessionId: sid('s-2'), beforeWorkspaceId: wid('w-2') },
      owner,
      ownedByOwner,
    )).toBe(true)
    expect(await permitsPolicy(
      'owner',
      { workspaceId: wid('w-1'), beforeWorkspaceId: wid('unowned-w') },
      owner,
      ownedByOwner,
    )).toBe(false)
    expect(await permitsPolicy(
      'owner',
      { parentSessionId: sid('unowned-s') },
      owner,
      ownedByOwner,
    )).toBe(false)
  })

  it('owns a payload that addresses nothing, and never owns an unrecorded resource', async () => {
    expect(await ownsPayload({}, owner, ownedByOwner)).toBe(true)
    expect(await ownsPayload({ sessionId: sid('unowned-s') }, owner, ownedByOwner)).toBe(false)
  })

  it('never resolves ownership without a provider', async () => {
    await expect(UNAVAILABLE_OWNERSHIP.ownerOfSession(sid('s-1'))).rejects.toThrow('no auth provider is mounted')
    await expect(UNAVAILABLE_OWNERSHIP.ownerOfWorkspace(wid('w-1'))).rejects.toThrow('no auth provider is mounted')
  })

  it('says nothing beyond the refusal itself', () => {
    expect(forbiddenError()).toEqual({
      code: 'forbidden',
      message: 'this request is not allowed for the authenticated user',
      details: {},
    })
  })
})

/** An ApiProxy whose every domain method records the call and answers emptily. */
function recordingApi(calls: string[]): ApiProxy {
  const answer = (name: string) => (request: { rpcId: unknown }) => {
    calls.push(name)
    return Promise.resolve({ rpcId: request.rpcId, result: { ok: true, value: {} } })
  }
  const domain = (prefix: string): Record<string, unknown> => new Proxy({}, {
    get: (_target, method: string) => answer(`${prefix}.${method}`),
  })
  return {
    sessions: domain('session'), subagents: domain('subagent'), host: domain('host'),
    workspace: domain('workspace'), skills: domain('skill'), agentPresets: domain('agentPreset'),
    goals: domain('goal'), settings: domain('settings'), credentials: domain('credentials'),
    llm: domain('llm'), events: domain('events'), downloads: domain('downloads'),
    respond: () => Promise.resolve({ accepted: true as const }),
  } as unknown as ApiProxy
}

/** A payload every method's schema accepts: ids the ownership double resolves, plus the fields each schema requires. */
const PAYLOADS: { [K in keyof RpcMethodMap]?: object } = {
  'session.search': { query: 'q' },
  'session.history': { sessionId: 's-1' },
  'session.models': { sessionId: 's-1' },
  'session.selectModel': { sessionId: 's-1', provider: 'p', model: 'm' },
  'session.rename': { sessionId: 's-1', title: 't' },
  'session.fork': { sessionId: 's-1' },
  'session.prompt': { sessionId: 's-1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] },
  'session.attachment': { sessionId: 's-1', attachmentId: 'a-1' },
  'session.updateQueue': { sessionId: 's-1', itemId: 'm-1', action: { kind: 'remove' } },
  'session.cancel': { sessionId: 's-1' },
  'subagent.list': { parentSessionId: 's-1' },
  'subagent.history': { parentSessionId: 's-1', childSessionId: 'c-1', mode: 'one-shot' },
  'subagent.prompt': { parentSessionId: 's-1', childSessionId: 'c-1', mode: 'continuable', content: [{ type: 'text', text: 'hi' }] },
  'subagent.interrupt': { parentSessionId: 's-1', childSessionId: 'c-1', mode: 'continuable' },
  'host.createDirectory': { path: '/tmp', name: 'x' },
  'host.openPath': { path: '/tmp' },
  'workspace.create': { path: '/tmp' },
  'workspace.rename': { workspaceId: 'w-1', title: 't' },
  'workspace.delete': { workspaceId: 'w-1' },
  'workspace.insertBefore': { workspaceId: 'w-1' },
  'workspace.insertSessionBefore': { workspaceId: 'w-1', sessionId: 's-1' },
  'workspace.archiveSession': { sessionId: 's-1' },
  'skill.list': { sessionId: 's-1' },
  'skill.inventory': { sessionId: 's-1' },
  'agentPreset.select': { sessionId: 's-1', agentPreset: 'p' },
  'agentPreset.read': { agentPreset: 'p' },
  'agentPreset.copy': { from: 'a', agentPreset: 'b' },
  'agentPreset.openDocument': { agentPreset: 'p' },
  'agentPreset.remove': { agentPreset: 'p' },
  'goal.create': { sessionId: 's-1', objective: 'o' },
  'goal.edit': { sessionId: 's-1', ref: { id: 'g-1', revision: 1 }, objective: 'o' },
  'goal.pause': { sessionId: 's-1', ref: { id: 'g-1', revision: 1 } },
  'goal.resume': { sessionId: 's-1', ref: { id: 'g-1', revision: 1 } },
  'goal.complete': { sessionId: 's-1', ref: { id: 'g-1', revision: 1 } },
  'goal.clear': { sessionId: 's-1', ref: { id: 'g-1', revision: 1 } },
  'settings.update': { ns: 'n', patch: {} },
  'settings.replace': { ns: 'n', section: {} },
  'settings.mutate': { ns: 'n', ops: [] },
  'credentials.describe': { refs: [] },
  'credentials.set': { ref: 'r', value: 'v' },
  'credentials.unset': { ref: 'r' },
  'llm.discoverModels': { settingsNs: 'n' },
}

/** POST one method through the real carrier as one principal. */
async function call(
  api: ApiProxy,
  method: keyof RpcMethodMap,
  principal: Principal,
): Promise<{ ok: boolean; code?: string }> {
  const handler = toFetchHandler(api, { principalFor: () => principal, ownership: ownedByOwner })
  const response = await handler.fetch(new Request(`http://dsh.internal/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: RpcId('t-authz'),
      method,
      payload: PAYLOADS[method] ?? {},
    }),
  }))
  const body = await response.json() as { result: { ok: boolean; error?: { code: string } } }
  return { ok: body.result.ok, ...body.result.error === undefined ? {} : { code: body.result.error.code } }
}

describe('the policy table over every registered method', () => {
  it('declares a policy for every dispatched method and nothing else', () => {
    expect(UNARY_METHODS.length).toBeGreaterThan(0)
    for (const method of UNARY_METHODS) {
      expect(['user', 'admin', 'owner']).toContain(policyOf(method))
    }
  })

  it('refuses a non-administrator on EVERY admin row', async () => {
    const adminMethods = UNARY_METHODS.filter(method => policyOf(method) === 'admin')
    // The configuration plane is the reason this policy exists; an empty set
    // would make the assertion below vacuously true.
    expect(adminMethods.length).toBeGreaterThan(0)
    const calls: string[] = []
    const api = recordingApi(calls)
    for (const method of adminMethods) {
      expect({ method, ...await call(api, method, owner) }).toEqual({ method, ok: false, code: 'forbidden' })
    }
    // Refused before dispatch: no admin-row implementation ever ran.
    expect(calls).toEqual([])
  })

  it('admits an administrator on every admin row', async () => {
    const calls: string[] = []
    const api = recordingApi(calls)
    for (const method of UNARY_METHODS.filter(method => policyOf(method) === 'admin')) {
      expect({ method, ...await call(api, method, admin) }).toEqual({ method, ok: true })
    }
    expect(calls.length).toBeGreaterThan(0)
  })

  it('refuses another account on EVERY owner row and admits the owner', async () => {
    const ownerMethods = UNARY_METHODS.filter(method => policyOf(method) === 'owner')
    expect(ownerMethods.length).toBeGreaterThan(0)
    for (const method of ownerMethods) {
      expect({ method, ...await call(recordingApi([]), method, other) })
        .toEqual({ method, ok: false, code: 'forbidden' })
      expect({ method, ...await call(recordingApi([]), method, owner) }).toEqual({ method, ok: true })
    }
  })

  it('admits any authenticated account on every user row', async () => {
    for (const method of UNARY_METHODS.filter(method => policyOf(method) === 'user')) {
      expect({ method, ...await call(recordingApi([]), method, other) }).toEqual({ method, ok: true })
    }
  })

  it('serves every method as the local principal when no authorization is supplied', async () => {
    const handler = toFetchHandler(recordingApi([]))
    for (const method of UNARY_METHODS) {
      const response = await handler.fetch(new Request(`http://dsh.internal/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: RpcId('t-local'), method, payload: PAYLOADS[method] ?? {} }),
      }))
      const body = await response.json() as { result: { ok: boolean } }
      expect({ method, ok: body.result.ok }).toEqual({ method, ok: true })
    }
  })
})

describe('the download face', () => {
  it('applies the owner policy to the session-log export', async () => {
    const api = {
      downloads: { sessionLog: () => Promise.resolve(new Response('zip')) },
    } as unknown as ApiProxy
    const url = 'http://dsh.internal/api/session.export?sessionId=s-1'
    const refused = await toFetchHandler(api, { principalFor: () => other, ownership: ownedByOwner })
      .fetch(new Request(url))
    expect(refused.status).toBe(403)
    const served = await toFetchHandler(api, { principalFor: () => owner, ownership: ownedByOwner })
      .fetch(new Request(url))
    expect(served.status).toBe(200)
  })
})
