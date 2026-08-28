/**
 * The upgrade fork: `sci.tier.fork`, the Typert Remote endpoint a user
 * interface calls when the user accepts a `suggest_tier_upgrade` suggestion.
 *
 * `ctx.sessions.fork()` is deliberately NOT used. It copies the source log into
 * the child as seed history (`packages/core/session/src/index.ts:1091`), which
 * is the opposite of what an upgrade needs: the balanced session's transcript is
 * a record of work done WITHOUT a cluster, and replaying it into a cluster
 * session would spend the wider tier re-reading a single-threaded pass. The
 * child is created empty instead, keeps the lineage in its header, and opens
 * with ONE synthesised message carrying the only three things the new tier needs
 * — what the user asked for, what already reached them, and why the previous
 * session thought a cluster would do better.
 *
 * A Service, and therefore host-plane: the package entry is a function plugin
 * that both agent presets mount, and a service published from there would
 * collide the moment the second preset mounted it.
 * @module @deepseek-ai/dsh-sci-tier/fork
 */

import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the services this service injects onto Context.
import type {} from '@deepseek-ai/dsh-session'
import { PRESET_NAMES } from './presets.ts'
import type { SciTier } from './types.ts'

/** Cordis service key and wire namespace prefix of the upgrade fork. */
export const SERVICE_KEY = 'sciTierFork'

/** Wire namespace the fork endpoint is exported under. */
export const FORK_NAMESPACE = 'sci.tier'

/**
 * Event type carrying a delivered file's title.
 *
 * Typed as `string` rather than a `SessionEventMap` key on purpose:
 * `@deepseek-ai/dsh-sci-deliver` owns the event, and the fork reads it without
 * depending on that package so a deployment that mounts tiers without delivery
 * still forks — with no delivered line.
 */
const DELIVERED_EVENT: string = 'sci/delivered'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciTierFork: SciTierForkService
  }
}

/** What one `sci.tier.fork` call asks for. */
export interface SciTierForkRequest {
  /** The session to continue from; it must still be live in this process. */
  readonly sessionId: SessionId
  /** The tier the new session runs at. */
  readonly tier: SciTier
}

/** What one accepted fork produced. */
export interface SciTierForkValue {
  /** Identity of the new session, whose header names the source as its parent. */
  readonly sessionId: SessionId
  /** Agent preset the new session is composed from. */
  readonly presetName: string
}

/** Why one fork was refused. */
export interface SciTierForkError {
  /**
   * `session-not-found` — no live session carries that id. `same-tier` — the
   * request names the tier the source already runs at, which would fork a
   * session into a copy of itself.
   */
  readonly code: 'session-not-found' | 'same-tier'
  /** The session the request named. */
  readonly sessionId: SessionId
}

/** The outcome of one `sci.tier.fork` call. */
export type SciTierForkResult =
  | { readonly ok: true; readonly value: SciTierForkValue }
  | { readonly ok: false; readonly error: SciTierForkError }

/**
 * Read the title of one delivery event without depending on its owning package.
 * @param event - a raw log event.
 * @returns the delivered file's title, or `undefined` for any other event.
 */
function deliveredTitle(event: SessionEvent): string | undefined {
  if (event.type !== DELIVERED_EVENT) return undefined
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const title: unknown = (data as { title?: unknown }).title
  return typeof title === 'string' && title.length > 0 ? title : undefined
}

/** The visible text of one user message's content blocks. */
function visibleText(event: SessionEvent<'user/message'>): string {
  return event.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * Compose the opening message of an upgraded session from the source log.
 *
 * The request is the last message the HUMAN typed, not the last message on the
 * surface: a plugin context or a tool result is not what the user asked for, and
 * opening the new session with one would hand the cluster a reminder to work on.
 * @param events - the source session's events in log order.
 * @returns the opening message text; empty when the source carried no human request.
 */
export function composeForkOpening(events: readonly SessionEvent[]): string {
  let request = ''
  let reason = ''
  const deliveries: string[] = []
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      request = visibleText(event)
    }
    if (event.type === 'sci/tier-upgrade-suggested') reason = event.data.reason
    const title = deliveredTitle(event)
    if (title !== undefined) deliveries.push(title)
  }
  const lines = [request]
  if (deliveries.length > 0) {
    lines.push(`Already delivered in the previous session: ${deliveries.join(', ')}. Do not redeliver these unless the work changes them.`)
  }
  if (reason !== '') lines.push(`The previous session asked for Swarm mode because: ${reason}`)
  return lines.filter(line => line !== '').join('\n\n')
}

/**
 * The upgrade fork endpoint. It creates and opens sessions; it never runs one,
 * and it reads nothing but the source session's own log.
 */
export class SciTierForkService extends TypertRemoteService {
  static inject = ['sessions']

  /**
   * @param ctx - Host context carrying the session store.
   */
  constructor(ctx: Context) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // FORK_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciTierFork', { namespace: 'sci.tier' })
  }

  /**
   * Continue one session's work at another tier, in a new session.
   * @param request - the session to continue from and the tier to continue at.
   * @returns the new session's identity and preset, or why the fork was refused.
   */
  @Remote('fork')
  fork(request: SciTierForkRequest): SciTierForkResult {
    const source = this.ctx.sessions.get(request.sessionId)
    if (source === undefined) {
      return { ok: false, error: { code: 'session-not-found', sessionId: request.sessionId } }
    }
    const presetName = PRESET_NAMES[request.tier]
    if (source.header.agentPreset === presetName) {
      return { ok: false, error: { code: 'same-tier', sessionId: request.sessionId } }
    }
    const created = this.ctx.sessions.create(undefined, {
      meta: {
        ...source.header.cwd === undefined ? {} : { cwd: source.header.cwd },
        parentSession: source.id,
        agentPreset: presetName,
      },
    })
    // Sourced as the user's own message: it carries the request the user made,
    // and the new session's first turn has to act on it rather than read it as
    // a notice about work someone else is doing.
    created.append('user/message', createUserMessage({
      content: [{ type: 'text', text: composeForkOpening(source.events) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    return { ok: true, value: { sessionId: created.id, presetName } }
  }
}

export default SciTierForkService
