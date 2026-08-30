// @vitest-environment jsdom
/**
 * The unified tool card as it sits in ui-tool's call frame: the three
 * lifecycle states, the argument summary, the elapsed readings (recorded and
 * live), the two gestures the head offers, the disclosure policy, and the
 * fact that the body it shows is the per-tool view the owner handed it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { conversationSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { SciToolCard, cardStatus, summarizeArgs } from '../src/client/SciToolCard.tsx'
import { isAgentTool, toolIcon } from '../src/client/tool-names.tsx'
import type { SciToolCardProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 's1' as SessionId

/** A settled call; overrides tune the tool, the arguments, and the outcome. */
function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 9, time: 8_000, callId: 'c1',
    call: { name: 'bash', argsRaw: '{"command":"ls -la /home/user/sci"}' },
    callTime: 3_000, content: [{ type: 'text', text: 'total 0' }], isError: false,
    callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

/** A dispatched call the wire has not settled. */
function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'c1', name: 'web_search', argsRaw: '{"query":"thermoelectric selenide"}',
    turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
    ...overrides,
  }
}

/** Overrides for the frame owner share the card is mounted with. */
interface MountOptions {
  selected?: boolean
  toolName?: string
  inspect?: (() => void) | undefined
  children?: React.ReactNode
  snapshot?: ConversationSnapshot
}

/** Mount the card over one call, with a recognizable per-tool body. */
function mount(block: ToolCallBlock, options: MountOptions = {}) {
  const openDetails = vi.fn()
  const inspect = 'inspect' in options ? options.inspect : vi.fn()
  const snapshot = options.snapshot ?? conversationSnapshot(SESSION)
  const props = {
    callId: block.callId,
    toolName: options.toolName ?? ('kind' in block ? block.call?.name ?? '' : block.name),
    block,
    selected: options.selected ?? false,
    turn: null,
    cwd: '/home/user/sci',
    home: undefined,
    inspect,
    openDetails,
    body: <p data-testid="tool-body">the tool own view</p>,
    hasSubcalls: options.children !== undefined,
    children: options.children,
    useSession: (selector: (s: ConversationSnapshot) => unknown) => selector(snapshot),
    t: makeTranslate(zh),
  } as unknown as SciToolCardProps
  return { view: render(<SciToolCard {...props} />), openDetails, inspect }
}

describe('card readings', () => {
  it('reads a call lifecycle as one of the three card states', () => {
    expect(cardStatus(running())).toBe('running')
    expect(cardStatus(settled())).toBe('done')
    expect(cardStatus(settled({ isError: true }))).toBe('error')
  })

  it('glyphs the office family together, and anything unmapped generically', () => {
    const draw = (name: string) => {
      const view = render(<span>{toolIcon(name)}</span>)
      const html = view.container.innerHTML
      cleanup()
      return html
    }
    expect(draw('univer_export')).toBe(draw('univer_new'))
    expect(draw('univer_export')).not.toBe(draw('mystery_tool'))
    expect(draw('bash')).not.toBe(draw('mystery_tool'))
    // The six persona-bound delegation tools glyph as the generic one does.
    expect(draw('subagent_scout')).toBe(draw('subagent'))
  })

  it('knows which tools delegate', () => {
    expect(isAgentTool('subagent')).toBe(true)
    expect(isAgentTool('workflow')).toBe(true)
    // The sci-cluster preset mounts one tool per persona in place of the
    // single generic `subagent`; each of them shows the galaxy board too.
    expect(isAgentTool('subagent_researcher')).toBe(true)
    expect(isAgentTool('subagent_deliverer')).toBe(true)
    expect(isAgentTool('bash')).toBe(false)
    // The prefix is the whole rule: a tool merely starting with the word is
    // not one of them.
    expect(isAgentTool('subagents')).toBe(false)
  })

  it('summarizes a call by its first string argument, on one line and capped', () => {
    expect(summarizeArgs(settled())).toBe('ls -la /home/user/sci')
    // Newlines collapse: the head is one line.
    expect(summarizeArgs(running({ argsRaw: '{"command":"a\\n\\n  b"}' }))).toBe('a b')
    // A leading non-string and a blank string are both skipped.
    expect(summarizeArgs(running({ argsRaw: '{"count":3,"blank":"  ","q":"kept"}' }))).toBe('kept')
    const long = 'x'.repeat(80)
    expect(summarizeArgs(running({ argsRaw: JSON.stringify({ q: long }) }))).toBe(`${'x'.repeat(60)}…`)
    // Nothing to summarize: no string field, a non-object, or truncated JSON.
    expect(summarizeArgs(running({ argsRaw: '{"count":3}' }))).toBe('')
    expect(summarizeArgs(running({ argsRaw: '42' }))).toBe('')
    expect(summarizeArgs(running({ argsRaw: '{"q":"tru' }))).toBe('')
    // A settled call whose head fell outside the window names nothing.
    expect(summarizeArgs(settled({ call: null }))).toBe('')
  })
})

describe('the tool card head', () => {
  it('names a settled call by its noun, summarizes it, and reports its recorded wall time', () => {
    mount(settled())
    expect(screen.getByText('命令执行')).toBeTruthy()
    expect(screen.getByText('ls -la /home/user/sci')).toBeTruthy()
    // Dispatched at 3000ms, settled at 8000ms.
    expect(screen.getByText('5 秒')).toBeTruthy()
    expect(screen.getByText(zh['card.done'])).toBeTruthy()
  })

  it('reports a failed call as failed', () => {
    mount(settled({ isError: true }))
    expect(screen.getByText(zh['card.failed'])).toBeTruthy()
  })

  it('says nothing about wall time when the call head fell outside the window', () => {
    mount(settled({ call: null, callTime: null }))
    expect(screen.queryByText(/秒$/u)).toBeNull()
  })

  it('marks the card the details column currently names', () => {
    const { view } = mount(settled(), { selected: true })
    expect(view.container.firstElementChild?.getAttribute('data-card-selected')).toBe('true')
  })

  it('asks the owner to open the details column on this call', () => {
    const { openDetails } = mount(settled())
    fireEvent.click(screen.getByLabelText(zh['card.openDetails']))
    expect(openDetails).toHaveBeenCalledTimes(1)
  })

  it('asks the owner for the trajectory view, and hides that button when the view is absent', () => {
    const { inspect } = mount(settled())
    fireEvent.click(screen.getByLabelText(zh['card.inspect']))
    expect(inspect).toHaveBeenCalledTimes(1)

    cleanup()
    mount(settled(), { inspect: undefined })
    expect(screen.queryByLabelText(zh['card.inspect'])).toBeNull()
  })
})

describe('the disclosure', () => {
  it('opens a running call, because that is the moment its body is news', () => {
    mount(running())
    expect(screen.getByLabelText(zh['card.collapse']).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('tool-body')).toBeTruthy()
  })

  it('leaves a settled call shut, and the user toggle wins from then on', () => {
    mount(settled())
    const toggle = screen.getByLabelText(zh['card.expand'])
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('tool-body')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByTestId('tool-body')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(zh['card.collapse']))
    expect(screen.queryByTestId('tool-body')).toBeNull()
  })

  it('shows the per-tool view the owner handed it, not a reading of its own', () => {
    mount(settled())
    fireEvent.click(screen.getByLabelText(zh['card.expand']))
    expect(screen.getByText('the tool own view')).toBeTruthy()
  })

  it('keeps the subcall branch outside the collapsible body', () => {
    mount(settled(), { children: <i data-testid="subcalls" /> })
    // Collapsed: the body is gone, the branch is not.
    expect(screen.queryByTestId('tool-body')).toBeNull()
    expect(screen.getByTestId('subcalls')).toBeTruthy()
  })
})

describe('the live stopwatch', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('counts a running call up once a second, and stops with the card', () => {
    vi.setSystemTime(11_000)
    const { view } = mount(running({ time: 5_000 }))
    expect(view.getByText('6 秒')).toBeTruthy()
    // Advancing fake timers advances the mocked clock with them.
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.getByText('9 秒')).toBeTruthy()
    view.unmount()
    // No timer survives the unmount; advancing further throws nothing.
    act(() => { vi.advanceTimersByTime(5_000) })
  })

  it('leaves a settled card without a timer at all', () => {
    vi.setSystemTime(11_000)
    mount(settled())
    expect(vi.getTimerCount()).toBe(0)
  })
})
