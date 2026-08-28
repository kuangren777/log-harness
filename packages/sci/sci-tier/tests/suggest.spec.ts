// `suggest_tier_upgrade` is the balanced tier's only exit, so its schema, the
// record it leaves, and what it tells the model afterwards are pinned through
// the real registry. The record is what a user interface turns into an upgrade
// button and what `sci.tier.fork` quotes into the new session.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SUGGEST_TOOL, describeSuggestTool } from '../src/index.ts'
import * as SciTierSuggest from '../src/suggest.ts'
import { call, eventsOf, harness, text } from './harness.ts'
import type { Harness } from './harness.ts'

const BALANCED = { tier: 'balanced' as const, fanoutTools: ['workflow'] }

/** A balanced harness with the suggestion tool mounted beside the tier layer. */
async function suggesting(): Promise<Harness> {
  const booted = await harness(BALANCED)
  await booted.ctx.plugin(SciTierSuggest)
  return booted
}

describe('suggest_tier_upgrade', () => {
  it('records the suggestion as an ignorable log entry', async () => {
    const booted = await suggesting()

    const result = await call(booted, SUGGEST_TOOL, 'call-1', { reason: 'Six vendors need independent close reading.' })

    expect(result.isError).toBe(false)
    const [suggested] = eventsOf(booted.session, 'sci/tier-upgrade-suggested')
    expect(suggested?.data).toEqual({ reason: 'Six vendors need independent close reading.' })
    expect(suggested?.ignorable).toBe(true)
  })

  it('tells the model the session did not change tier', async () => {
    const booted = await suggesting()

    const result = text(await call(booted, SUGGEST_TOOL, 'call-1', { reason: 'Coverage needs six parallel readers.' }))

    expect(result).toContain('stays in Solo mode')
    expect(result).toContain('Coverage needs six parallel readers.')
  })

  it('trims the reason the model wrote', async () => {
    const booted = await suggesting()

    await call(booted, SUGGEST_TOOL, 'call-1', { reason: '  needs six readers  ' })

    expect(eventsOf(booted.session, 'sci/tier-upgrade-suggested')[0]?.data).toEqual({ reason: 'needs six readers' })
  })

  it('refuses a blank reason, which would leave the user nothing to decide on', async () => {
    const booted = await suggesting()

    const result = await call(booted, SUGGEST_TOOL, 'call-1', { reason: '   ' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('needs a reason')
    expect(eventsOf(booted.session, 'sci/tier-upgrade-suggested')).toHaveLength(0)
  })

  it('refuses a call with no owning session to record it on', async () => {
    const booted = await suggesting()

    const result = await call(booted, SUGGEST_TOOL, 'call-1', { reason: 'needs six readers' }, false)

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an owning agent session')
  })

  it('says what it does not do, so the model does not wait for a swarm', () => {
    expect(describeSuggestTool()).toContain('does not change the current session')
  })

  it('renders as a plain card, since the suggestion has no locations to show', async () => {
    const booted = await suggesting()

    expect(booted.ctx.tools.get(SUGGEST_TOOL)?.presentCall?.({ reason: 'six independent readings' }))
      .toEqual({ card: 'generic', title: 'Suggest Swarm mode' })
  })

  it('mounts on its own, without the tier layer, as the balanced preset composes it', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    await ctx.plugin(SciTierSuggest)

    expect(ctx.tools.get(SUGGEST_TOOL)).toBeDefined()
    expect(SciTierSuggest.name).toBe('sci-tier-suggest')
    expect(SciTierSuggest.inject).toEqual(['tools'])
  })
})
