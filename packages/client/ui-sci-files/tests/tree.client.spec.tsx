// @vitest-environment jsdom
/**
 * The project tree: lazy per-level listing, the two hiding/tagging rules, the
 * level-failure states, and the two gestures it reports upward.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DirectoryErrorCode, DirectoryOutcome, SciFileEntry } from '../src/client/contract.ts'
import type { SciFilesKey } from '../src/client/locales.ts'
import { FileTree } from '../src/client/FileTree.tsx'

afterEach(cleanup)

const ROOT = '/p'
const SESSION = 's1' as SessionId
const t: Translate<SciFilesKey> = key => key

function level(entries: readonly SciFileEntry[]): DirectoryOutcome {
  return { ok: true, entries }
}

function directory(name: string, parent = ROOT): SciFileEntry {
  return { name, path: `${parent}/${name}`, kind: 'directory' }
}

function file(name: string, parent = ROOT): SciFileEntry {
  return { name, path: `${parent}/${name}`, kind: 'file' }
}

/** Render the tree over a levels table, with the props the mode supplies. */
function mount(levels: Readonly<Record<string, DirectoryOutcome>>, overrides: {
  expanded?: ReadonlySet<string>
  selectedPath?: string
  onToggle?: (path: string) => void
  onSelect?: (path: string) => void
} = {}) {
  const listDirectory = vi.fn(async (_session: SessionId, path: string) => levels[path] ?? level([]))
  const props = {
    sessionId: SESSION,
    root: ROOT,
    expanded: overrides.expanded ?? new Set<string>(),
    selectedPath: overrides.selectedPath,
    listDirectory,
    onToggle: overrides.onToggle ?? vi.fn(),
    onSelect: overrides.onSelect ?? vi.fn(),
    t,
  }
  const view = render(<FileTree {...props} />)
  return { view, listDirectory, props }
}

describe('FileTree', () => {
  it('shows the loading note until the root level answers', async () => {
    let settle: (outcome: DirectoryOutcome) => void = () => {}
    const listDirectory = vi.fn(async () => new Promise<DirectoryOutcome>((resolve) => { settle = resolve }))
    render(
      <FileTree
        sessionId={SESSION} root={ROOT} expanded={new Set()} selectedPath={undefined}
        listDirectory={listDirectory} onToggle={vi.fn()} onSelect={vi.fn()} t={t}
      />,
    )
    expect(screen.getByText('tree.loading')).toBeTruthy()
    await act(async () => { settle(level([file('a.md')])) })
    expect(screen.getByText('a.md')).toBeTruthy()
  })

  it('lists the session cwd, files included, and hides the dotfiles the gateway sends', async () => {
    const b = mount({
      [ROOT]: level([directory('.git'), directory('versions'), file('.env'), file('report.md')]),
    })
    await screen.findByText('report.md')
    expect(b.listDirectory).toHaveBeenCalledWith(SESSION, ROOT)
    expect(screen.queryByText('.git')).toBeNull()
    expect(screen.queryByText('.env')).toBeNull()
    expect(screen.getByText('versions')).toBeTruthy()
    expect(screen.getByText('tree.versions')).toBeTruthy()
  })

  it('shows an entry that is neither directory nor file, without making it actionable', async () => {
    const onSelect = vi.fn()
    mount({ [ROOT]: level([{ name: 'daemon.sock', path: `${ROOT}/daemon.sock`, kind: 'other' }]) }, { onSelect })
    const row = await screen.findByText('daemon.sock')
    fireEvent.click(row)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('states an empty level', async () => {
    mount({ [ROOT]: level([]) })
    expect(await screen.findByText('tree.empty')).toBeTruthy()
  })

  it('gives every listing failure its own reason', async () => {
    const codes: readonly DirectoryErrorCode[] = [
      'path-out-of-scope', 'file-not-found', 'not-a-directory', 'too-many-entries',
      'session-not-found', 'cancelled', 'internal',
    ]
    for (const code of codes) {
      mount({ [ROOT]: { ok: false, code } })
      expect((await screen.findByRole('alert')).textContent).toBe(`tree.error.${code}`)
      cleanup()
    }
  })

  it('lists a directory the first time it opens, and reports the toggle gesture', async () => {
    const onToggle = vi.fn()
    const levels = {
      [ROOT]: level([directory('src')]),
      [`${ROOT}/src`]: level([file('main.py', `${ROOT}/src`)]),
    }
    const first = mount(levels, { onToggle })
    await screen.findByText('src')
    expect(first.listDirectory).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('src'))
    expect(onToggle).toHaveBeenCalledWith(`${ROOT}/src`)

    // The mode answers the toggle by widening the expanded set.
    first.view.rerender(<FileTree {...first.props} expanded={new Set([`${ROOT}/src`])} />)
    expect(await screen.findByText('main.py')).toBeTruthy()
    expect(first.listDirectory).toHaveBeenCalledWith(SESSION, `${ROOT}/src`)
    expect(screen.getByRole('treeitem', { name: /src/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('marks the shown file and reports a pick', async () => {
    const onSelect = vi.fn()
    mount({ [ROOT]: level([file('a.md'), file('b.md')]) }, { selectedPath: `${ROOT}/a.md`, onSelect })
    await screen.findByText('a.md')
    const rows = screen.getAllByRole('treeitem')
    expect(rows.map(row => row.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    fireEvent.click(screen.getByText('b.md'))
    expect(onSelect).toHaveBeenCalledWith(`${ROOT}/b.md`)
  })

  it('discards a level that settles after the panel is gone', async () => {
    let settle: (outcome: DirectoryOutcome) => void = () => {}
    const listDirectory = vi.fn(async () => new Promise<DirectoryOutcome>((resolve) => { settle = resolve }))
    const view = render(
      <FileTree
        sessionId={SESSION} root={ROOT} expanded={new Set()} selectedPath={undefined}
        listDirectory={listDirectory} onToggle={vi.fn()} onSelect={vi.fn()} t={t}
      />,
    )
    view.unmount()
    // No "state update on an unmounted component" and no throw: the
    // settlement is dropped by the liveness guard.
    await act(async () => { settle(level([file('a.md')])) })
    expect(screen.queryByText('a.md')).toBeNull()
  })

  it('asks for each level once, however often the tree re-renders', async () => {
    const first = mount({ [ROOT]: level([file('a.md')]) })
    await screen.findByText('a.md')
    first.view.rerender(<FileTree {...first.props} selectedPath={`${ROOT}/a.md`} />)
    await waitFor(() => { expect(first.listDirectory).toHaveBeenCalledTimes(1) })
  })
})
