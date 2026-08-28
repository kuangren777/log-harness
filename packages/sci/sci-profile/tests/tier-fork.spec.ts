/**
 * 05-T5, the half `@deepseek-ai/dsh-sci-tier` deferred to this package: the
 * upgrade fork lands on a preset this bundle actually ships, and the session it
 * opens carries the lineage and the synthesised opening rather than the old
 * transcript.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { PRESET_NAMES, SciTierForkService } from '@deepseek-ai/dsh-sci-tier'
import { BUNDLED_PRESET_ROOT, SCI_PRESETS } from '../src/index.ts'

/** A live balanced session that asked for an upgrade after delivering two files. */
async function balancedSession(): Promise<{ ctx: Context; live: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SciTierForkService)
  const live = ctx.sessions.create(SessionId('sci-balanced-live'), {
    meta: { cwd: '/home/user/sci/projects/vendors', agentPreset: 'sci-balanced' },
  })
  live.append('sci/tier-resolved', { tier: 'balanced', presetName: 'sci-balanced' })
  live.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Compare the six vendors.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const append = live.append.bind(live) as (type: string, data: unknown, opts: unknown) => void
  for (const title of ['vendor-overview.md', 'pricing.csv']) {
    append('sci/delivered', { deliveryId: title, path: `/p/${title}`, sha256: 'x', size: 1, title, kind: 'file', via: 'tool' }, { ignorable: true })
  }
  // One assistant turn of the old session, which the fork must NOT carry over.
  append('assistant/message', { content: [{ type: 'text', text: 'I read three of them.' }] }, { surfaceOp: 'append' })
  live.append('sci/tier-upgrade-suggested', { reason: 'each vendor needs its own close reading' }, { ignorable: true })
  return { ctx, live }
}

describe('05-T5 · the upgrade fork over the shipped presets', () => {
  it('names a preset directory this bundle ships', async () => {
    const roster = await discoverPresets([{ path: BUNDLED_PRESET_ROOT, trust: 'system' }])

    expect(roster.map(entry => entry.id).sort()).toEqual([...SCI_PRESETS])
    for (const entry of roster) expect(entry, entry.id).not.toHaveProperty('reason')
    for (const tier of ['balanced', 'cluster'] as const) {
      expect(SCI_PRESETS, tier).toContain(PRESET_NAMES[tier])
    }
  })

  it('opens a new session on sci-cluster, keeping only the lineage', async () => {
    const { ctx, live } = await balancedSession()

    const result = ctx.sciTierFork.fork({ sessionId: live.id, tier: 'cluster' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const forked = ctx.sessions.get(result.value.sessionId)
    expect(forked?.header.parentSession).toBe(live.id)
    expect(forked?.header.agentPreset).toBe('sci-cluster')
    expect(forked?.header.cwd).toBe('/home/user/sci/projects/vendors')
    // The source's own events stay in the source: the balanced transcript is a
    // record of work done WITHOUT a cluster, and replaying it would spend the
    // wider tier re-reading a single-threaded pass.
    expect(forked?.events.map(event => event.type)).toEqual(['user/message'])
  })

  it('carries the delivered titles into the synthesised first message', async () => {
    const { ctx, live } = await balancedSession()

    const result = ctx.sciTierFork.fork({ sessionId: live.id, tier: 'cluster' })

    if (!result.ok) throw new Error(`expected the fork to succeed, got ${result.error.code}`)
    const opening = JSON.stringify(ctx.sessions.get(result.value.sessionId)?.events)
    expect(opening).toContain('Compare the six vendors.')
    expect(opening).toContain('vendor-overview.md, pricing.csv')
    expect(opening).toContain('each vendor needs its own close reading')
    expect(opening).not.toContain('I read three of them.')
  })
})
