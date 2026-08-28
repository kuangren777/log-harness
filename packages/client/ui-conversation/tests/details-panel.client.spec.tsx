// @vitest-environment jsdom
/**
 * The details column as a mode host: the tab strip stays absent while the
 * built-in call inspector is the only mode, mode selection rides the shared
 * chat store, and a stored id naming no live entry falls back to that
 * inspector. The tool mode's own body lives in gate-branch-tails.spec.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId, SessionListState, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionProviderComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import { DetailsPanel, DetailsToolMode } from '../src/client/skeleton/DetailsPanel.tsx'
import type { DetailsPanelProps } from '../src/client/skeleton/DetailsPanel.tsx'
import type { DetailsModeOwnerProps, DetailsToolModeProps } from '../src/client/contract/slots.ts'
import type { DetailsModeTab, SelectionTarget } from '../src/client/contract/views.ts'
import { zh } from '../src/client/locales.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const t: DetailsPanelProps['t'] = makeTranslate(zh, commonZh)
const SID = 's1' as SessionId
const TOOL_MODE: DetailsModeTab = { id: 'tool', label: '工具' }
const FILES_MODE: DetailsModeTab = { id: 'files', label: '文件' }
const CALL_SELECTION: SelectionTarget = { turnSeq: 1, callId: 'c9', toolName: 'bash' }

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup() })

/** Minimal framework seat for direct DetailsPanel host tests. */
const SessionProviderStub: SessionProviderComponent = ({ children }) => children(SID)

function snapshot(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open',
    openError: null, hasMore: false, loadingOlder: false, promptError: null, blank: false,
    subagent: null, lastAgentError: null,
  }
}

/** Render the panel over a live chat store and a scripted mode ledger. */
function mountPanel(tabs: readonly DetailsModeTab[], snap: ConversationSnapshot = snapshot()) {
  const chat = createChatStore().create()
  const owners: DetailsModeOwnerProps[] = []
  const sessions = createSnapshotStore<SessionListState>({
    ids: [SID], byId: { [SID]: { id: SID, displayTitle: 's', cwd: '/proj', running: false, blank: false, updatedAt: 1 } },
    current: SID, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  // The ledger the details inject projects; `only` is the panel's mode choice.
  const renderSlot: DetailsPanelProps['renderSlot'] = (_key, owner, opts) => {
    owners.push(owner as unknown as DetailsModeOwnerProps)
    return <div data-testid={`mode-body-${String(opts?.only)}`} />
  }
  const closeDetails = vi.fn()
  const view = render(
    <DetailsPanel
      SessionProvider={SessionProviderStub}
      renderSlot={renderSlot}
      sessionId={SID}
      useSession={bindSnapshotSelector({ getSnapshot: () => snap, subscribe: () => () => {} })}
      useSessions={bindSnapshotSelector(sessions)}
      useWorkspaces={bindSnapshotSelector(workspaces)}
      useProjection={(() => undefined)}
      useInput={(() => { throw new Error('unused') })}
      inputActions={{
        setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {},
      }}
      useStore={bindSnapshotSelector(chat)}
      actions={chat.actions}
      closeDetails={closeDetails}
      modes={{ list: () => tabs, subscribe: () => () => {}, version: () => 1 }}
      t={t}
    />,
  )
  return { view, chat, owners, closeDetails }
}

/** One snapshot frame carrying a single running call. */
function runningCallFrame(argsRaw: string): ConversationSnapshot {
  const snap = snapshot()
  snap.runningCalls = [{
    callId: 'c9', name: 'bash', argsRaw, turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
  }]
  snap.chat = chatSnapshotFixture({ runningCalls: snap.runningCalls })
  return snap
}

/** Render the built-in mode over one snapshot frame and selection. */
function mountToolMode(frame: ConversationSnapshot, selected: SelectionTarget | null) {
  const chat = createChatStore().create()
  if (selected !== null) chat.actions.select(selected)
  const session = createSnapshotStore<ConversationSnapshot>(frame)
  const view = render(
    <DetailsToolMode
      SessionProvider={SessionProviderStub}
      renderSlot={((_key, _owner, opts) => opts?.fallback ?? null) as DetailsToolModeProps['renderSlot']}
      sessionId={SID}
      active
      useSession={bindSnapshotSelector(session)}
      useSessions={bindSnapshotSelector(createSnapshotStore<SessionListState>({
        ids: [], byId: {}, current: undefined, phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      }))}
      useWorkspaces={bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
        baselinesReady: true, recentWorkspaceId: undefined,
      }))}
      useProjection={(() => undefined)}
      useInput={(() => { throw new Error('unused') })}
      inputActions={{
        setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {},
      }}
      useStore={bindSnapshotSelector(chat)}
      actions={chat.actions}
      t={t}
    />,
  )
  return { view, session }
}

describe('details column mode host', () => {
  it('keeps the lone built-in mode untabbed and titled by the selected call', () => {
    const b = mountPanel([TOOL_MODE])
    expect(b.view.queryByRole('tablist')).toBeNull()
    // The body is the tool entry's, dispatched through the mode slot.
    expect(b.view.getByTestId('mode-body-tool')).toBeTruthy()
    expect(b.view.getByText('详情')).toBeTruthy()
    // Owner currency: session identity, the workspace root, and the shown flag.
    expect(b.owners[0]).toEqual({ sessionId: SID, cwd: '/proj', active: true })
    // The close button stays the panel's own control.
    fireEvent.click(b.view.getByLabelText('关闭详情'))
    expect(b.closeDetails).toHaveBeenCalledTimes(1)
  })

  it('titles the header with the selected call name while the tool mode shows', () => {
    const b = mountPanel([TOOL_MODE])
    act(() => { b.chat.actions.select({ turnSeq: 1, callId: 'c1', toolName: 'read' }) })
    // No material in the window: the selection's own tool name carries the title.
    expect(b.view.getByText('read')).toBeTruthy()
  })

  it('titles the header with the running call resolved off the snapshot', () => {
    const snap = snapshot()
    snap.runningCalls = [{
      callId: 'c9', name: 'bash', argsRaw: '{}', turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
    }]
    snap.chat = chatSnapshotFixture({ runningCalls: snap.runningCalls })
    const b = mountPanel([TOOL_MODE], snap)
    act(() => { b.chat.actions.select({ turnSeq: 1, callId: 'c9', toolName: 'stale-name' }) })
    // The live call's own name wins over the selection's recorded one.
    expect(b.view.getByText('bash')).toBeTruthy()
  })

  it('titles the header by callId when the window truncated the call head', () => {
    const frame = snapshot()
    frame.runningCalls = [{
      callId: 'p1', name: 'run_code', argsRaw: '{}', turn: 1, step: 1, time: 1_000, callView: null,
      subCalls: [{
        kind: 'tool-result', seq: 2, time: 2_000, callId: 'c9', call: null, callTime: 1_500,
        content: [], isError: false, callView: null, resultView: null, subCalls: [],
      }],
    }]
    frame.chat = chatSnapshotFixture({ runningCalls: frame.runningCalls })
    const b = mountPanel([TOOL_MODE], frame)
    act(() => { b.chat.actions.select({ turnSeq: 1, callId: 'c9' }) })
    expect(b.view.getByText('c9')).toBeTruthy()
  })

  it('strips tabs from the second mode on and switches body and title on click', () => {
    const b = mountPanel([TOOL_MODE, FILES_MODE])
    const tabs = b.view.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['工具', '文件'])
    expect(tabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])

    fireEvent.click(tabs[1]!)
    expect(b.chat.store.getSnapshot().detailsMode).toBe('files')
    expect(b.view.getByTestId('mode-body-files')).toBeTruthy()
    expect(b.view.queryByTestId('mode-body-tool')).toBeNull()
    // A contributed mode titles the header with its own tab label (the tab
    // row keeps the second occurrence).
    expect(b.view.getAllByText('文件')).toHaveLength(2)
    expect(b.view.queryByText('详情')).toBeNull()
    expect(b.view.getAllByRole('tab').map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])

    // The tool-call gesture (openDetails) writes the mode back through the store.
    act(() => { b.chat.actions.setDetailsMode('tool') })
    expect(b.view.getByTestId('mode-body-tool')).toBeTruthy()
  })

  it('falls back to the built-in mode when the stored id names no live entry', () => {
    // The mode's plugin unmounted (or the persisted id predates it): the
    // column shows the inspector rather than an empty body.
    const b = mountPanel([TOOL_MODE])
    act(() => { b.chat.actions.setDetailsMode('files') })
    expect(b.view.getByTestId('mode-body-tool')).toBeTruthy()
    expect(b.view.queryByRole('tablist')).toBeNull()
  })

  it('shows a streaming args fragment verbatim instead of failing to pretty-print it', () => {
    // A call still streaming its arguments has no parseable JSON yet.
    const b = mountToolMode(runningCallFrame('{"cmd": "ls -'), CALL_SELECTION)
    // CodeBlock tokenizes the text, so read the section's flattened content.
    expect(b.view.container.textContent).toContain('{"cmd": "ls -')
    // A later snapshot frame re-reads the call through the equality guard.
    act(() => { b.session.set(runningCallFrame('{"cmd": "ls -l')) })
    expect(b.view.container.textContent).toContain('{"cmd": "ls -l')
  })

  it('invites a selection while the tool mode has none', () => {
    const b = mountToolMode(snapshot(), null)
    expect(b.view.getByText('点击消息流中的工具行查看详情')).toBeTruthy()
  })

  it('flattens a settled failure with no logged call into its error line', () => {
    // A result the log never paired with its call: the callId carries the
    // heading and the error name/code stands in for absent content.
    const frame = snapshot()
    frame.runningCalls = [{
      callId: 'p1', name: 'run_code', argsRaw: '{}', turn: 1, step: 1, time: 1_000, callView: null,
      subCalls: [{
        kind: 'tool-result', seq: 2, time: 2_000, callId: 'c9', call: null, callTime: 1_500,
        content: [], isError: true, error: { name: 'ToolError', code: 'denied' },
        callView: null, resultView: null, subCalls: [],
      }],
    }]
    frame.chat = chatSnapshotFixture({ runningCalls: frame.runningCalls })
    const b = mountToolMode(frame, CALL_SELECTION)
    expect(b.view.container.textContent).toContain('ToolError: denied')
  })

  it('serializes a non-text result item into the raw output fallback', () => {
    const frame = snapshot()
    frame.runningCalls = [{
      callId: 'p1', name: 'run_code', argsRaw: '{}', turn: 1, step: 1, time: 1_000, callView: null,
      subCalls: [{
        kind: 'tool-result', seq: 2, time: 2_000, callId: 'c9', call: { name: 'read', argsRaw: '{}' },
        callTime: 1_500,
        content: [{
          type: 'image',
          attachment: {
            attachmentId: 'a1' as ImageAttachmentRef['attachmentId'],
            mediaType: 'image/png', bytes: 4, width: 1, height: 1,
          },
        }],
        isError: false, callView: null, resultView: null, subCalls: [],
      }],
    }]
    frame.chat = chatSnapshotFixture({ runningCalls: frame.runningCalls })
    const b = mountToolMode(frame, CALL_SELECTION)
    expect(b.view.container.textContent).toContain('"mediaType": "image/png"')
  })

  it('opens on the built-in inspector for a snapshot persisted before the mode field', () => {
    localStorage.setItem(
      'dsh.conversation.chat', JSON.stringify({ selection: null, draft: '', view: null, inspect: null }))
    const b = mountPanel([TOOL_MODE, FILES_MODE])
    expect(b.chat.store.getSnapshot().detailsMode).toBeUndefined()
    expect(b.view.getByTestId('mode-body-tool')).toBeTruthy()
  })

  it('renders chrome alone while the mode ring is empty', () => {
    // The declaring entry's own mode registration is gone (a disposed fiber
    // mid-teardown): the column keeps its header instead of crashing.
    const b = mountPanel([])
    expect(b.view.getByText('详情')).toBeTruthy()
    expect(b.view.queryByRole('tablist')).toBeNull()
    expect(b.owners).toEqual([])
  })
})
