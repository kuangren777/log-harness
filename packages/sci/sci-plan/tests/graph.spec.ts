// The sort is index-based and its only failure mode is a cycle: every id was
// already resolved by validatePlan. These cases pin the two properties the
// plan text depends on — declaration order among ready nodes, and a repeated
// dependency counting once.
import { describe, expect, it } from 'vitest'
import { topologicalSort } from '@deepseek-ai/dsh-sci-plan'

describe('sci-plan topological sort', () => {
  it('keeps declaration order when nothing depends on anything', () => {
    expect(topologicalSort(3, [])).toEqual({ ok: true, order: [0, 1, 2] })
  })

  it('puts a dependency before its dependent', () => {
    expect(topologicalSort(2, [[1, 0]])).toEqual({ ok: true, order: [1, 0] })
  })

  it('fans one source out to several targets and rejoins them', () => {
    expect(topologicalSort(4, [[0, 1], [0, 2], [1, 3], [2, 3]])).toEqual({ ok: true, order: [0, 1, 2, 3] })
  })

  it('counts a dependency declared twice once, so the target is not blocked forever', () => {
    expect(topologicalSort(2, [[0, 1], [0, 1]])).toEqual({ ok: true, order: [0, 1] })
  })

  it('reports the nodes a cycle traps, leaving the reachable prefix out of the report', () => {
    expect(topologicalSort(3, [[1, 2], [2, 1]])).toEqual({ ok: false, cycle: [1, 2] })
  })

  it('reports a node held by a cycle upstream of it', () => {
    expect(topologicalSort(3, [[0, 1], [1, 0], [1, 2]])).toEqual({ ok: false, cycle: [0, 1, 2] })
  })
})
