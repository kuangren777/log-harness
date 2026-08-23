/**
 * Ownership filtering of the two event streams: which frames one account
 * observes, which it never learns about, and which arrive narrowed.
 */

import { describe, expect, it } from 'vitest'
import { LOCAL_PRINCIPAL, UserId, type Principal } from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { OwnershipLookup } from '../src/authorization.ts'
import { filterFrames } from '../src/frame-visibility.ts'
import type { HostFrame, MuxFrame } from '../src/api/events.ts'
import type { RpcRequest } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'

const OWNER = UserId('user-owner')
const owner: Principal = { kind: 'user', userId: OWNER, email: 'owner@example.test', groups: [], admin: false }
const admin: Principal = { kind: 'user', userId: UserId('user-admin'), email: 'admin@example.test', groups: [], admin: true }

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

/** Reads that count themselves, so the per-stream memo is observable. */
function ownership(reads: string[]): OwnershipLookup {
  return {
    ownerOfSession: (id) => {
      reads.push(`session:${String(id)}`)
      return Promise.resolve(String(id).startsWith('mine-') ? OWNER : undefined)
    },
    ownerOfWorkspace: (id) => {
      reads.push(`workspace:${String(id)}`)
      return Promise.resolve(String(id).startsWith('mine-') ? OWNER : undefined)
    },
  }
}

async function* source<F>(...frames: F[]): AsyncIterable<RpcRequest<F>> {
  for (const payload of frames) yield { rpcId: RpcId('t-frame'), payload }
}

async function collect<F>(stream: AsyncIterable<RpcRequest<F>>): Promise<F[]> {
  const seen: F[] = []
  for await (const request of stream) seen.push(request.payload)
  return seen
}

/** One frame of each mux variant, half owned and half not. */
const MUX_FRAMES: MuxFrame[] = [
  { type: 'session/event', sessionId: sid('mine-1'), event: { type: 'turn/end', seq: 1 } as MuxFrame extends { event: infer E } ? E : never },
  { type: 'session/subscribed', sessionId: sid('theirs-1'), lastSeq: 3 },
  { type: 'approval/requested', sessionId: sid('mine-1'), approvalId: 'a-1' as never, toolName: 'bash' },
  { type: 'approval/resolved', sessionId: sid('theirs-1'), approvalId: 'a-1' as never, outcome: 'rejected' as never },
  { type: 'question/requested', sessionId: sid('mine-1'), questions: [] },
  { type: 'question/resolved', sessionId: sid('theirs-1'), questionRpcId: RpcId('q'), outcome: 'answered' },
  { type: 'session/queue', sessionId: sid('mine-1'), items: [] },
  { type: 'session/jobs', sessionId: sid('theirs-1'), jobs: [] },
  { type: 'session/projection', sessionId: sid('mine-1'), key: 'k', value: 1, seq: 2 },
  { type: 'stream/error', error: { code: 'internal', message: 'boom', details: {} } },
]

describe('mux stream visibility', () => {
  it('delivers only the account\'s own sessions, and always its own stream failure', async () => {
    const reads: string[] = []
    const seen = await collect(filterFrames(source(...MUX_FRAMES), owner, ownership(reads)))
    expect(seen.map(frame => frame.type)).toEqual([
      'session/event', 'approval/requested', 'question/requested', 'session/queue',
      'session/projection', 'stream/error',
    ])
  })

  it('memoizes a resolved owner and re-reads an unresolved one', async () => {
    const reads: string[] = []
    await collect(filterFrames(
      source<MuxFrame>(
        { type: 'session/subscribed', sessionId: sid('mine-1'), lastSeq: 1 },
        { type: 'session/subscribed', sessionId: sid('mine-1'), lastSeq: 2 },
        { type: 'session/subscribed', sessionId: sid('theirs-1'), lastSeq: 1 },
        { type: 'session/subscribed', sessionId: sid('theirs-1'), lastSeq: 2 },
      ),
      owner,
      ownership(reads),
    ))
    // The owned session is read once; the unowned one is read every time,
    // because "no owner yet" is the state a session being created is in.
    expect(reads).toEqual(['session:mine-1', 'session:theirs-1', 'session:theirs-1'])
  })
})

const HOST_FRAMES: HostFrame[] = [
  { type: 'host/session-added', sessionId: sid('mine-1'), blank: true },
  { type: 'host/session-removed', sessionId: sid('theirs-1') },
  { type: 'host/session-status', sessionId: sid('mine-1'), running: true },
  { type: 'host/agent-error', sessionId: sid('theirs-1'), message: 'x' },
  {
    type: 'host/workspace-changed',
    workspace: {
      workspaceId: wid('mine-w'), path: '/p', title: 't', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  {
    type: 'host/workspace-changed',
    workspace: {
      workspaceId: wid('theirs-w'), path: '/q', title: 'u', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  { type: 'host/workspace-removed', workspaceId: wid('mine-w') },
  { type: 'host/workspace-removed', workspaceId: wid('theirs-w') },
  { type: 'host/workspace-order-changed', workspaceIds: [wid('mine-w'), wid('theirs-w')] },
  { type: 'host/archived-sessions-changed', archivedSessionIds: [sid('mine-1'), sid('theirs-1')] },
  { type: 'host/remote-event', event: 'some/event', args: [] },
  { type: 'stream/error', error: { code: 'internal', message: 'boom', details: {} } },
]

describe('host stream visibility', () => {
  it('drops foreign sessions and workspaces, narrows the set-carrying frames, and never forwards a raw host event', async () => {
    const seen = await collect(filterFrames(source(...HOST_FRAMES), owner, ownership([])))
    expect(seen).toEqual([
      HOST_FRAMES[0],
      HOST_FRAMES[2],
      HOST_FRAMES[4],
      HOST_FRAMES[6],
      { type: 'host/workspace-order-changed', workspaceIds: [wid('mine-w')] },
      { type: 'host/archived-sessions-changed', archivedSessionIds: [sid('mine-1')] },
      HOST_FRAMES[11],
    ])
  })

  it('passes the source through untouched for the local principal and for an administrator', async () => {
    const localReads: string[] = []
    expect(await collect(filterFrames(source(...HOST_FRAMES), LOCAL_PRINCIPAL, ownership(localReads))))
      .toEqual(HOST_FRAMES)
    const adminReads: string[] = []
    expect(await collect(filterFrames(source(...HOST_FRAMES), admin, ownership(adminReads))))
      .toEqual(HOST_FRAMES)
    // No ownership read at all: neither principal has an account boundary.
    expect([...localReads, ...adminReads]).toEqual([])
  })
})
