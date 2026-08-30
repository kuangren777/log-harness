// @vitest-environment jsdom
/**
 * The Files mode itself: what it draws while inactive or project-less, and
 * the auto-locate rule — follow the newest produced file and reveal it, until
 * the user picks one, and follow again the moment something newer appears.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConversationNode, ConversationSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationSnapshot, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { DirectoryOutcome, FileReadOutcome, OfficeStateOutcome } from '../src/client/contract.ts'
import { FilesMode, type FilesModeProps } from '../src/client/FilesMode.tsx'
import { createSciFilesStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'

/** One markdown file as `workspace.readFile` returns it. */
const REPORT: FileReadOutcome = {
  ok: true,
  file: {
    path: '/p/deliverables/report.md', size: 2048, mediaType: 'text/markdown',
    encoding: 'utf8', content: '# Title',
  },
}

/** A delivery of the file above. */
const DELIVERED = '{"files":[{"path":"/p/deliverables/report.md"}]}'

const SESSION = 's1' as SessionId
const CWD = '/p'

afterEach(cleanup)

/** A settled successful call of one locating tool. */
function produced(name: string, argsRaw: string): ConversationNode {
  return {
    kind: 'tool-result', seq: 1, time: 0, callId: 'c1',
    call: { name, argsRaw }, callTime: null, content: [], isError: false,
    callView: null, resultView: null, subCalls: [],
  }
}

/** Build the mode's four props shares over a real store and a fixed snapshot. */
function bench(options: { cwd?: string | undefined; active?: boolean; nodes?: readonly ConversationNode[] } = {}) {
  const store = createSciFilesStore().create(SESSION)
  const snapshot: ConversationSnapshot = { ...conversationSnapshot(SESSION), nodes: options.nodes ?? [] }
  const listDirectory = vi.fn(async (_sessionId: SessionId, _path: string): Promise<DirectoryOutcome> => ({ ok: true, entries: [] }))
  const readFile = vi.fn(async (): Promise<FileReadOutcome> => ({ ok: false, code: 'file-not-found' }))
  const officeState = vi.fn(async (): Promise<OfficeStateOutcome> => ({ ok: false }))
  const closeDetails = vi.fn()
  const props = {
    sessionId: SESSION,
    cwd: 'cwd' in options ? options.cwd : CWD,
    active: options.active ?? true,
    useSession: <S,>(select: (s: ConversationSnapshot) => S): S => select(snapshot),
    files: store,
    layout: { closeDetails },
    listDirectory,
    readFile,
    officeState,
    t: makeTranslate(zh),
  } as unknown as FilesModeProps
  return { props, store, listDirectory, readFile, officeState, closeDetails }
}

describe('FilesMode', () => {
  it('draws nothing, and asks for nothing, while another mode shows', async () => {
    const b = bench({ active: false, nodes: [produced('univer_export', '{"output":"/p/out/a.xlsx"}')] })
    const view = render(<FilesMode {...b.props} />)
    await act(async () => {})
    expect(view.container.innerHTML).toBe('')
    expect(b.listDirectory).not.toHaveBeenCalled()
    expect(b.readFile).not.toHaveBeenCalled()
  })

  it('shows only the preview for a session with no project directory', async () => {
    const b = bench({ cwd: undefined, nodes: [produced('deliver_files', '{"files":[{"path":"/p/d/a.md"}]}')] })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    expect(b.listDirectory).not.toHaveBeenCalled()
    // The produced file still previews: locating never needed the tree.
    expect(b.readFile).toHaveBeenCalledWith(SESSION, '/p/d/a.md')
  })

  it('follows the newest produced file and opens the directories that reveal it', async () => {
    const b = bench({
      nodes: [
        produced('univer_new', '{"file":"/p/workspace/book.univer"}'),
        produced('deliver_files', '{"files":[{"path":"/p/deliverables/report.pdf"}]}'),
      ],
    })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    expect(b.readFile).toHaveBeenCalledWith(SESSION, '/p/deliverables/report.pdf')
    await waitFor(() => {
      expect(b.listDirectory.mock.calls.map(call => call[1])).toEqual(['/p', '/p/deliverables'])
    })
  })

  it('keeps the user pick, and stops widening the tree for it', async () => {
    const b = bench({ nodes: [produced('deliver_files', '{"files":[{"path":"/p/deliverables/report.pdf"}]}')] })
    const view = render(<FilesMode {...b.props} />)
    await act(async () => {})
    b.listDirectory.mockClear()
    b.readFile.mockClear()

    act(() => { b.store.actions.pin('/p/notes.md', '/p/deliverables/report.pdf') })
    view.rerender(<FilesMode {...b.props} />)
    await act(async () => {})
    expect(b.readFile).toHaveBeenCalledWith(SESSION, '/p/notes.md')
    // The pick's own ancestry is already open by construction (the user
    // walked to it), so nothing new is requested for it.
    expect(b.listDirectory).not.toHaveBeenCalled()
  })

  it('yields to a newer production, so a second delivery locates itself', async () => {
    const first = produced('deliver_files', '{"files":[{"path":"/p/deliverables/first.pdf"}]}')
    const b = bench({ nodes: [first] })
    const view = render(<FilesMode {...b.props} />)
    await act(async () => {})

    act(() => { b.store.actions.pin('/p/notes.md', '/p/deliverables/first.pdf') })
    view.rerender(<FilesMode {...b.props} />)
    await act(async () => {})
    b.readFile.mockClear()

    // A second delivery lands: the pick was made over the first one, so the
    // mode follows the new file rather than sitting on a stale pick.
    const later = bench({
      nodes: [first, produced('deliver_files', '{"files":[{"path":"/p/deliverables/second.pdf"}]}')],
    })
    view.rerender(<FilesMode {...later.props} files={b.props.files} />)
    await act(async () => {})
    expect(later.readFile).toHaveBeenCalledWith(SESSION, '/p/deliverables/second.pdf')
  })

  it('records a tree pick against what the session had produced', async () => {
    const b = bench({ nodes: [produced('univer_export', '{"output":"/p/out/a.xlsx"}')] })
    b.listDirectory.mockResolvedValue({
      ok: true,
      entries: [{ name: 'main.py', path: '/p/main.py', kind: 'file' }],
    })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    fireEvent.click(screen.getByText('main.py'))
    expect(b.store.getSnapshot().pinned).toEqual({ path: '/p/main.py', over: '/p/out/a.xlsx' })
  })

  it('records a pick made before the session produced anything', async () => {
    const b = bench()
    b.listDirectory.mockResolvedValue({
      ok: true,
      entries: [{ name: 'main.py', path: '/p/main.py', kind: 'file' }],
    })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    fireEvent.click(screen.getByText('main.py'))
    expect(b.store.getSnapshot().pinned).toEqual({ path: '/p/main.py', over: null })
  })
})

describe('FilesMode panel header and chips', () => {
  it('describes the shown file from the read the preview already made', async () => {
    const b = bench({ nodes: [produced('deliver_files', DELIVERED)] })
    b.readFile.mockResolvedValue(REPORT)
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    expect(screen.getByText('2 KB · text/markdown')).toBeTruthy()
    // One read, shared by the header, the source reading, and the download.
    expect(b.readFile).toHaveBeenCalledTimes(1)
  })

  it('shows the file source without reading it again, and keeps the preview mounted', async () => {
    const b = bench({ nodes: [produced('deliver_files', DELIVERED)] })
    b.readFile.mockResolvedValue(REPORT)
    const view = render(<FilesMode {...b.props} />)
    await act(async () => {})

    fireEvent.click(screen.getByText(zh['panel.source']))
    expect(view.container.querySelector('pre')?.textContent).toBe('# Title')
    expect(view.container.querySelector('[hidden]')).toBeTruthy()
    expect(b.readFile).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText(zh['panel.preview']))
    expect(view.container.querySelector('[hidden]')).toBeNull()
  })

  it('offers no source reading for a file no read produced bytes for', async () => {
    const b = bench({ nodes: [produced('univer_new', '{"file":"/p/w/book.univer"}')] })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    // An office document is framed by the runtime, never read here.
    expect(b.readFile).not.toHaveBeenCalled()
    expect(screen.getByText(zh['panel.source']).hasAttribute('disabled')).toBe(true)
  })

  it('falls back to the preview when the selection loses its source reading', async () => {
    const b = bench({ nodes: [produced('deliver_files', DELIVERED)] })
    b.readFile.mockResolvedValue(REPORT)
    const view = render(<FilesMode {...b.props} />)
    await act(async () => {})
    fireEvent.click(screen.getByText(zh['panel.source']))
    expect(view.container.querySelector('[hidden]')).toBeTruthy()

    b.readFile.mockResolvedValue({
      ok: true,
      file: { path: '/p/d/plot.png', size: 40, mediaType: 'image/png', encoding: 'base64', content: 'AAA=' },
    })
    act(() => { b.store.actions.pin('/p/d/plot.png', '/p/deliverables/report.md') })
    await act(async () => {})
    expect(view.container.querySelector('[hidden]')).toBeNull()
    expect(screen.getByText(zh['panel.source']).hasAttribute('disabled')).toBe(true)
  })

  it('saves the shown file, and drives the close gesture', async () => {
    const revokeObjectURL = vi.fn<(url: string) => void>()
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock/0'),
      revokeObjectURL,
    }))
    const b = bench({ nodes: [produced('deliver_files', DELIVERED)] })
    b.readFile.mockResolvedValue(REPORT)
    render(<FilesMode {...b.props} />)
    await act(async () => {})

    fireEvent.click(screen.getByLabelText(zh['panel.download']))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/0')
    fireEvent.click(screen.getByLabelText(zh['panel.close']))
    expect(b.closeDetails).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('pins the produced file a chip names', async () => {
    const b = bench({
      nodes: [
        produced('deliver_files', DELIVERED),
        produced('univer_export', '{"output":"/p/out/table.xlsx"}'),
      ],
    })
    render(<FilesMode {...b.props} />)
    await act(async () => {})
    fireEvent.click(screen.getByText('report.md'))
    expect(b.store.getSnapshot().pinned).toEqual({ path: '/p/deliverables/report.md', over: '/p/out/table.xlsx' })
  })
})
