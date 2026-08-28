// The companion asserts the relation between what this package logs and the
// rule vocabulary it publishes, so both directions are exercised: a refusal the
// gate itself produced passes, and a forged rule id fails by name.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RULE_SKILLS_READ_ONLY } from '@deepseek-ai/dsh-sci-workspace'
import * as SciWorkspaceInvariant from '@deepseek-ai/dsh-sci-workspace/invariant'

/** One event of the given type, shaped as the log carries it. */
function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 1, time: 0 } as unknown as SessionEvent
}

describe('validateEvent', () => {
  it('accepts a refusal naming a published rule and ignores every other event type', () => {
    const fail = vi.fn<(message: string) => never>()
    SciWorkspaceInvariant.validateEvent(
      event('sci/fs-denied', { op: 'write', path: '/x', rule: RULE_SKILLS_READ_ONLY, reason: 'r' }),
      fail,
    )
    SciWorkspaceInvariant.validateEvent(event('turn/end', { turn: 1 }), fail)
    expect(fail).not.toHaveBeenCalled()
  })

  it('reports a rule id outside the published vocabulary', () => {
    const fail = vi.fn<(message: string) => never>()
    SciWorkspaceInvariant.validateEvent(
      event('sci/fs-denied', { op: 'write', path: '/x', rule: 'invented', reason: 'r' }),
      fail,
    )
    expect(fail).toHaveBeenCalledWith(expect.stringContaining('"invented"'))
  })
})

describe('the companion over the live session-event stream', () => {
  it('registers against the invariant registry and validates an appended refusal', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants, { enabled: true })
    await ctx.plugin(SessionStore)

    await expect(ctx.plugin(SciWorkspaceInvariant)).resolves.toBeDefined()

    const session = ctx.sessions.create(SessionId('invariant'))
    expect(() => session.append('sci/fs-denied', {
      op: 'write', path: '/x', rule: RULE_SKILLS_READ_ONLY, reason: 'r',
    }, { ignorable: true })).not.toThrow()

    await ctx.fiber.dispose()
  })
})
