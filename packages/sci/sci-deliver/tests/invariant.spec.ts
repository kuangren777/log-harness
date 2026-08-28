// The companion checks the committed log, not the gate: a manifest that reaches
// `sci/delivered` twice in one session means two workbenches for one document,
// whatever the validation chain believed.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as SciDeliverInvariant from '@deepseek-ai/dsh-sci-deliver/invariant'
import { validateDelivered } from '@deepseek-ai/dsh-sci-deliver/src/invariant.ts'
import type { DeliveryKind } from '@deepseek-ai/dsh-sci-deliver'
import { PROJECT, WORKSPACE } from './harness.ts'

const PAPER = `${PROJECT}/papers/intro/intro.paper`
const REPORT = `${WORKSPACE}/report.md`

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

/** Append one delivery record and return the event the log accepted. */
function append(session: Session, path: string, kind: DeliveryKind): SessionEvent {
  return session.append('sci/delivered', {
    deliveryId: `d${session.events.length}`,
    path,
    sha256: 'a'.repeat(64),
    size: 1,
    title: 'A',
    kind,
    via: 'tool',
  } as never, { ignorable: true })
}

describe('sci-deliver once-per-session manifest invariant', () => {
  it('accepts the first delivery of a manifest', () => {
    const session = Session.create(SessionId('sci-deliver-invariant-first'))
    const { fail, messages } = reporter()

    validateDelivered(session, append(session, PAPER, 'paper'), fail)

    expect(messages).toEqual([])
  })

  it('accepts a repeated ordinary-file delivery, which only costs a second card', () => {
    const session = Session.create(SessionId('sci-deliver-invariant-file'))
    append(session, REPORT, 'file')
    const { fail, messages } = reporter()

    validateDelivered(session, append(session, REPORT, 'file'), fail)

    expect(messages).toEqual([])
  })

  it('rejects a second delivery of the same manifest', () => {
    const session = Session.create(SessionId('sci-deliver-invariant-twice'))
    append(session, PAPER, 'paper')
    const { fail, messages } = reporter()

    validateDelivered(session, append(session, PAPER, 'paper'), fail)

    expect(messages).toEqual([
      expect.stringContaining(`paper manifest ${JSON.stringify(PAPER)} was delivered twice in one session`),
    ])
  })

  it('ignores every other event type', () => {
    const session = Session.create(SessionId('sci-deliver-invariant-other'))
    const { fail, messages } = reporter()

    validateDelivered(session, session.append('turn/start', { turn: 1 }), fail)
    validateDelivered(
      session,
      session.append('sci/delivery-failed', { via: 'spool', path: REPORT, reason: 'outside' }, { ignorable: true }),
      fail,
    )

    expect(messages).toEqual([])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciDeliverInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
