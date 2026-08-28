// The write-timing metric: memory written early in a session scores high,
// memory deferred to the last turn scores zero.
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { memoryTimingScore } from '@deepseek-ai/dsh-sci-memory'
import type { MemoryIndexRecord } from '@deepseek-ai/dsh-sci-memory'

const SESSION = SessionId('11111111-2222-3333-4444-555555555555')

/**
 * Build one indexed row at a turn position.
 * @param slug - the row key.
 * @param writtenAtTurn - the turn the node was written in.
 * @param turnsTotal - the turns its session completed.
 * @returns the row.
 */
function row(slug: string, writtenAtTurn: number, turnsTotal: number): MemoryIndexRecord {
  return { slug, originSessionId: SESSION, writtenAtTurn, turnsTotal }
}

describe('memoryTimingScore', () => {
  it('scores three nodes written in turns 1, 2, and 3 of 3', () => {
    const rows = [row('a', 1, 3), row('b', 2, 3), row('c', 3, 3)]
    expect(memoryTimingScore(rows)).toBeCloseTo(1 - (1 / 3 + 2 / 3 + 1) / 3, 12)
  })

  it('scores nodes all deferred to the final turn as 0', () => {
    expect(memoryTimingScore([row('a', 8, 8), row('b', 8, 8)])).toBe(0)
  })

  it('is undefined when nothing is indexed', () => {
    expect(memoryTimingScore([])).toBeUndefined()
  })

  it('reads a row whose writing turn has not ended yet as the last turn', () => {
    expect(memoryTimingScore([row('a', 4, 3)])).toBe(0)
  })

  it('does not score a node written before any turn opened', () => {
    expect(memoryTimingScore([row('a', 0, 0)])).toBeUndefined()
    expect(memoryTimingScore([row('a', 0, 0), row('b', 1, 4)])).toBeCloseTo(0.75, 12)
  })
})
