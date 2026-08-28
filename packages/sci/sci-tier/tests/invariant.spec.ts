// The invariant reads what the gates cannot: a log written by a composition
// assembled WITHOUT the balanced lock. Its whole job is to separate a gate that
// refused a fan-out from a gate that was never there, so both shapes are pinned
// against the same session.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import Invariants from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SciTier } from '../src/index.ts'
import * as SciTierInvariant from '../src/invariant.ts'
import { validateToolResult } from '../src/invariant.ts'

/** A session already resolved to one tier, or to none at all. */
function session(tier?: SciTier): Session {
  const live = Session.create(SessionId('sci-tier-invariant'))
  if (tier !== undefined) live.append('sci/tier-resolved', { tier, presetName: `sci-${tier}` })
  return live
}

/** Log the call and the result the agent loop writes around one dispatch. */
function dispatched(live: Session, name: string, callId: string, isError: boolean): SessionEvent {
  live.append('tool/call', { turn: 1, step: 1, callId: CallId(callId), name, arguments: '{}' })
  return live.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: CallId(callId), content: [{ type: 'text', text: 'done' }], isError }),
  }, { surfaceOp: 'append', sourceEventSeqs: [live.events.length - 1] })
}

/** Run the check over one appended event and collect what it reported. */
function check(live: Session, event: SessionEvent): string[] {
  const failures: string[] = []
  // The reporter's declared `never` return marks a real installer's throw; a
  // recording double has to collect instead, which is the one cast this suite needs.
  const fail = ((message: string) => { failures.push(message) }) as unknown as InvariantFailure
  validateToolResult(live, event, fail)
  return failures
}

describe('the balanced-tier invariant', () => {
  it('reports a fan-out that succeeded in a balanced session', () => {
    const live = session('balanced')

    const failures = check(live, dispatched(live, 'workflow', 'c1', false))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('"workflow"')
    expect(failures[0]).toContain('balanced tier')
  })

  it('accepts a fan-out the gate refused', () => {
    const live = session('balanced')

    expect(check(live, dispatched(live, 'workflow', 'c1', true))).toEqual([])
  })

  it('accepts a fan-out in a cluster session', () => {
    const live = session('cluster')

    expect(check(live, dispatched(live, 'workflow', 'c1', false))).toEqual([])
  })

  it('accepts a fan-out in a session no tier was ever resolved for', () => {
    const live = session()

    expect(check(live, dispatched(live, 'workflow', 'c1', false))).toEqual([])
  })

  it('accepts every tool that is not a fan-out', () => {
    const live = session('balanced')

    expect(check(live, dispatched(live, 'read', 'c1', false))).toEqual([])
  })

  it('accepts a result whose call is not in this log', () => {
    const live = session('balanced')
    const orphan = live.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: CallId('missing'), content: [{ type: 'text', text: 'done' }], isError: false }),
    }, { surfaceOp: 'append', sourceEventSeqs: [0] })

    expect(check(live, orphan)).toEqual([])
  })

  it('ignores every event that is not a tool result', () => {
    const live = session('balanced')
    const event = live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    expect(check(live, event)).toEqual([])
  })
})

describe('the invariant companion', () => {
  it('reserves this package and reports through the session stream', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    const register = vi.spyOn(ctx.invariants, 'register')

    await ctx.plugin(SciTierInvariant)

    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-sci-tier', expect.any(Function))
    expect(SciTierInvariant.name).toBe('sci-tier-invariant')
    expect(SciTierInvariant.inject).toEqual(['invariants'])
  })
})
