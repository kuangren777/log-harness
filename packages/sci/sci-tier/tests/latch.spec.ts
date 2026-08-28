// `rebuildLatch` is what makes a restart invisible to the gate, so it is pinned
// as a pure fold over literal logs rather than only through the composed gate:
// the composed cases prove the gate consults it, these prove it reads a log the
// way a replay does.
import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { randomPlanId } from '@deepseek-ai/dsh-sci-plan'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { denyBalanced, denyConsumed, denyUndeclared, rebuildLatch } from '../src/index.ts'

const FANOUT: ReadonlySet<string> = new Set(['workflow', 'subagent'])

/** Build one log by appending the given writes to a detached session. */
function log(writes: readonly ((session: Session) => void)[]): readonly SessionEvent[] {
  const session = Session.create(SessionId('latch'))
  for (const write of writes) write(session)
  return session.events
}

/** Append one plan declaration and report the id it minted. */
function declared(): { write: (session: Session) => void; planId: string } {
  const planId = randomPlanId()
  return {
    planId,
    write: (session) => {
      session.append('sci/plan-declared', { planId, agents: [], edges: [] })
    },
  }
}

/** Append the `tool/call` the agent loop writes before a dispatch. */
function called(name: string, callId: string): (session: Session) => void {
  return (session) => {
    session.append('tool/call', { turn: 1, step: 1, callId: CallId(callId), name, arguments: '{}' })
  }
}

describe('rebuildLatch', () => {
  it('finds nothing in a log with no declaration', () => {
    expect(rebuildLatch(log([called('workflow', 'c1')]), FANOUT)).toBeUndefined()
  })

  it('recovers an unspent declaration', () => {
    const plan = declared()

    expect(rebuildLatch(log([plan.write]), FANOUT)).toEqual({ planId: plan.planId, consumed: false })
  })

  it('marks a declaration spent by a later fan-out', () => {
    const plan = declared()

    expect(rebuildLatch(log([plan.write, called('workflow', 'c1')]), FANOUT))
      .toEqual({ planId: plan.planId, consumed: true })
  })

  it('ignores a fan-out that happened before the declaration', () => {
    const plan = declared()

    expect(rebuildLatch(log([called('workflow', 'c1'), plan.write]), FANOUT))
      .toEqual({ planId: plan.planId, consumed: false })
  })

  it('ignores a call to a tool that is not a fan-out', () => {
    const plan = declared()

    expect(rebuildLatch(log([plan.write, called('read', 'c1')]), FANOUT))
      .toEqual({ planId: plan.planId, consumed: false })
  })

  it('carries the last declaration, unspent, when a new one follows a spent one', () => {
    const first = declared()
    const second = declared()

    expect(rebuildLatch(log([first.write, called('workflow', 'c1'), second.write]), FANOUT))
      .toEqual({ planId: second.planId, consumed: false })
  })

  it('excludes the call being decided right now', () => {
    const plan = declared()
    const events = log([plan.write, called('workflow', 'c1')])

    expect(rebuildLatch(events, FANOUT, CallId('c1'))).toEqual({ planId: plan.planId, consumed: false })
    expect(rebuildLatch(events, FANOUT, CallId('c2'))).toEqual({ planId: plan.planId, consumed: true })
  })
})

describe('the refusal texts', () => {
  it('point an undeclared fan-out at the declaration tool', () => {
    expect(denyUndeclared('workflow')).toContain('declare_research_plan')
    expect(denyUndeclared('workflow')).toMatch(/^workflow is refused/)
  })

  it('tell a spent fan-out to declare again', () => {
    expect(denyConsumed('subagent')).toContain('declare_research_plan')
    expect(denyConsumed('subagent')).toContain('One declaration authorizes one fan-out')
  })

  it('give the balanced tier its one legitimate exit', () => {
    expect(denyBalanced('workflow')).toContain('suggest_tier_upgrade')
    expect(denyBalanced('workflow')).not.toContain('declare_research_plan')
  })
})
