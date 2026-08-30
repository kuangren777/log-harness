// The folds behind the roster's numbers: what a delegating session's log says
// happened, what a child's own log says it cost, and how the two are joined.
import { describe, expect, it } from 'vitest'
import {
  attachChildTimings,
  callTask,
  childRun,
  delegationCalls,
  metaOutputTokens,
  monthStart,
  summarizeCalls,
} from '@deepseek-ai/dsh-sci-agents'
import type { AgentCall } from '@deepseek-ai/dsh-sci-agents'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { childLog, malformedCall, toolCall, toolResult } from './log.ts'

const SCOUT = 'subagent_scout'

describe('monthStart', () => {
  it('is the first instant of the reading instant\'s own month', () => {
    const start = monthStart(new Date(2026, 7, 30, 14, 2, 41, 500))
    expect(new Date(start).getFullYear()).toBe(2026)
    expect(new Date(start).getMonth()).toBe(7)
    expect(new Date(start).getDate()).toBe(1)
    expect(new Date(start).getHours()).toBe(0)
  })
})

describe('callTask', () => {
  it('reads the delegation description the model sent', () => {
    expect(callTask(JSON.stringify({ description: 'Find the methods file', prompt: 'x' })))
      .toBe('Find the methods file')
  })

  it.each([
    { label: 'unparsable arguments', args: '{not json' },
    { label: 'a JSON array', args: '[1,2]' },
    { label: 'a JSON scalar', args: '"text"' },
    { label: 'null', args: 'null' },
    { label: 'no description', args: '{"prompt":"x"}' },
    { label: 'a non-string description', args: '{"description":7}' },
  ])('answers empty for $label', ({ args }) => {
    expect(callTask(args)).toBe('')
  })
})

describe('metaOutputTokens', () => {
  it('reads a settlement that carried usage', () => {
    expect(metaOutputTokens({ usage: { outputTokens: 96_000 } })).toBe(96_000)
    expect(metaOutputTokens({ usage: { outputTokens: 0 } })).toBe(0)
  })

  it.each([
    { label: 'no meta', meta: undefined },
    { label: 'a meta array', meta: [1] },
    { label: 'a meta scalar', meta: 'x' },
    { label: 'null meta', meta: null },
    { label: 'no usage', meta: {} },
    { label: 'a usage array', meta: { usage: [] } },
    { label: 'null usage', meta: { usage: null } },
    { label: 'a non-numeric count', meta: { usage: { outputTokens: 'many' } } },
    { label: 'a negative count', meta: { usage: { outputTokens: -1 } } },
    { label: 'a non-finite count', meta: { usage: { outputTokens: Number.POSITIVE_INFINITY } } },
  ])('reports no tokens for $label', ({ meta }) => {
    expect(metaOutputTokens(meta)).toBeUndefined()
  })
})

describe('delegationCalls', () => {
  const log: SessionEvent[] = [
    toolCall(1, 1_000, SCOUT, { description: 'Find the methods file', prompt: 'p' }, 'c1'),
    toolResult(2, 4_000, 'c1', { meta: { usage: { outputTokens: 96 } } }),
    toolCall(3, 5_000, 'web_search', { description: 'unrelated', prompt: 'p' }, 'c2'),
    toolCall(4, 6_000, SCOUT, { description: 'Locate the dataset', prompt: 'p' }, 'c3'),
    toolResult(5, 7_000, 'c3', { isError: true }),
    toolCall(6, 8_000, SCOUT, { description: 'Still working', prompt: 'p' }, 'c4'),
  ]

  it('collects only this tool\'s calls, in log order', () => {
    expect(delegationCalls('s1', log, SCOUT).map(call => call.callId)).toEqual(['c1', 'c3', 'c4'])
  })

  it('reads status, task, and tokens from the paired result', () => {
    const [settled, failed, running] = delegationCalls('s1', log, SCOUT)
    expect(settled).toEqual({
      ts: 1_000,
      sessionId: 's1',
      callId: 'c1',
      task: 'Find the methods file',
      status: 'ok',
      outputTokens: 96,
    })
    expect(failed).toMatchObject({ status: 'error', task: 'Locate the dataset' })
    expect(failed).not.toHaveProperty('outputTokens')
    expect(running).toMatchObject({ status: 'running' })
  })

  it('treats an internal failure identity as an error even without isError', () => {
    const failure = toolResult(2, 2_000, 'c1', { error: { name: 'Error', code: 'SUBAGENT_FAILED' } })
    const calls = delegationCalls('s1', [toolCall(1, 1_000, SCOUT, { description: 'd' }, 'c1'), failure], SCOUT)
    expect(calls[0]?.status).toBe('error')
  })

  it('keeps a call whose arguments the model malformed, with an empty task', () => {
    const calls = delegationCalls('s1', [malformedCall(1, 1_000, SCOUT, '{oops')], SCOUT)
    expect(calls).toEqual([{ ts: 1_000, sessionId: 's1', callId: 'call-1', task: '', status: 'running' }])
  })

  it('answers empty for a log that never used the tool', () => {
    expect(delegationCalls('s1', [toolCall(1, 1_000, 'web_search', { description: 'd' })], SCOUT)).toEqual([])
  })
})

describe('childRun', () => {
  it('folds a continuable child to its label, charter, and settled turn time', () => {
    expect(childRun(childLog('Find the methods file', 'CHARTER', [{ start: 1_000, end: 3_500 }])))
      .toEqual({ label: 'Find the methods file', persona: 'CHARTER', durationMs: 2_500 })
  })

  it('adds the open turn of a child that is still working', () => {
    // `turn/start` at 1_000 with no `turn/end`: the fold's active interval runs
    // through the last event it saw, which is that start.
    expect(childRun(childLog('Running', 'CHARTER', [{ start: 1_000 }]))?.durationMs).toBe(0)
  })

  it('sums a continuable child\'s successive turns', () => {
    expect(childRun(childLog('Two turns', 'CHARTER', [
      { start: 1_000, end: 2_000 },
      { start: 5_000, end: 5_500 },
    ]))?.durationMs).toBe(1_500)
  })

  it('reports a one-shot child without a charter', () => {
    const run = childRun(childLog('One shot', undefined, [{ start: 1_000, end: 1_200 }]))
    expect(run).toEqual({ label: 'One shot', durationMs: 200 })
  })

  it('identifies no child in a log with no descriptor', () => {
    expect(childRun([toolCall(1, 1_000, SCOUT, { description: 'd' })])).toBeUndefined()
  })

  it('identifies no child from a one-shot descriptor that carried no label', () => {
    expect(childRun(childLog(undefined, undefined, []))).toBeUndefined()
  })

  it('identifies no child from a descriptor this runtime cannot parse', () => {
    const damaged = childLog('x', undefined, [])
    ;(damaged[0] as { data: unknown }).data = { version: 2, mode: 'one-shot', provider: 7 }
    expect(childRun(damaged)).toBeUndefined()
  })
})

describe('attachChildTimings', () => {
  const call = (callId: string, task: string, status: AgentCall['status'] = 'ok'): AgentCall =>
    ({ ts: 1, sessionId: 's1', callId, task, status })

  it('joins a delegation to the child its label named', () => {
    const joined = attachChildTimings(
      [call('c1', 'Find it')],
      [{ label: 'Find it', persona: 'CHARTER', durationMs: 2_500 }],
      'CHARTER',
    )
    expect(joined[0]?.durationMs).toBe(2_500)
  })

  it('leaves a still-running delegation untimed', () => {
    const joined = attachChildTimings(
      [call('c1', 'Find it', 'running')],
      [{ label: 'Find it', durationMs: 2_500 }],
      'CHARTER',
    )
    expect(joined[0]).not.toHaveProperty('durationMs')
  })

  it('leaves a delegation whose label matches no child untimed', () => {
    const joined = attachChildTimings([call('c1', 'Find it')], [{ label: 'Other', durationMs: 9 }], undefined)
    expect(joined[0]).not.toHaveProperty('durationMs')
  })

  it('does not lend a sibling persona\'s timing to this one', () => {
    const joined = attachChildTimings(
      [call('c1', 'Same task')],
      [{ label: 'Same task', persona: 'OTHER-CHARTER', durationMs: 2_500 }],
      'CHARTER',
    )
    expect(joined[0]).not.toHaveProperty('durationMs')
  })

  it('consumes each child once when two calls share a label', () => {
    const joined = attachChildTimings(
      [call('c1', 'Same task'), call('c2', 'Same task')],
      [{ label: 'Same task', durationMs: 100 }, { label: 'Same task', durationMs: 900 }],
      undefined,
    )
    expect(joined.map(entry => entry.durationMs)).toEqual([100, 900])
  })
})

describe('summarizeCalls', () => {
  it('reports the audit count with the mean of every timing it has', () => {
    expect(summarizeCalls(
      [
        { ts: 1, sessionId: 's', callId: 'a', task: 't', status: 'ok', durationMs: 1_000 },
        { ts: 2, sessionId: 's', callId: 'b', task: 't', status: 'ok', durationMs: 2_001 },
      ],
      12,
    )).toEqual({ monthCalls: 12, avgDurationMs: 1_501 })
  })

  it('omits both optional figures when nothing reported them', () => {
    expect(summarizeCalls([{ ts: 1, sessionId: 's', callId: 'a', task: 't', status: 'running' }], 1))
      .toEqual({ monthCalls: 1 })
  })

  it('sums tokens only over the settlements that carried usage', () => {
    expect(summarizeCalls(
      [
        { ts: 1, sessionId: 's', callId: 'a', task: 't', status: 'ok', outputTokens: 96 },
        { ts: 2, sessionId: 's', callId: 'b', task: 't', status: 'ok' },
      ],
      2,
    )).toEqual({ monthCalls: 2, monthTokens: 96 })
  })
})
