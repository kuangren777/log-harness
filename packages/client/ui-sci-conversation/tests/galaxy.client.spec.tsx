// @vitest-environment jsdom
/**
 * The galaxy board and the derivations behind it: which calls of a turn count
 * as delegations, how each one is labelled and timed, what the turn header
 * reads, and the two things the board refuses to invent (a token column
 * nobody reported, and a board for a turn that delegated nothing).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { conversationSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationSnapshot, RunningToolCall, SessionId, ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { Galaxy, agentGlyph } from '../src/client/Galaxy.tsx'
import { agentCalls, agentLabel, callElapsedMs, turnTotals } from '../src/client/galaxy-select.ts'
import { SciToolCard } from '../src/client/SciToolCard.tsx'
import type { SciToolCardProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 's1' as SessionId
const TURN = 3
const t = makeTranslate(zh)

/** A settled call of one tool; overrides tune identity, arguments, and outcome. */
function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 5, time: 9_000, callId: 'a1',
    call: { name: 'subagent', argsRaw: '{"description":"survey halide doping"}' },
    callTime: 4_000, content: [], isError: false, callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

/** A dispatched call the wire has not settled. */
function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'a2', name: 'subagent', argsRaw: '{"description":"fit zT curves"}',
    turn: TURN, step: 1, time: 6_000, callView: null, subCalls: [],
    ...overrides,
  }
}

/** A Chat snapshot whose turn owns exactly the given root calls, in order. */
function chatOf(roots: readonly ToolCallBlock[]): ChatSnapshot {
  const nodes = new Map<string, ChatConversationViewNode>()
  const keys: string[] = []
  roots.forEach((root, index) => {
    const key = `n${index}`
    keys.push(key)
    nodes.set(key, {
      key, kind: 'tool-call', id: root.callId, target: 'chat',
      anchorSeq: index, location: { kind: 'unresolved' }, visibility: 'visible',
      data: { root },
    })
  })
  // One key names no Node at all: a window cut can leave the index ahead of
  // the store, and the derivation must skip rather than throw.
  keys.push('missing')
  return {
    order: keys,
    nodes: { get: (key: string) => nodes.get(key), values: () => [...nodes.values()] },
    locations: { getTurn: (turn: number) => (turn === TURN ? keys : []), getStep: () => [] },
  } as unknown as ChatSnapshot
}

describe('agent labels', () => {
  it('reads a subagent own task description', () => {
    expect(agentLabel('{"description":" survey halide doping "}')).toBe('survey halide doping')
  })

  it('reads a workflow identity block, name before description', () => {
    expect(agentLabel('{"meta":{"name":"zt-fit","description":"fit curves"}}')).toBe('zt-fit')
    expect(agentLabel('{"meta":{"description":"fit curves"}}')).toBe('fit curves')
  })

  it('names nothing it cannot read', () => {
    expect(agentLabel('{"description":"  "}')).toBeUndefined()
    expect(agentLabel('{"meta":{"name":42}}')).toBeUndefined()
    expect(agentLabel('{"meta":"plain"}')).toBeUndefined()
    expect(agentLabel('{"prompt":"do it"}')).toBeUndefined()
    expect(agentLabel('null')).toBeUndefined()
    expect(agentLabel('{"descr')).toBeUndefined()
  })
})

describe('call wall time', () => {
  it('measures a settled call between its own two timestamps', () => {
    expect(callElapsedMs(settled(), 99_000)).toBe(5_000)
  })

  it('measures a running call against the caller clock', () => {
    expect(callElapsedMs(running(), 9_000)).toBe(3_000)
  })

  it('reports nothing for a settled call whose dispatch fell outside the window', () => {
    expect(callElapsedMs(settled({ callTime: null }), 99_000)).toBeNull()
  })
})

describe('the delegating calls of a turn', () => {
  it('takes the delegating tools in dispatch order and leaves the rest out', () => {
    const other = settled({ callId: 'b1', call: { name: 'bash', argsRaw: '{"command":"ls"}' } })
    const flow = settled({
      callId: 'a3', call: { name: 'workflow', argsRaw: '{"meta":{"name":"zt-fit"}}' },
    })
    const agents = agentCalls(chatOf([settled(), other, running(), flow]), TURN, 9_000, () => '子智能体')
    expect(agents.map(agent => agent.callId)).toEqual(['a1', 'a2', 'a3'])
    expect(agents.map(agent => agent.status)).toEqual(['done', 'running', 'done'])
    expect(agents.map(agent => agent.label)).toEqual(['survey halide doping', 'fit zT curves', 'zt-fit'])
    expect(agents.map(agent => agent.elapsedMs)).toEqual([5_000, 3_000, 5_000])
  })

  it('falls back to the tool own noun when a call describes nothing', () => {
    const bare = settled({ call: { name: 'subagent', argsRaw: '{}' } })
    expect(agentCalls(chatOf([bare]), TURN, 9_000, () => '子智能体')[0]?.label).toBe('子智能体')
  })

  it('reports a failed delegation as failed, and a call head outside the window as unnamed', () => {
    const failed = settled({ isError: true })
    expect(agentCalls(chatOf([failed]), TURN, 9_000, () => '子智能体')[0]?.status).toBe('error')
    // No call head: no tool name, so the call is not a delegation at all.
    expect(agentCalls(chatOf([settled({ call: null })]), TURN, 9_000, () => 'x')).toEqual([])
  })

  it('reads completion tokens only from a result that reports them', () => {
    const withUsage = settled({ meta: { usage: { outputTokens: 812 } } })
    expect(agentCalls(chatOf([withUsage]), TURN, 0, () => 'x')[0]?.outputTokens).toBe(812)
    for (const meta of [undefined, null, 'text', { usage: null }, { usage: { outputTokens: -1 } },
      { usage: { outputTokens: 'many' } }]) {
      expect(agentCalls(chatOf([settled({ meta })]), TURN, 0, () => 'x')[0]?.outputTokens).toBeNull()
    }
    // A running delegation has no result to report from.
    expect(agentCalls(chatOf([running()]), TURN, 0, () => 'x')[0]?.outputTokens).toBeNull()
  })

  it('finds nothing in a turn the index does not own', () => {
    expect(agentCalls(chatOf([settled()]), 99, 0, () => 'x')).toEqual([])
  })
})

describe('the turn header readings', () => {
  /** A snapshot whose turn carries the given timing and assistant nodes. */
  function snapshotOf(
    timing: { startTime: number; endTime?: number } | undefined,
    usages: readonly { turn: number; usage: unknown }[],
  ): ConversationSnapshot {
    const base = conversationSnapshot(SESSION)
    return {
      ...base,
      turnTimings: timing === undefined ? new Map() : new Map([[TURN, timing]]),
      nodes: usages.map((entry, index) => ({
        kind: 'assistant' as const,
        seq: index,
        time: 0,
        turn: entry.turn,
        step: 1,
        blocks: [],
        usage: entry.usage,
      })),
    }
  }

  it('measures a closed turn between its own boundaries and sums its output tokens', () => {
    const snapshot = snapshotOf({ startTime: 1_000, endTime: 7_000 }, [
      { turn: TURN, usage: { outputTokens: 120 } },
      { turn: TURN, usage: { outputTokens: 80 } },
      { turn: 9, usage: { outputTokens: 999 } },
    ])
    expect(turnTotals(snapshot, TURN, 50_000)).toEqual({ elapsedMs: 6_000, outputTokens: 200, running: false })
  })

  it('measures an open turn against the caller clock', () => {
    const snapshot = snapshotOf({ startTime: 1_000 }, [])
    expect(turnTotals(snapshot, TURN, 5_000)).toEqual({ elapsedMs: 4_000, outputTokens: null, running: true })
  })

  it('reports no numbers for a turn whose start is outside the window', () => {
    expect(turnTotals(snapshotOf(undefined, []), TURN, 5_000))
      .toEqual({ elapsedMs: null, outputTokens: null, running: false })
  })

  it('skips assistant steps that reported no usable usage', () => {
    const snapshot = snapshotOf({ startTime: 0, endTime: 1_000 }, [
      { turn: TURN, usage: undefined },
      { turn: TURN, usage: 'nope' },
      { turn: TURN, usage: { outputTokens: Number.NaN } },
      { turn: TURN, usage: { outputTokens: 60 } },
    ])
    expect(turnTotals(snapshot, TURN, 0).outputTokens).toBe(60)
  })
})

describe('the board', () => {
  it('numbers agents past the alphabet it carries', () => {
    expect(agentGlyph(0)).toBe('α')
    expect(agentGlyph(5)).toBe('ζ')
    expect(agentGlyph(6)).toBe('7')
  })

  it('states an empty turn rather than drawing an empty orbit', () => {
    render(<Galaxy agents={[]} turnElapsedMs={1} turnOutputTokens={1} turnRunning t={t} />)
    expect(screen.getByText(zh['galaxy.empty'])).toBeTruthy()
  })

  it('draws one row per agent with its label, glyph, and wall time', () => {
    render(<Galaxy
      agents={[
        { callId: 'a1', label: '掺杂策略综述', status: 'done', elapsedMs: 5_000, outputTokens: null },
        { callId: 'a2', label: '曲线拟合', status: 'running', elapsedMs: 3_000, outputTokens: null },
      ]}
      turnElapsedMs={12_000}
      turnOutputTokens={840}
      turnRunning
      t={t}
    />)
    expect(screen.getByText('掺杂策略综述')).toBeTruthy()
    expect(screen.getByText('曲线拟合')).toBeTruthy()
    expect(screen.getAllByText('α')).toHaveLength(2)
    expect(screen.getByText('5 秒')).toBeTruthy()
    expect(screen.getByText('本轮已用 12 秒')).toBeTruthy()
    expect(screen.getByText('本轮输出 840 tokens')).toBeTruthy()
    expect(screen.getByText(zh['card.running'])).toBeTruthy()
  })

  it('drops every reading nothing reported, tokens included', () => {
    const view = render(<Galaxy
      agents={[{ callId: 'a1', label: '综述', status: 'done', elapsedMs: null, outputTokens: null }]}
      turnElapsedMs={null}
      turnOutputTokens={null}
      turnRunning={false}
      t={t}
    />)
    expect(view.container.textContent).not.toContain('秒')
    expect(view.container.textContent).not.toContain('token')
    expect(screen.queryByText(zh['card.running'])).toBeNull()
  })

  it('shows the token column as soon as one agent reported tokens', () => {
    render(<Galaxy
      agents={[
        { callId: 'a1', label: '综述', status: 'done', elapsedMs: null, outputTokens: 812 },
        { callId: 'a2', label: '拟合', status: 'error', elapsedMs: null, outputTokens: null },
      ]}
      turnElapsedMs={null}
      turnOutputTokens={null}
      turnRunning={false}
      t={t}
    />)
    expect(screen.getByText('812 token')).toBeTruthy()
  })
})

describe('the board inside a delegating card', () => {
  /** Mount the sci card as ui-tool's frame would, over one turn's chat window. */
  function mount(root: ToolCallBlock, turn: number | null, snapshot: ConversationSnapshot) {
    const props = {
      callId: root.callId,
      toolName: 'kind' in root ? root.call?.name ?? '' : root.name,
      block: root,
      selected: false,
      turn,
      cwd: undefined,
      home: undefined,
      inspect: undefined,
      openDetails: () => {},
      body: <p data-testid="tool-body">the tool own view</p>,
      hasSubcalls: false,
      children: undefined,
      useSession: (selector: (s: ConversationSnapshot) => unknown) => selector(snapshot),
      t,
    } as unknown as SciToolCardProps
    return render(<SciToolCard {...props} />)
  }

  it('replaces the body of a delegating call with the sibling delegations of its turn', () => {
    const root = running({ callId: 'a2' })
    const snapshot: ConversationSnapshot = {
      ...conversationSnapshot(SESSION),
      chat: chatOf([settled(), root]),
      turnTimings: new Map([[TURN, { startTime: 1_000 }]]),
    }
    mount(root, TURN, snapshot)
    // A running delegation opens itself, and its body is the board — both
    // siblings, not just the call the card draws.
    expect(screen.getByText('survey halide doping')).toBeTruthy()
    // Twice: the card head summarizes its own arguments, and the board rows
    // that same call as one of the turn's delegations.
    expect(screen.getAllByText('fit zT curves')).toHaveLength(2)
    expect(screen.getByText(zh['galaxy.center'])).toBeTruthy()
    // The per-tool view the owner handed over is displaced, not stacked.
    expect(screen.queryByTestId('tool-body')).toBeNull()
  })

  it('keeps the per-tool view for an ordinary tool', () => {
    const root = settled({ callId: 'b1', call: { name: 'bash', argsRaw: '{"command":"ls"}' } })
    mount(root, TURN, conversationSnapshot(SESSION))
    fireEvent.click(screen.getByLabelText(zh['card.expand']))
    expect(screen.queryByText(zh['galaxy.center'])).toBeNull()
    expect(screen.getByTestId('tool-body')).toBeTruthy()
  })

  it('keeps the per-tool view for a delegating call whose placement is unresolved', () => {
    const root = settled({ callId: 'a1' })
    mount(root, null, conversationSnapshot(SESSION))
    fireEvent.click(screen.getByLabelText(zh['card.expand']))
    expect(screen.queryByText(zh['galaxy.center'])).toBeNull()
    expect(screen.getByTestId('tool-body')).toBeTruthy()
  })
})
