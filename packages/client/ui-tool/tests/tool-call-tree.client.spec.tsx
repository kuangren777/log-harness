// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers and selection projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolCallFrameOwnerProps, ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree, frameSelection, frameTurn } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

/** Overrides for the render site the tree dispatches through. */
interface PropsOverrides {
  /** Occupies `tool.call.frame`; absent leaves the shipped fallback in place. */
  frame?: (owner: ToolCallFrameOwnerProps) => React.ReactNode
  /** Engine-owned placement of the Chat Node; defaults to session scope. */
  location?: ToolTreeProps['node']['location']
  /** Records the details-column selections the frame gesture names. */
  openDetails?: ToolTreeProps['openDetails']
}

function props(
  block: ToolResultNode,
  selectedCallId?: string,
  description?: HostDescription,
  overrides: PropsOverrides = {},
): ToolTreeProps {
  const snapshot = {} as ConversationSnapshot
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((key: string, owner: object, options?: { fallback?: React.ReactNode }) => (
    key === 'tool.call.frame' && overrides.frame !== undefined
      ? overrides.frame(owner as ToolCallFrameOwnerProps)
      : options?.fallback ?? null
  )) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: overrides.location ?? { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    selectedCallId,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    openDetails: overrides.openDetails ?? vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    useHostDescription: (selector => selector(description)) as ToolTreeProps['useHostDescription'],
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker, generic fallback, and selected state for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, 'w1')} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(row?.getAttribute('data-selected')).toBe('true')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('recursively renders a selected leaf without selecting its ancestors', () => {
    const leaf = root('parent:code:1:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const child = {
      ...root('parent:code:1', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [leaf],
    }
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [child],
    }
    const view = render(<ToolCallTree {...props(block, leaf.callId)} />)
    const nests = view.container.querySelectorAll('[data-subcalls]')
    expect(nests[0]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent"]'))
    expect(nests[1]?.parentElement).toBe(view.container.querySelector('[data-chat-call-id="parent:code:1"]'))
    expect(view.container.querySelector('[data-chat-call-id="parent"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1"]')?.hasAttribute('data-selected')).toBe(false)
    expect(view.container.querySelector('[data-chat-call-id="parent:code:1:code:1"]')?.getAttribute('data-selected')).toBe('true')
    expect(nests).toHaveLength(2)
  })

  it('abbreviates a POSIX home path in the generic tool summary', () => {
    const block = root('w1', { name: 'read', argsRaw: '{"path":"/h/docs/a.ts"}' })
    const view = render(<ToolCallTree {...props(block, 'w1', {
      version: '0', cwd: '/tmp', attachedSessions: 0, home: '/h', canOpenPath: false,
    })} />)
    expect(view.getByText('~/docs/a.ts')).toBeTruthy()
  })
})

describe('the Tool call frame', () => {
  it('leaves the shipped row and its subcall branch in place when nobody occupies it', () => {
    const leaf = root('p:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const block = { ...root('p', { name: 'run_code', argsRaw: '{"code":"return 1"}' }), subCalls: [leaf] }
    const view = render(<ToolCallTree {...props(block)} />)
    // The generic row and the nesting are exactly what the tree drew before
    // the frame existed; occupying nothing changes nothing.
    expect(view.container.querySelector('[data-variant="code"]')).not.toBeNull()
    expect(view.container.querySelectorAll('[data-subcalls]')).toHaveLength(1)
    expect(view.container.querySelector('[data-chat-call-id="p:code:1"]')).not.toBeNull()
  })

  it('hands its occupant the dispatched per-tool view, the subcall branch, and the call identity', () => {
    const leaf = root('p:code:1', { name: 'read', argsRaw: '{"path":"a.ts"}' })
    const block = { ...root('p', { name: 'run_code', argsRaw: '{"code":"return 1"}' }), subCalls: [leaf] }
    const seen: ToolCallFrameOwnerProps[] = []
    const view = render(<ToolCallTree {...props(block, 'p', undefined, {
      frame: (owner) => {
        seen.push(owner)
        return <div data-frame={owner.callId}>{owner.body}{owner.children}</div>
      },
    })} />)
    const rootOwner = seen.find(owner => owner.callId === 'p')
    expect(rootOwner).toMatchObject({ toolName: 'run_code', selected: true, hasSubcalls: true, turn: null })
    expect(rootOwner?.block).toBe(block)
    expect(rootOwner?.inspect).toBeTypeOf('function')
    // The body is the keyed dispatch's own result: rendering it produces the
    // per-tool view the tree would otherwise have placed itself.
    expect(view.container.querySelector('[data-variant="code"]')).not.toBeNull()
    // The children the occupant placed are the recursive branch, leaf included.
    expect(view.container.querySelector('[data-frame="p"] [data-subcalls]')).not.toBeNull()
    expect(view.container.querySelector('[data-frame="p:code:1"]')).not.toBeNull()

    const leafOwner = seen.find(owner => owner.callId === 'p:code:1')
    expect(leafOwner).toMatchObject({ selected: false, hasSubcalls: false })
    expect(leafOwner?.children).toBeUndefined()
  })

  it('keeps the anchor and selection attributes outside whatever the occupant renders', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block, 'w1', undefined, {
      frame: owner => <b data-frame={owner.callId} />,
    })} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(row?.getAttribute('data-selected')).toBe('true')
    // The occupant sits inside the wrapper, so scroll anchoring and selection
    // highlighting survive whoever fills the frame.
    expect(row?.querySelector('[data-frame="w1"]')).not.toBeNull()
  })

  it('names the details-column selection its own call when the occupant asks', () => {
    const openDetails = vi.fn()
    const block = root('w1', { name: 'bash', argsRaw: '{"command":"ls"}' })
    render(<ToolCallTree {...props(block, undefined, undefined, {
      openDetails,
      frame: owner => <button type="button" onClick={owner.openDetails}>open</button>,
    })} />)
    fireEvent.click(screen.getByText('open'))
    expect(openDetails).toHaveBeenCalledWith({ turnSeq: 3, callId: 'w1', toolName: 'bash' })
  })

  it('passes the trajectory gesture through to the call the occupant draws', () => {
    const block = root('w1', { name: 'bash', argsRaw: '{"command":"ls"}' })
    const treeProps = props(block, undefined, undefined, {
      frame: owner => <button type="button" onClick={owner.inspect}>inspect</button>,
    })
    render(<ToolCallTree {...treeProps} />)
    fireEvent.click(screen.getByText('inspect'))
    expect(treeProps.inspectCall).toHaveBeenCalledWith('w1')
  })
})

describe('frameTurn', () => {
  const placed = { turn: 7, start: { seq: 100 }, steps: [], data: { get: () => undefined } } as never

  it('reads the turn of a turn-placed and a step-placed node, and none otherwise', () => {
    expect(frameTurn({ kind: 'turn', turn: placed })).toBe(7)
    expect(frameTurn({ kind: 'step', turn: placed, step: { turn: 7, step: 1 } as never })).toBe(7)
    expect(frameTurn({ kind: 'session' })).toBeNull()
    expect(frameTurn({ kind: 'unresolved' })).toBeNull()
  })
})

describe('frameSelection', () => {
  const node = (location: ToolTreeProps['node']['location']): ToolTreeProps['node'] => ({
    key: 'k', kind: 'tool-call', id: 'w1', target: 'chat', anchorSeq: 42,
    location, visibility: 'visible', data: { root: root('w1', null) },
  } as unknown as ToolTreeProps['node'])
  const turn = { turn: 7, start: { seq: 100 }, steps: [], data: { get: () => undefined } } as never
  const headless = { turn: 7, start: undefined, steps: [], data: { get: () => undefined } } as never

  it('reads the turn boundary of a turn-placed node', () => {
    expect(frameSelection(node({ kind: 'turn', turn }), 'w1', 'bash'))
      .toEqual({ turnSeq: 100, callId: 'w1', toolName: 'bash' })
  })

  it('adds the step boundary of a step-placed node', () => {
    const step = { turn: 7, step: 2, start: { seq: 120 } } as never
    expect(frameSelection(node({ kind: 'step', turn, step }), 'w1', 'bash'))
      .toEqual({ turnSeq: 100, stepSeq: 120, callId: 'w1', toolName: 'bash' })
  })

  it('omits a step boundary the window cut away', () => {
    const step = { turn: 7, step: 2, start: undefined } as never
    expect(frameSelection(node({ kind: 'step', turn, step }), 'w1', 'bash'))
      .toEqual({ turnSeq: 100, callId: 'w1', toolName: 'bash' })
  })

  it('falls back to the node anchor for a turn boundary outside the window, and for no placement', () => {
    expect(frameSelection(node({ kind: 'turn', turn: headless }), 'w1', 'bash'))
      .toEqual({ turnSeq: 42, callId: 'w1', toolName: 'bash' })
    expect(frameSelection(node({ kind: 'session' }), 'w1', 'bash'))
      .toEqual({ turnSeq: 42, callId: 'w1', toolName: 'bash' })
    expect(frameSelection(node({ kind: 'unresolved' }), 'w1', 'bash'))
      .toEqual({ turnSeq: 42, callId: 'w1', toolName: 'bash' })
  })
})
