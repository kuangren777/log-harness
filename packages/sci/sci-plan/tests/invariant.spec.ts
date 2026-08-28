// The companion checks the committed log rather than the mint: the tool's own
// path cannot produce a repeated plan id, so a repeat means a replayed payload
// or a broken identity source — and either one hands `sci-tier`'s latch a token
// it has already spent, authorizing a second fan-out.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciPlanInvariant from '@deepseek-ai/dsh-sci-plan/invariant'
import { validatePlanDeclared } from '@deepseek-ai/dsh-sci-plan/src/invariant.ts'
import { SciPlanId } from '@deepseek-ai/dsh-sci-plan'
// `SciPlanIdType` is the branded id; the package exports the same name as a
// value (the minting function) and could not re-export the type unaliased.
import type { SciPlanDeclaredData, SciPlanIdType } from '@deepseek-ai/dsh-sci-plan'

/**
 * Build a reporter that records instead of throwing, so one call site can
 * assert both the accepting and the rejecting paths.
 * @returns the reporter and the messages it has recorded.
 */
function reporter(): { fail: InvariantFailure; messages: string[] } {
  const messages: string[] = []
  const fail = ((message: string) => { messages.push(message) }) as unknown as InvariantFailure
  return { fail, messages }
}

/** Append one declaration carrying the given plan id. */
function declare(session: Session, planId: SciPlanIdType): SessionEvent {
  const declared: SciPlanDeclaredData = {
    planId,
    agents: [{ id: 'a', name: 'card a', icon: 'code', task: 'do a' }],
    edges: [],
  }
  return session.append('sci/plan-declared', declared)
}

describe('sci-plan unique-plan-identity invariant', () => {
  it('accepts the first declaration of a plan id', () => {
    const session = Session.create(SessionId('sci-plan-invariant-first'))
    const { fail, messages } = reporter()

    validatePlanDeclared(session, declare(session, SciPlanId('p1')), fail)

    expect(messages).toEqual([])
  })

  it('accepts a second declaration that mints its own id', () => {
    const session = Session.create(SessionId('sci-plan-invariant-distinct'))
    declare(session, SciPlanId('p1'))
    const { fail, messages } = reporter()

    validatePlanDeclared(session, declare(session, SciPlanId('p2')), fail)

    expect(messages).toEqual([])
  })

  it('rejects a plan id declared twice in one session', () => {
    const session = Session.create(SessionId('sci-plan-invariant-twice'))
    declare(session, SciPlanId('p1'))
    const { fail, messages } = reporter()

    validatePlanDeclared(session, declare(session, SciPlanId('p1')), fail)

    expect(messages).toEqual([
      expect.stringContaining('plan id "p1" was declared twice in one session'),
    ])
  })

  it('ignores every other event type', () => {
    const session = Session.create(SessionId('sci-plan-invariant-other'))
    const { fail, messages } = reporter()

    validatePlanDeclared(session, session.append('turn/start', { turn: 1 }), fail)

    expect(messages).toEqual([])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciPlanInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })

  it('reports the offending append when installed on a live session store', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(SciPlanInvariant)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const session = ctx.sessions.create()

    declare(session, SciPlanId('p1'))
    declare(session, SciPlanId('p2'))
    expect(warnings).toEqual([])
    declare(session, SciPlanId('p1'))

    // `session/event` listeners are contained (`packages/core/session/src/index.ts`
    // `invokeContainedSessionObservers`), so the violation surfaces as an
    // attributed warning and the log — the authority the gate replays — still
    // holds the event that broke the rule.
    expect(warnings).toEqual([
      expect.stringContaining('invariant violated by "@deepseek-ai/dsh-sci-plan": plan id "p1" was declared twice in one session'),
    ])
    expect(session.events.filter(event => event.type === 'sci/plan-declared')).toHaveLength(3)

    await ctx.fiber.dispose()
  })
})
