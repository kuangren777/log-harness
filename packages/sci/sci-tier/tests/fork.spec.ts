// The upgrade fork's whole contract is what the new session starts with: the
// user's own request, what already reached them, and why the previous session
// asked for a cluster — and nothing else from the old log. 05-T5's remaining
// assertions (the assembled application, a real preset) belong to
// `@deepseek-ai/dsh-sci-profile`.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SciTierForkService, { composeForkOpening } from '../src/fork.ts'
import { FORK_NAMESPACE, SERVICE_KEY } from '../src/index.ts'

/** Append one user-authored request to a session. */
function request(session: Session, textBody: string, kind: 'user' | 'plugin' = 'user'): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: textBody }],
    source: kind === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'sci-deliver' },
  }), { surfaceOp: 'append' })
}

/** Append one delivery record the way `@deepseek-ai/dsh-sci-deliver` writes it. */
function delivered(session: Session, title: unknown): void {
  // Written through the type-erased overload on purpose: this package reads the
  // event structurally so a deployment without the delivery layer still forks.
  const append = session.append.bind(session) as (type: string, data: unknown, opts: unknown) => void
  append('sci/delivered', { deliveryId: 'd1', path: '/p', sha256: 'x', size: 1, title, kind: 'file', via: 'tool' }, { ignorable: true })
}

/** A detached source session carrying one request. */
function source(): Session {
  const session = Session.create(SessionId('balanced-source'))
  session.append('sci/tier-resolved', { tier: 'balanced', presetName: 'sci-balanced' })
  return session
}

describe('composeForkOpening', () => {
  it('carries the last human request, the deliveries, and the reason', () => {
    const session = source()
    request(session, 'Compare the six vendors.')
    delivered(session, 'vendor-overview.md')
    delivered(session, 'pricing.csv')
    session.append('sci/tier-upgrade-suggested', { reason: 'each vendor needs its own close reading' }, { ignorable: true })

    expect(composeForkOpening(session.events)).toMatchInlineSnapshot(`
      "Compare the six vendors.

      Already delivered in the previous session: vendor-overview.md, pricing.csv. Do not redeliver these unless the work changes them.

      The previous session asked for Swarm mode because: each vendor needs its own close reading"
    `)
  })

  it('takes the last human request, not the last message on the surface', () => {
    const session = source()
    request(session, 'Compare the six vendors.')
    request(session, 'Also include pricing.')
    request(session, 'A delivery failed.', 'plugin')

    expect(composeForkOpening(session.events)).toBe('Also include pricing.')
  })

  it('omits the lines a session has nothing to say on', () => {
    const session = source()
    request(session, 'Compare the six vendors.')

    expect(composeForkOpening(session.events)).toBe('Compare the six vendors.')
  })

  it('is empty for a session that carries no human request', () => {
    expect(composeForkOpening(source().events)).toBe('')
  })

  it('skips a delivery record whose title is not usable text', () => {
    const session = source()
    request(session, 'Compare the six vendors.')
    delivered(session, '')
    delivered(session, 42)

    expect(composeForkOpening(session.events)).toBe('Compare the six vendors.')
  })

  it('skips a delivery record with no payload object at all', () => {
    const session = Session.create(SessionId('odd'))
    const append = session.append.bind(session) as (type: string, data: unknown, opts: unknown) => void
    append('sci/delivered', null, { ignorable: true })

    expect(composeForkOpening(session.events)).toBe('')
  })
})

describe('sci.tier.fork', () => {
  /** A live store with the fork service mounted and one balanced source session. */
  async function booted(): Promise<{ ctx: Context; live: Session }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SciTierForkService)
    const live = ctx.sessions.create(SessionId('balanced-live'), { meta: { cwd: '/w', agentPreset: 'sci-balanced' } })
    request(live, 'Compare the six vendors.')
    live.append('sci/tier-upgrade-suggested', { reason: 'six independent readings' }, { ignorable: true })
    return { ctx, live }
  }

  it('opens an empty session whose header names the source', async () => {
    const { ctx, live } = await booted()

    const result = ctx.sciTierFork.fork({ sessionId: live.id, tier: 'cluster' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const forked = ctx.sessions.get(result.value.sessionId)
    expect(result.value.presetName).toBe('sci-cluster')
    expect(forked?.header.parentSession).toBe(live.id)
    expect(forked?.header.agentPreset).toBe('sci-cluster')
    expect(forked?.header.cwd).toBe('/w')
  })

  it('copies no event of the old session, only the synthesised opening', async () => {
    const { ctx, live } = await booted()

    const result = ctx.sciTierFork.fork({ sessionId: live.id, tier: 'cluster' })

    if (!result.ok) throw new Error('expected the fork to succeed')
    const forked = ctx.sessions.get(result.value.sessionId)
    const events = forked?.events ?? []
    expect(events.map((event: SessionEvent) => event.type)).toEqual(['user/message'])
    expect(composeForkOpening(events)).toContain('Compare the six vendors.')
    expect(composeForkOpening(events)).toContain('six independent readings')
  })

  it('carries a source with no working directory', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SciTierForkService)
    const live = ctx.sessions.create(SessionId('bare'))

    const result = ctx.sciTierFork.fork({ sessionId: live.id, tier: 'cluster' })

    if (!result.ok) throw new Error('expected the fork to succeed')
    expect(ctx.sessions.get(result.value.sessionId)?.header.cwd).toBeUndefined()
  })

  it('refuses a session this process does not hold', async () => {
    const { ctx } = await booted()

    expect(ctx.sciTierFork.fork({ sessionId: SessionId('gone'), tier: 'cluster' }))
      .toEqual({ ok: false, error: { code: 'session-not-found', sessionId: 'gone' } })
  })

  it('refuses a fork into the tier the session already runs at', async () => {
    const { ctx, live } = await booted()

    expect(ctx.sciTierFork.fork({ sessionId: live.id, tier: 'balanced' }))
      .toEqual({ ok: false, error: { code: 'same-tier', sessionId: live.id } })
  })

  it('publishes the service key and namespace its consumers navigate by', async () => {
    const { ctx } = await booted()

    expect(SERVICE_KEY).toBe('sciTierFork')
    expect(FORK_NAMESPACE).toBe('sci.tier')
    expect(ctx.get('sciTierFork')).toBeInstanceOf(SciTierForkService)
  })
})
