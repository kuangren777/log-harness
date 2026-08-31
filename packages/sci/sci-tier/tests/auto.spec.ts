// The auto composition through the real registry: the resolution lock (G0),
// the latch it hands over to once the model resolves to cluster, the raise
// mid-session, and the record `resolve_tier` leaves. The studied platform bound
// the tier before the task was known (`clawsgo-analysis/CLAWSGO-SCHEDULING.md`
// §1.2); every case here is one step of the task-driven alternative (§6.1).
import { describe, expect, it } from 'vitest'
import { randomPlanId } from '@deepseek-ai/dsh-sci-plan'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RESOLVE_TOOL, SECTION_TIER_AUTO, SECTION_TIER_BALANCED, SECTION_TIER_CLUSTER, describeResolveTool } from '../src/index.ts'
import * as SciTierResolve from '../src/resolve.ts'
import { call, eventsOf, harness, logCall, text } from './harness.ts'
import type { Harness } from './harness.ts'

const AUTO = { tier: 'auto' as const, fanoutTools: ['workflow', 'subagent'] }

/** An auto harness with the resolution tool mounted beside the tier layer and one fan-out fixture. */
async function resolving(options: { seed?: readonly SessionEvent[]; sessionId?: string } = {}): Promise<Harness> {
  const booted = await harness(AUTO, { toolsAfter: ['workflow'], ...options })
  await booted.ctx.plugin(SciTierResolve)
  return booted
}

/** Resolve the harness's session the way the model does. */
async function resolve(booted: Harness, tier: 'balanced' | 'cluster', callId: string, reason = `the task needs ${tier}`): Promise<string> {
  return text(await call(booted, RESOLVE_TOOL, callId, { tier, reason }))
}

/** Declare a plan on the harness's session the way `sci-plan`'s tool does. */
function declare(booted: Harness): void {
  booted.session.append('sci/plan-declared', {
    planId: randomPlanId(),
    agents: [{ id: 'a', name: 'card a', icon: 'security', task: 'break the result' }],
    edges: [],
  })
}

/** Log one fan-out call and run it, as the agent loop would. */
async function fanOut(booted: Harness, callId: string): Promise<string> {
  logCall(booted, 'workflow', callId)
  return text(await call(booted, 'workflow', callId))
}

describe('the auto composition at session start', () => {
  it('records no tier on creation, since the model resolves it', async () => {
    const booted = await resolving()

    expect(eventsOf(booted.session, 'sci/tier-resolved')).toEqual([])
  })

  it('registers the auto section and neither fixed tier\'s', async () => {
    const booted = await resolving()

    const names = (await booted.ctx.systemPrompt.assemble({})).sections.map(section => section.name)

    expect(names).toContain(SECTION_TIER_AUTO)
    expect(names).not.toContain(SECTION_TIER_BALANCED)
    expect(names).not.toContain(SECTION_TIER_CLUSTER)
  })

  it('mounts the fan-out tools without the balanced tier\'s load-time refusal', async () => {
    await expect(harness(AUTO, { toolsBefore: ['workflow'] })).resolves.toBeDefined()
  })
})

describe('G0, the resolution lock', () => {
  it('refuses a fan-out before the tier is resolved and names resolve_tier', async () => {
    const booted = await resolving()

    const result = await fanOut(booted, 'call-1')

    expect(booted.ran).toEqual([])
    expect(result).toContain('Auto mode')
    expect(result).toContain('resolve_tier')
    const denials = eventsOf(booted.session, 'sci/tool-denied')
    expect(denials).toHaveLength(1)
    expect(denials[0]?.data).toMatchObject({ toolName: 'workflow', rule: 'unresolved' })
    expect(denials[0]?.ignorable).toBe(true)
  })

  it('refuses a fan-out in a session resolved to balanced, naming the raise as the exit', async () => {
    const booted = await resolving()

    await resolve(booted, 'balanced', 'resolve-1')
    const result = await fanOut(booted, 'call-1')

    expect(booted.ran).toEqual([])
    expect(result).toContain('resolved to the balanced tier')
    expect(result).toContain('resolve_tier again with cluster')
    expect(eventsOf(booted.session, 'sci/tool-denied')[0]?.data).toMatchObject({ rule: 'tier' })
  })

  it('hands a cluster-resolved session to the latch: declare, then fan out once', async () => {
    const booted = await resolving()

    await resolve(booted, 'cluster', 'resolve-1')
    const undeclared = await fanOut(booted, 'call-1')
    declare(booted)
    const first = await fanOut(booted, 'call-2')
    const second = await fanOut(booted, 'call-3')

    expect(undeclared).toContain('declare_research_plan has not been called')
    expect(first).toBe('ran workflow')
    expect(second).toContain('already consumed')
    expect(booted.ran).toEqual(['workflow'])
  })

  it('raises a balanced session to cluster mid-way and opens the gate', async () => {
    const booted = await resolving()

    await resolve(booted, 'balanced', 'resolve-1')
    expect(await fanOut(booted, 'call-1')).toContain('resolved to the balanced tier')
    await resolve(booted, 'cluster', 'resolve-2', 'the pilot showed the sweep needs six parallel runs')
    declare(booted)
    const result = await fanOut(booted, 'call-2')

    expect(result).toBe('ran workflow')
    expect(booted.session.events.flatMap(event => event.type === 'sci/tier-resolved' ? [event.data.tier] : [])).toEqual(['balanced', 'cluster'])
  })

  it('refuses a fan-out that carries no session', async () => {
    const booted = await resolving()

    const result = text(await call(booted, 'workflow', 'call-1', {}, false))

    expect(booted.ran).toEqual([])
    expect(result).toContain('not resolved yet')
  })

  it('leaves every other tool alone before resolution', async () => {
    const booted = await harness(AUTO, { toolsAfter: ['read'] })

    await call(booted, 'read', 'call-1')

    expect(booted.ran).toEqual(['read'])
  })
})

describe('G0 after a restart', () => {
  it('rebuilds the resolved tier from the log', async () => {
    const first = await resolving()
    await resolve(first, 'cluster', 'resolve-1')
    declare(first)
    const booted = await resolving({ seed: first.session.events, sessionId: 'reopened' })

    const result = await fanOut(booted, 'call-1')

    expect(result).toBe('ran workflow')
  })

  it('reads the LAST resolution, so a raise survives the restart', async () => {
    const first = await resolving()
    await resolve(first, 'balanced', 'resolve-1')
    await resolve(first, 'cluster', 'resolve-2')
    const booted = await resolving({ seed: first.session.events, sessionId: 'reopened' })

    const result = await fanOut(booted, 'call-1')

    expect(result).toContain('declare_research_plan has not been called')
    expect(result).not.toContain('resolved to the balanced tier')
  })
})

describe('resolve_tier', () => {
  it('records the resolution as a required-on-read event naming who resolved it and why', async () => {
    const booted = await resolving()

    const result = await resolve(booted, 'cluster', 'resolve-1', 'Reproducing the table needs six parallel runs.')

    const [event] = eventsOf(booted.session, 'sci/tier-resolved')
    expect(event?.ignorable).toBeUndefined()
    expect(event?.data).toEqual({
      tier: 'cluster',
      presetName: 'sci-auto',
      resolvedBy: 'model',
      reason: 'Reproducing the table needs six parallel runs.',
    })
    expect(result).toContain('Swarm mode')
    expect(result).toContain('declare_research_plan')
  })

  it('names the preset the session was actually composed from', async () => {
    const booted = await harness(AUTO, { agentPreset: 'sci-auto-eu' })
    await booted.ctx.plugin(SciTierResolve)

    await resolve(booted, 'balanced', 'resolve-1')

    expect(eventsOf(booted.session, 'sci/tier-resolved')[0]?.data).toMatchObject({ presetName: 'sci-auto-eu' })
  })

  it('tells a balanced resolution how to raise itself later', async () => {
    const booted = await resolving()

    const result = await resolve(booted, 'balanced', 'resolve-1')

    expect(result).toContain('Solo mode')
    expect(result).toContain('call resolve_tier again with cluster')
  })

  it('refuses to lower a cluster session to balanced', async () => {
    const booted = await resolving()

    await resolve(booted, 'cluster', 'resolve-1')
    const result = await call(booted, RESOLVE_TOOL, 'resolve-2', { tier: 'balanced', reason: 'changed my mind' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('only ever raised')
    expect(eventsOf(booted.session, 'sci/tier-resolved')).toHaveLength(1)
  })

  it('refuses a blank reason and a call with no session', async () => {
    const booted = await resolving()

    const blank = await call(booted, RESOLVE_TOOL, 'resolve-1', { tier: 'cluster', reason: '   ' })
    const orphan = await call(booted, RESOLVE_TOOL, 'resolve-2', { tier: 'cluster', reason: 'x' }, false)

    expect(text(blank)).toContain('needs a reason')
    expect(text(orphan)).toContain('requires an owning agent session')
    expect(eventsOf(booted.session, 'sci/tier-resolved')).toEqual([])
  })

  it('says in its description that a tier is only raised and that resolving opens the fan-out', () => {
    expect(describeResolveTool()).toContain('only ever raised')
    expect(describeResolveTool()).toContain('no fan-out tool runs')
  })
})
