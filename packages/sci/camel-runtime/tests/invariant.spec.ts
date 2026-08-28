// The companion asserts one relation over the session log: a fork id names one
// result directory, so `sci/fork-completed` never repeats a forkId in a session.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as CamelRuntimeInvariant from '../src/invariant.ts'
import { validateForkCompleted } from '../src/invariant.ts'

const COMPLETED = { forkId: 'f1', snapshotID: 's', variants: [], durationMs: 1 }

function log(...forkIds: string[]): { session: Session; events: SessionEvent[] } {
  const events = forkIds.map((forkId, index) => ({
    seq: index + 1,
    type: 'sci/fork-completed',
    data: { ...COMPLETED, forkId },
  })) as unknown as SessionEvent[]
  return { session: { events } as unknown as Session, events }
}

describe('validateForkCompleted', () => {
  it('ignores other event types', () => {
    const fail = vi.fn<InvariantFailure>()
    validateForkCompleted({ events: [] } as unknown as Session, { seq: 1, type: 'tool/call', data: {} } as unknown as SessionEvent, fail)
    expect(fail).not.toHaveBeenCalled()
  })

  it('accepts distinct fork ids', () => {
    const fail = vi.fn<InvariantFailure>()
    const { session, events } = log('f1', 'f2')
    validateForkCompleted(session, events[1]!, fail)
    expect(fail).not.toHaveBeenCalled()
  })

  it('reports a repeated fork id, naming it', () => {
    const fail = vi.fn<InvariantFailure>()
    const { session, events } = log('f1', 'f1')
    validateForkCompleted(session, events[1]!, fail)
    expect(fail).toHaveBeenCalledWith('fork "f1" completed twice in one session; a fork id names one result directory')
  })
})

describe('the companion plugin', () => {
  it('registers under the package name once the invariant service is present', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    expect(CamelRuntimeInvariant.name).toBe('camel-runtime-invariant')
    expect(CamelRuntimeInvariant.inject).toEqual(['invariants'])
    await expect(ctx.plugin(CamelRuntimeInvariant)).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
