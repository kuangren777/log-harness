// The companion checks the committed log rather than the mint: the metering
// path cannot produce a repeated request id, so a repeat means a replayed
// payload or a broken mint — and the gate keys its ledger on that id, so the
// second call would collapse onto the first call's charge.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciCreditInvariant from '@deepseek-ai/dsh-sci-credit/invariant'
import { validateCreditCharged } from '@deepseek-ai/dsh-sci-credit/src/invariant.ts'
import type { SciCreditChargedData } from '@deepseek-ai/dsh-sci-credit'

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

/** Append one charge record carrying the given request id. */
function charge(session: Session, requestId: string): SessionEvent {
  const data: SciCreditChargedData = {
    requestId,
    model: 'deepseek-v4-pro',
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
    usdMicros: 42,
    priceVersion: 1,
    peak: true,
    spooled: false,
    unknownModel: false,
  }
  return session.append('sci/credit-charged', data, { ignorable: true })
}

describe('sci-credit unique-charge-identity invariant', () => {
  it('accepts the first charge under a request id', () => {
    const session = Session.create(SessionId('sci-credit-invariant-first'))
    const { fail, messages } = reporter()

    validateCreditCharged(session, charge(session, 'req-1'), fail)

    expect(messages).toEqual([])
  })

  it('accepts a second charge that minted its own request id', () => {
    const session = Session.create(SessionId('sci-credit-invariant-distinct'))
    charge(session, 'req-1')
    const { fail, messages } = reporter()

    validateCreditCharged(session, charge(session, 'req-2'), fail)

    expect(messages).toEqual([])
  })

  it('rejects a request id charged twice in one session', () => {
    const session = Session.create(SessionId('sci-credit-invariant-twice'))
    charge(session, 'req-1')
    const { fail, messages } = reporter()

    validateCreditCharged(session, charge(session, 'req-1'), fail)

    expect(messages).toEqual([
      expect.stringContaining('credit request id "req-1" was charged twice in one session'),
    ])
  })

  it('ignores every other event type', () => {
    const session = Session.create(SessionId('sci-credit-invariant-other'))
    const { fail, messages } = reporter()

    validateCreditCharged(session, session.append('turn/start', { turn: 1 }), fail)

    expect(messages).toEqual([])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciCreditInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })

  it('reports the offending append when installed on a live session store', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(SciCreditInvariant)
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    const session = ctx.sessions.create()

    charge(session, 'req-1')
    charge(session, 'req-2')
    expect(warnings).toEqual([])
    charge(session, 'req-1')

    // `session/event` listeners are contained, so the violation surfaces as an
    // attributed warning and the log — the record an audit projection and the
    // gate's ledger are reconciled from — still holds the offending event.
    expect(warnings).toEqual([
      expect.stringContaining('invariant violated by "@deepseek-ai/dsh-sci-credit": credit request id "req-1" was charged twice in one session'),
    ])
    expect(session.events.filter(event => event.type === 'sci/credit-charged')).toHaveLength(3)

    await ctx.fiber.dispose()
  })
})
