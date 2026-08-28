// The two gates and the tier record, through the real tool registry and a real
// session store. Every case here is one of the acceptance assertions of
// `ClawsGO-System/09-Target-Architecture/05-tier-model.md` (T2, T3, T4, T6, T8,
// T9); T1 and T5 need the preset directories and the assembled application and
// belong to `@deepseek-ai/dsh-sci-profile`.
import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { PLAN_TOOL, randomPlanId } from '@deepseek-ai/dsh-sci-plan'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SECTION_TIER_BALANCED, SECTION_TIER_CLUSTER, TIER_SECTION_ORDER } from '../src/index.ts'
import { call, eventsOf, harness, logCall, text } from './harness.ts'
import type { Harness } from './harness.ts'

const BALANCED = { tier: 'balanced' as const, fanoutTools: ['workflow', 'subagent'] }
const CLUSTER = { tier: 'cluster' as const, fanoutTools: ['workflow', 'subagent'] }

/** Declare a plan on the harness's session the way `sci-plan`'s tool does. */
function declare(booted: Harness): void {
  booted.session.append('sci/plan-declared', {
    planId: randomPlanId(),
    agents: [{ id: 'a', name: 'card a', icon: 'search', task: 'read one slice' }],
    edges: [],
  })
}

/** Log one fan-out call and run it, as the agent loop would. */
async function fanOut(booted: Harness, callId: string, name = 'workflow'): Promise<string> {
  logCall(booted, name, callId)
  return text(await call(booted, name, callId))
}

describe('the tier record', () => {
  it('is the first sci event of a session and names the tier and preset (T6)', async () => {
    const booted = await harness(CLUSTER)

    const sci = booted.session.events.filter(event => event.type.startsWith('sci/'))
    expect(sci[0]?.type).toBe('sci/tier-resolved')
    expect(sci[0]?.data).toEqual({ tier: 'cluster', presetName: 'sci-cluster' })
    expect(sci[0]?.ignorable).toBeUndefined()
  })

  it('names the preset the session was actually composed from', async () => {
    const booted = await harness(BALANCED, { agentPreset: 'sci-balanced-eu' })

    expect(eventsOf(booted.session, 'sci/tier-resolved')[0]?.data)
      .toEqual({ tier: 'balanced', presetName: 'sci-balanced-eu' })
  })

  it('is not written twice when a stored session is reopened', async () => {
    const first = await harness(CLUSTER)

    const second = await harness(CLUSTER, { seed: first.session.events, sessionId: 'reopened' })

    expect(eventsOf(second.session, 'sci/tier-resolved')).toHaveLength(1)
  })

  it('registers the tier section its tier selects', async () => {
    const balanced = await harness(BALANCED)
    const cluster = await harness(CLUSTER)

    const balancedNames = (await balanced.ctx.systemPrompt.assemble({})).sections.map(section => section.name)
    const clusterNames = (await cluster.ctx.systemPrompt.assemble({})).sections.map(section => section.name)

    expect(balancedNames).toContain(SECTION_TIER_BALANCED)
    expect(balancedNames).not.toContain(SECTION_TIER_CLUSTER)
    expect(clusterNames).toContain(SECTION_TIER_CLUSTER)
    expect(TIER_SECTION_ORDER).toBe(170)
  })
})

describe('G2, the balanced tier lock', () => {
  it('denies a fan-out tool that reached the catalog anyway, and records the refusal (T2)', async () => {
    const booted = await harness(BALANCED, { toolsAfter: ['workflow'] })

    const result = await fanOut(booted, 'call-1')

    expect(booted.ran).toEqual([])
    expect(result).toContain('Solo mode')
    expect(result).toContain('suggest_tier_upgrade')
    const denials = eventsOf(booted.session, 'sci/tool-denied')
    expect(denials).toHaveLength(1)
    expect(denials[0]?.data).toMatchObject({ toolName: 'workflow', rule: 'tier', reason: result.replace('Error: ', '') })
    expect(denials[0]?.ignorable).toBe(true)
  })

  it('refuses to load when the catalog already carries a fan-out tool (T2)', async () => {
    await expect(harness(BALANCED, { toolsBefore: ['workflow'] }))
      .rejects.toThrow(/balanced tier mounts no fan-out tools, but "workflow"/)
  })

  it('names every fan-out tool the catalog already carries', async () => {
    await expect(harness(BALANCED, { toolsBefore: ['workflow', 'subagent'] }))
      .rejects.toThrow(/"workflow", "subagent"/)
  })

  it('denies a fan-out call that carries no session, with nothing to record it on', async () => {
    const booted = await harness(BALANCED, { toolsAfter: ['workflow'] })

    const result = text(await call(booted, 'workflow', 'call-1', {}, false))

    expect(booted.ran).toEqual([])
    expect(result).toContain('Solo mode')
    expect(eventsOf(booted.session, 'sci/tool-denied')).toHaveLength(0)
  })

  it('leaves every other tool alone', async () => {
    const booted = await harness(BALANCED, { toolsAfter: ['read'] })

    await call(booted, 'read', 'call-1')

    expect(booted.ran).toEqual(['read'])
  })
})

describe('G1, declare before you fan out', () => {
  it('refuses an undeclared fan-out and names the tool that authorizes it (T3)', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    const result = await fanOut(booted, 'call-1')

    expect(booted.ran).toEqual([])
    expect(result).toMatchInlineSnapshot('"Error: workflow is refused: declare_research_plan has not been called in this session. Declare the swarm first — name each parallel line of work and what it produces — then call workflow again."')
    expect(eventsOf(booted.session, 'sci/tool-denied')[0]?.data)
      .toMatchObject({ toolName: 'workflow', rule: 'plan' })
  })

  it('admits the fan-out that follows a declaration, and refuses the next one (T4)', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    declare(booted)
    const first = await fanOut(booted, 'call-1')
    const second = await fanOut(booted, 'call-2')

    expect(booted.ran).toEqual(['workflow'])
    expect(first).toBe('ran workflow')
    expect(second).toContain('already consumed by an earlier fan-out')
    expect(second).toContain('declare_research_plan')
  })

  it('admits a second fan-out after a second declaration', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    declare(booted)
    await fanOut(booted, 'call-1')
    declare(booted)
    await fanOut(booted, 'call-2')

    expect(booted.ran).toEqual(['workflow', 'workflow'])
  })

  it('admits exactly one of two fan-outs dispatched from the same step (T8)', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    declare(booted)
    logCall(booted, 'workflow', 'call-1')
    logCall(booted, 'workflow', 'call-2')
    const results = await Promise.all([
      call(booted, 'workflow', 'call-1'),
      call(booted, 'workflow', 'call-2'),
    ])

    expect(booted.ran).toEqual(['workflow'])
    expect(results.filter(result => result.isError)).toHaveLength(1)
    expect(results.map(text).join('\n')).toContain('already consumed by an earlier fan-out')
  })

  it('never refuses the declaration tool itself, even when a deployment lists it', async () => {
    const booted = await harness(
      { tier: 'cluster', fanoutTools: ['workflow', PLAN_TOOL] },
      { toolsAfter: [PLAN_TOOL] },
    )

    const result = await fanOut(booted, 'call-1', PLAN_TOOL)

    expect(booted.ran).toEqual([PLAN_TOOL])
    expect(result).toBe(`ran ${PLAN_TOOL}`)
  })

  it('refuses a fan-out that carries no session', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    declare(booted)
    const result = text(await call(booted, 'workflow', 'call-1', {}, false))

    expect(booted.ran).toEqual([])
    expect(result).toContain('has not been called in this session')
  })

  it('leaves every other tool alone', async () => {
    const booted = await harness(CLUSTER, { toolsAfter: ['read'] })

    await call(booted, 'read', 'call-1')

    expect(booted.ran).toEqual(['read'])
  })
})

describe('G1 after a restart', () => {
  /** The log a process that declared and then fanned out would have left behind. */
  async function spentLog(): Promise<readonly SessionEvent[]> {
    const first = await harness(CLUSTER, { toolsAfter: ['workflow'] })
    declare(first)
    await fanOut(first, 'call-1')
    return first.session.events
  }

  it('rebuilds a spent latch from the log and refuses the next fan-out (T9)', async () => {
    const booted = await harness(CLUSTER, { seed: await spentLog(), toolsAfter: ['workflow'] })

    const result = await fanOut(booted, 'call-2')

    expect(booted.ran).toEqual([])
    expect(result).toContain('already consumed by an earlier fan-out')
  })

  it('rebuilds an unspent latch and admits the fan-out it authorizes', async () => {
    const first = await harness(CLUSTER, { toolsAfter: ['workflow'] })
    declare(first)

    const booted = await harness(CLUSTER, { seed: first.session.events, toolsAfter: ['workflow'] })
    const result = await fanOut(booted, 'call-1')

    expect(booted.ran).toEqual(['workflow'])
    expect(result).toBe('ran workflow')
  })

  it('does not read the call being decided as an earlier fan-out', async () => {
    const first = await harness(CLUSTER, { toolsAfter: ['workflow'] })
    declare(first)
    const booted = await harness(CLUSTER, { seed: first.session.events, toolsAfter: ['workflow'] })

    // The loop logs `tool/call` before dispatch, so the very first fan-out of a
    // restarted process finds its own call already in the log it rebuilds from.
    booted.session.append('tool/call', { turn: 1, step: 1, callId: CallId('call-1'), name: 'workflow', arguments: '{}' })
    const result = text(await call(booted, 'workflow', 'call-1'))

    expect(result).toBe('ran workflow')
  })

  it('rebuilds nothing for a session that never declared a plan', async () => {
    const first = await harness(CLUSTER, { toolsAfter: ['workflow'] })

    const booted = await harness(CLUSTER, { seed: first.session.events, toolsAfter: ['workflow'] })
    const result = await fanOut(booted, 'call-1')

    expect(result).toContain('has not been called in this session')
  })
})
