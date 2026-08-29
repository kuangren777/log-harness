// @vitest-environment jsdom
/**
 * The sci details body: how it titles a call, the three lifecycle readings
 * (running with a live stopwatch, done, failed), the arguments it pretty-
 * prints, and the cut it announces on an oversized result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SciToolDetails, type SciToolDetailsProps } from '../src/client/SciToolDetails.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** A settled result of one call. */
function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 3, time: 8000, callId: 'c1',
    call: { name: 'web_search', argsRaw: '{"query":"thermoelectric"}' },
    callTime: 3000, content: [{ type: 'text', text: 'four hits' }], isError: false,
    callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

/** A call the wire has seen dispatched but not settled. */
function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'c1', name: 'bash', argsRaw: '{"command":"ls"}', turn: 1, step: 1,
    time: 1000, callView: null, subCalls: [],
    ...overrides,
  }
}

/** Mount the body over one call slice. */
function details(block: SciToolDetailsProps['block']) {
  render(<SciToolDetails {...({ block, t: makeTranslate(zh) } as unknown as SciToolDetailsProps)} />)
}

describe('SciToolDetails', () => {
  it('titles a settled call by the noun its tool is known as, and reports how long it took', () => {
    details(settled())
    expect(screen.getByText('网页搜索 · 调用详情')).toBeTruthy()
    expect(screen.getByText(zh['tool.done'])).toBeTruthy()
    // 3000ms dispatched, 8000ms settled.
    expect(screen.getByText('5 秒')).toBeTruthy()
  })

  it('reports a failure as one, and frames its result', () => {
    details(settled({ isError: true, content: [{ type: 'text', text: 'no route to host' }] }))
    expect(screen.getByText(zh['tool.failed'])).toBeTruthy()
    const block = screen.getByText('no route to host')
    expect(block.className).toContain('blockError')
  })

  it('says nothing about duration when the call head fell outside the window', () => {
    details(settled({ call: null, callTime: null }))
    expect(screen.getByText('未知工具 · 调用详情')).toBeTruthy()
    expect(screen.queryByText(/秒$/)).toBeNull()
  })

  it('leaves the call arguments to the owner, which renders them above this seat', () => {
    details(settled())
    expect(screen.queryByText(/thermoelectric/)).toBeNull()
  })

  it('flattens non-text result blocks, and falls back to the structured error', () => {
    details(settled({ content: [{ type: 'text', text: 'head' }, { type: 'image', source: 'x' }] as never }))
    expect(screen.getByText(/head/)).toBeTruthy()
    expect(screen.getByText(/"type": "image"/)).toBeTruthy()

    cleanup()
    details(settled({ content: [], isError: true, error: { name: 'ToolError', code: 'TIMEOUT' } }))
    expect(screen.getByText('ToolError: TIMEOUT')).toBeTruthy()
  })

  it('states an empty successful result rather than drawing an empty frame', () => {
    details(settled({ content: [] }))
    expect(screen.getByText(zh['tool.result.empty'])).toBeTruthy()
  })

  it('cuts an oversized result and says that it did', () => {
    const long = 'x'.repeat(20_001)
    details(settled({ content: [{ type: 'text', text: long }] }))
    expect(screen.getByText(zh['tool.truncated'])).toBeTruthy()
    expect(screen.getByText(new RegExp('^x{20000}$')).textContent).toHaveLength(20_000)
  })

  it('keeps a result exactly at the cap whole, and says nothing about a cut', () => {
    details(settled({ content: [{ type: 'text', text: 'y'.repeat(20_000) }] }))
    expect(screen.queryByText(zh['tool.truncated'])).toBeNull()
  })
})

describe('SciToolDetails while the call runs', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('runs a stopwatch, and shows no result section until there is one', () => {
    vi.setSystemTime(4000)
    details(running())
    expect(screen.getByText('命令执行 · 调用详情')).toBeTruthy()
    expect(screen.getByText(zh['tool.running'])).toBeTruthy()
    expect(screen.getByText('3 秒')).toBeTruthy()
    expect(document.querySelector('pre')).toBeNull()
    expect(screen.queryByText(zh['tool.result.empty'])).toBeNull()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('5 秒')).toBeTruthy()
  })

  it('never counts backwards from a clock behind the dispatch', () => {
    vi.setSystemTime(0)
    details(running({ time: 9000 }))
    expect(screen.getByText('0 秒')).toBeTruthy()
  })

  it('stops the stopwatch with the call', () => {
    vi.setSystemTime(4000)
    details(settled())
    act(() => { vi.advanceTimersByTime(10_000) })
    // Still the settled duration, not a clock that kept running.
    expect(screen.getByText('5 秒')).toBeTruthy()
  })
})
