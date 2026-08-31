// The companion asserts one relation over the session log: a slot name is live
// from its creation until its deletion, and is never created again while live.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as CamelRuntimeInvariant from '../src/invariant.ts'
import { validateVariantCreated } from '../src/invariant.ts'

type Step = ['created' | 'deleted' | 'other', string]

function log(steps: Step[]): { session: Session; events: SessionEvent[] } {
  const events = steps.map(([kind, name], index) => ({
    seq: index + 1,
    type: kind === 'created' ? 'sci/variant-created' : kind === 'deleted' ? 'sci/variant-deleted' : 'tool/call',
    data: { name, project: 'p', sandboxID: `sb-${index}` },
  })) as unknown as SessionEvent[]
  return { session: { events } as unknown as Session, events }
}

describe('validateVariantCreated', () => {
  it('ignores other event types', () => {
    const fail = vi.fn<InvariantFailure>()
    const { session, events } = log([['other', 'a']])
    validateVariantCreated(session, events[0]!, fail)
    expect(fail).not.toHaveBeenCalled()
  })

  it('accepts distinct names, and the same name again after a deletion', () => {
    const fail = vi.fn<InvariantFailure>()
    const { session, events } = log([['created', 'a'], ['created', 'b'], ['deleted', 'a'], ['created', 'a']])
    for (const event of events) validateVariantCreated(session, event, fail)
    expect(fail).not.toHaveBeenCalled()
  })

  it('reports a name created again while live, and ignores events after the one checked', () => {
    const fail = vi.fn<InvariantFailure>()
    const { session, events } = log([['created', 'a'], ['created', 'a'], ['deleted', 'a']])
    validateVariantCreated(session, events[1]!, fail)
    expect(fail).toHaveBeenCalledWith('variant "a" was created twice in one session without a deletion in between; one slot name owns one sandbox')
    fail.mockClear()
    validateVariantCreated(session, events[0]!, fail)
    expect(fail).not.toHaveBeenCalled()
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
