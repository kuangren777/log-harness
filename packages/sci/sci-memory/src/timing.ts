/**
 * The write-timing metric over indexed memory nodes.
 *
 * The studied platform instructed the model to record memory "as facts become
 * durable", but a model that defers every note to the last turn satisfies the
 * letter of that instruction while losing the working context that made the
 * note worth writing. This metric makes the difference observable.
 * @module @deepseek-ai/dsh-sci-memory/src/timing
 */

import type { MemoryIndexRecord } from './types.ts'

/**
 * Score how early in their sessions a set of memory nodes was written.
 *
 * The score is `1 - mean(writtenAtTurn / turnsTotal)`: a node written in the
 * first of many turns contributes close to `1`, a node written in the final
 * turn contributes `0`. A row whose session had not yet closed the turn that
 * wrote it counts as written in the last turn, which is the same reading the
 * row gets once that turn ends without further turns. A node written before
 * any turn opened has no position within the session and is not scored.
 * @param rows - the indexed memory nodes to score.
 * @returns the score in `[0, 1]`, or `undefined` when no row carries a turn position.
 */
export function memoryTimingScore(rows: readonly MemoryIndexRecord[]): number | undefined {
  let sum = 0
  let scored = 0
  for (const row of rows) {
    const total = Math.max(row.turnsTotal, row.writtenAtTurn)
    if (total === 0) continue
    sum += row.writtenAtTurn / total
    scored += 1
  }
  return scored === 0 ? undefined : 1 - sum / scored
}
