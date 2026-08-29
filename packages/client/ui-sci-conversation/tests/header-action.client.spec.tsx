// @vitest-environment jsdom
/**
 * The session header's open-output action: when it exists at all, and what it
 * asks the panel for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { conversationSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ConversationNode, ConversationSnapshot, SessionId, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { OpenArtifactsAction } from '../src/client/OpenArtifactsAction.tsx'
import type { OpenArtifactsActionProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 's1' as SessionId

/** A settled successful export, the plainest thing a session can produce. */
function exported(path: string): ToolResultNode {
  return {
    kind: 'tool-result', seq: 7, time: 0, callId: 'c1',
    call: { name: 'univer_export', argsRaw: JSON.stringify({ output: path }) },
    callTime: null, content: [], isError: false, callView: null, resultView: null, subCalls: [],
  }
}

/** Mount the action over one session window. */
function mount(nodes: readonly ConversationNode[]) {
  const showDetailsMode = vi.fn()
  const snapshot: ConversationSnapshot = { ...conversationSnapshot(SESSION), nodes }
  const props = {
    useSession: (selector: (s: ConversationSnapshot) => unknown) => selector(snapshot),
    showDetailsMode,
    t: makeTranslate(zh),
  } as unknown as OpenArtifactsActionProps
  return { view: render(<OpenArtifactsAction {...props} />), showDetailsMode }
}

describe('OpenArtifactsAction', () => {
  it('renders nothing while the session has produced nothing to open', () => {
    const { view } = mount([])
    expect(view.container.innerHTML).toBe('')
  })

  it('appears once the session has produced a file, and brings the files mode forward', () => {
    const { showDetailsMode } = mount([exported('/w/out/report.xlsx')])
    fireEvent.click(screen.getByText(zh['header.openArtifacts']))
    expect(showDetailsMode).toHaveBeenCalledWith('files')
  })

  it('stays away for a window whose only producing call failed', () => {
    const { view } = mount([{ ...exported('/w/out/report.xlsx'), isError: true }])
    expect(view.container.innerHTML).toBe('')
  })
})
