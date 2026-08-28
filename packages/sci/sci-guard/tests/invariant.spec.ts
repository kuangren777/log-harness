// The companion checks the committed log, not the gate: an authorization record
// whose approval pair is missing claims a decision nobody was asked to make,
// whatever the producer believed when it appended the row.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import * as SciGuardInvariant from '@deepseek-ai/dsh-sci-guard/invariant'
import { validateAuthorized } from '@deepseek-ai/dsh-sci-guard/src/invariant.ts'

const CALL = CallId('call-1')
const REQUEST = ApprovalRequestId('request-1')

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

/** A session already inside an open turn, which is where an approval pair belongs. */
function openSession(id: string): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return session
}

/** Append one authorization record and return the event the log accepted. */
function authorize(session: Session, callId = CALL): SessionEvent {
  return session.append('sci/authorized', {
    callId,
    category: 'execUnsigned',
    command: './installer',
    decision: 'denied',
  }, { ignorable: true })
}

describe('sci-guard asked-and-decided invariant', () => {
  it('accepts a record whose call was asked about and decided', () => {
    const session = openSession('sci-guard-invariant-paired')
    session.append('approval/asked', { id: REQUEST, toolName: 'bash', callId: CALL })
    session.append('approval/decided', { id: REQUEST, outcome: 'rejected' })
    const { fail, messages } = reporter()

    validateAuthorized(session, authorize(session), fail)

    expect(messages).toEqual([])
  })

  it('rejects a record for a call nobody was asked about', () => {
    const session = openSession('sci-guard-invariant-unasked')
    session.append('approval/asked', { id: REQUEST, toolName: 'bash', callId: CallId('other-call') })
    session.append('approval/decided', { id: REQUEST, outcome: 'allowed-once' })
    const { fail, messages } = reporter()

    validateAuthorized(session, authorize(session), fail)

    expect(messages).toEqual([
      expect.stringContaining('sci/authorized names call "call-1", which no earlier approval/asked'),
    ])
  })

  it('rejects a record whose question is still open', () => {
    const session = openSession('sci-guard-invariant-undecided')
    session.append('approval/asked', { id: REQUEST, toolName: 'bash', callId: CALL })
    const { fail, messages } = reporter()

    validateAuthorized(session, authorize(session), fail)

    expect(messages).toEqual([
      expect.stringContaining('whose approval request "request-1" has no earlier approval/decided'),
    ])
  })

  it('rejects a record whose decision lands only after it', () => {
    const session = openSession('sci-guard-invariant-late')
    session.append('approval/asked', { id: REQUEST, toolName: 'bash', callId: CALL })
    const record = authorize(session)
    session.append('approval/decided', { id: REQUEST, outcome: 'allowed-once' })
    const { fail, messages } = reporter()

    validateAuthorized(session, record, fail)

    expect(messages).toHaveLength(1)
  })

  it('ignores every other event type', () => {
    const session = openSession('sci-guard-invariant-other')
    const { fail, messages } = reporter()

    validateAuthorized(session, session.append('approval/decided', { id: REQUEST, outcome: 'cancelled' }), fail)
    validateAuthorized(session, session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }), fail)

    expect(messages).toEqual([])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciGuardInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
