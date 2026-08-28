// The result text is the only thing the model reads back about the plan it just
// committed to, so its shape is pinned rather than described. These cases also
// cover the replay path: render runs over arguments recorded by another build,
// where an edge may not be a pair, and a display function must never throw
// during a replay.
import { describe, expect, it } from 'vitest'
import { formatDag, formatPlanResult } from '@deepseek-ai/dsh-sci-plan'
import type { RenderedAgent } from '@deepseek-ai/dsh-sci-plan'

/** One rendered agent, so a case only states the fields it is about. */
function rendered(id: string, overrides: Partial<RenderedAgent> = {}): RenderedAgent {
  return { id, name: `card ${id}`, icon: 'code', task: `do ${id}`, persona: 'writer', ...overrides }
}

describe('formatDag', () => {
  it('draws nothing when no agent depends on another', () => {
    expect(formatDag([rendered('a'), rendered('b')], [])).toEqual([])
  })

  it('lists sources in run order and their targets in declaration order', () => {
    const agents = [rendered('a'), rendered('b'), rendered('c')]

    expect(formatDag(agents, [['b', 'c'], ['a', 'c'], ['a', 'b']])).toEqual([
      '  a → c, b',
      '  b → c',
    ])
  })

  it('draws a dependency declared twice once', () => {
    expect(formatDag([rendered('a'), rendered('b')], [['a', 'b'], ['a', 'b']])).toEqual(['  a → b'])
  })

  it('skips an entry that does not hold two endpoints, because a replay is not re-validated', () => {
    expect(formatDag([rendered('a'), rendered('b')], [['a'], [], ['a', 'b']])).toEqual(['  a → b'])
  })

  it('ignores an edge whose source is no declared agent', () => {
    expect(formatDag([rendered('a')], [['ghost', 'a']])).toEqual([])
  })
})

describe('formatPlanResult', () => {
  it('renders a single independent agent in the singular', () => {
    expect(formatPlanResult([rendered('solo', { name: 'Survey', icon: 'web', persona: 'researcher', task: 'read the docs' })], []))
      .toBe([
        'research plan declared: 1 agent, no dependencies.',
        '1. solo — Survey [web, runs as researcher]: read the docs',
      ].join('\n'))
  })

  it('renders one dependency in the singular and draws it', () => {
    expect(formatPlanResult(
      [rendered('installer', { icon: 'code', persona: 'writer' }), rendered('verifier', { icon: 'check', persona: 'deliverer' })],
      [['installer', 'verifier']],
    )).toBe([
      'research plan declared: 2 agents, 1 dependency.',
      '1. installer — card installer [code, runs as writer]: do installer',
      '2. verifier — card verifier [check, runs as deliverer]: do verifier',
      'dependencies:',
      '  installer → verifier',
    ].join('\n'))
  })

  it('renders several dependencies in the plural', () => {
    const agents = [rendered('a'), rendered('b'), rendered('c')]

    expect(formatPlanResult(agents, [['a', 'b'], ['a', 'c']])).toMatchInlineSnapshot(`
      "research plan declared: 3 agents, 2 dependencies.
      1. a — card a [code, runs as writer]: do a
      2. b — card b [code, runs as writer]: do b
      3. c — card c [code, runs as writer]: do c
      dependencies:
        a → b, c"
    `)
  })
})
