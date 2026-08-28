// The turn-ordering invariant, asserted over the authoritative domain-change
// stream: a memory node cannot have been written in a turn its own session
// never reached, and `memoryTimingScore` divides one by the other.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as SciMemoryInvariant from '@deepseek-ai/dsh-sci-memory/invariant'
import { MEMORY_INDEX_TABLE, memoryIndexRecordSchema, sciMemoryDomainSpec } from '@deepseek-ai/dsh-sci-memory'
import { validateChange } from '@deepseek-ai/dsh-sci-memory/src/invariant.ts'
import type { MemoryIndexRecord } from '@deepseek-ai/dsh-sci-memory'

const ROW: MemoryIndexRecord = {
  slug: 'agent-fuzzing-research',
  originSessionId: SessionId('11111111-2222-3333-4444-555555555555'),
  type: 'project',
  description: 'Research paper on fuzzing LLM-based agents',
  writtenAtTurn: 2,
  turnsTotal: 3,
}

/**
 * Build a memory-index put change.
 * @param record - the committed row.
 * @returns the change event.
 */
function put(record: MemoryIndexRecord): DomainChanged {
  return {
    domain: sciMemoryDomainSpec.name,
    table: MEMORY_INDEX_TABLE,
    key: record.slug,
    operation: 'put',
    value: record,
  }
}

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

describe('sci-memory turn-ordering invariant', () => {
  it.each([
    ['a row written before its session ended', put(ROW)],
    ['a row written in the final turn', put({ ...ROW, writtenAtTurn: 3 })],
    ['a write to another table', { ...put(ROW), table: 'sci_skill_usage' }],
    ['a write to another domain', { ...put(ROW), domain: 'sci_skills' }],
    ['a deletion', { domain: sciMemoryDomainSpec.name, table: MEMORY_INDEX_TABLE, key: ROW.slug, operation: 'deleted' }],
  ])('accepts %s', (_case, change) => {
    const { fail, messages } = reporter()

    validateChange(change as DomainChanged, fail)

    expect(messages).toEqual([])
  })

  it('rejects a row whose session never reached the turn that wrote it', () => {
    const { fail, messages } = reporter()

    validateChange(put({ ...ROW, writtenAtTurn: 4 }), fail)

    expect(messages).toEqual([expect.stringContaining(
      'memory node "agent-fuzzing-research" was projected as written in turn 4 of a session that reached only 3',
    )])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciMemoryInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})

describe('memoryIndexRecordSchema', () => {
  it('accepts a stored row and brands its session id', () => {
    expect(memoryIndexRecordSchema.parse({ ...ROW })).toEqual(ROW)
  })

  it('rejects a row whose turn total precedes its writing turn', () => {
    expect(() => memoryIndexRecordSchema.parse({ ...ROW, turnsTotal: 1 }))
      .toThrow(/turnsTotal must not precede writtenAtTurn/)
  })
})
