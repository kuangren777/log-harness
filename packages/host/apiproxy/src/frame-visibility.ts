/**
 * Ownership filtering for the two server-to-browser event streams.
 *
 * Both streams subscribe every session and every workspace on the host, so a
 * multi-user deployment cannot secure them by refusing the connection: one
 * account's stream would still carry another account's conversation. Each
 * frame is therefore decided on its way out — dropped when it belongs to
 * someone else, and narrowed when it carries a set (an order or an archive
 * snapshot) that spans accounts.
 *
 * Filtering happens between the queue and the carrier rather than at
 * `queue.push`, because deciding a frame needs an asynchronous ownership read
 * and every producer inside the gateway pushes synchronously.
 * @module @deepseek-ai/dsh-host-apiproxy/frame-visibility
 */

import type { Principal, UserId } from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { HostFrame, MuxFrame } from './api/events.ts'
import type { RpcRequest } from './api/rpc.ts'
import type { OwnershipLookup } from './authorization.ts'

/** Either stream's frame union. */
type Frame = MuxFrame | HostFrame

/**
 * Per-stream ownership reads with a positive-only memo.
 *
 * A recorded owner never changes — this seam has no transfer operation — so a
 * resolved account is cached for the life of the stream. An unresolved one is
 * not: a session whose ownership row is still being written would otherwise
 * stay invisible to its own creator for as long as the stream lives.
 */
class OwnerResolver {
  private readonly sessions = new Map<SessionId, UserId>()
  private readonly workspaces = new Map<WorkspaceId, UserId>()

  constructor(
    private readonly principal: Principal,
    private readonly ownership: OwnershipLookup,
  ) {}

  /**
   * Whether the principal owns one agent session.
   * @param sessionId - the session a frame is about.
   * @returns whether the frame may be delivered on that session's account.
   */
  async ownsSession(sessionId: SessionId): Promise<boolean> {
    const cached = this.sessions.get(sessionId)
    if (cached !== undefined) return this.holds(cached)
    const owner = await this.ownership.ownerOfSession(sessionId)
    if (owner === undefined) return false
    this.sessions.set(sessionId, owner)
    return this.holds(owner)
  }

  /**
   * Whether the principal owns one workspace.
   * @param workspaceId - the workspace a frame is about.
   * @returns whether the frame may be delivered on that workspace's account.
   */
  async ownsWorkspace(workspaceId: WorkspaceId): Promise<boolean> {
    const cached = this.workspaces.get(workspaceId)
    if (cached !== undefined) return this.holds(cached)
    const owner = await this.ownership.ownerOfWorkspace(workspaceId)
    if (owner === undefined) return false
    this.workspaces.set(workspaceId, owner)
    return this.holds(owner)
  }

  private holds(owner: UserId): boolean {
    return this.principal.kind === 'user' && this.principal.userId === owner
  }
}

/** Retain only the members of a set the principal owns. */
async function ownedOnly<T>(values: readonly T[], owns: (value: T) => Promise<boolean>): Promise<T[]> {
  const kept: T[] = []
  for (const value of values) {
    if (await owns(value)) kept.push(value)
  }
  return kept
}

/**
 * Decide one frame for one principal: the same frame, a narrowed copy, or
 * nothing.
 *
 * `stream/error` always passes — it reports the caller's own stream failing,
 * and suppressing it would turn a failure into a silent stall.
 * `host/remote-event` never passes to a non-administrator: it forwards an
 * allowlisted host event verbatim, with no session or workspace to relate it
 * to any account.
 */
async function visibleFrame(frame: Frame, resolver: OwnerResolver): Promise<Frame | undefined> {
  switch (frame.type) {
    case 'stream/error':
      return frame
    case 'session/event':
    case 'session/subscribed':
    case 'approval/requested':
    case 'approval/resolved':
    case 'question/requested':
    case 'question/resolved':
    case 'session/queue':
    case 'session/jobs':
    case 'session/projection':
    case 'host/session-added':
    case 'host/session-removed':
    case 'host/session-status':
    case 'host/agent-error':
      return await resolver.ownsSession(frame.sessionId) ? frame : undefined
    case 'host/workspace-changed':
      return await resolver.ownsWorkspace(frame.workspace.workspaceId) ? frame : undefined
    case 'host/workspace-removed':
      return await resolver.ownsWorkspace(frame.workspaceId) ? frame : undefined
    case 'host/workspace-order-changed':
      return {
        ...frame,
        workspaceIds: await ownedOnly(frame.workspaceIds, id => resolver.ownsWorkspace(id)),
      }
    case 'host/archived-sessions-changed':
      return {
        ...frame,
        archivedSessionIds: await ownedOnly(frame.archivedSessionIds, id => resolver.ownsSession(id)),
      }
    case 'host/remote-event':
      return undefined
  }
}

/**
 * Wrap one stream so it delivers only what its principal may see.
 *
 * A `local` principal and an administrator pass the source through untouched:
 * neither has an account boundary to enforce, and per-frame ownership reads
 * would be pure cost.
 * @param frames - the gateway's unfiltered stream.
 * @param principal - the principal the stream was opened for.
 * @param ownership - the ownership resolution to consult.
 * @returns the stream this principal may observe.
 */
export function filterFrames<F extends Frame>(
  frames: AsyncIterable<RpcRequest<F>>,
  principal: Principal,
  ownership: OwnershipLookup,
): AsyncIterable<RpcRequest<F>> {
  if (principal.kind === 'local' || principal.admin) return frames
  const resolver = new OwnerResolver(principal, ownership)
  return (async function* filtered(): AsyncGenerator<RpcRequest<F>> {
    for await (const request of frames) {
      const payload = await visibleFrame(request.payload, resolver)
      // Narrowing a set-carrying frame rebuilds the same union member, so the
      // decided frame is always the source frame's own type.
      if (payload !== undefined) yield { rpcId: request.rpcId, payload: payload as F }
    }
  })()
}
