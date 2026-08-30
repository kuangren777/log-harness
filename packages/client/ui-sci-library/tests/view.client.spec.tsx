// @vitest-environment jsdom
/**
 * The library list: what its four states draw, which gestures reach the
 * injected face, and the proof that every count on screen is read off the page
 * the host returned rather than computed here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { LibraryEntry, SciLibraryInjected } from '../src/client/contract.ts'
import { LibraryView, QUERY_DEBOUNCE_MS, type LibraryViewProps } from '../src/client/LibraryView.tsx'
import { createLibraryStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { BARE, FULL, pageOf } from './entries.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** The injected face, with every member stubbed and overridable per case. */
function faceOf(overrides: Partial<SciLibraryInjected> = {}) {
  return {
    list: vi.fn(async () => ({ ok: true as const, value: pageOf([FULL, BARE]) })),
    get: vi.fn(async () => ({ ok: true as const, value: FULL })),
    update: vi.fn(async () => ({ ok: true as const, value: FULL })),
    remove: vi.fn(async () => ({ ok: true as const, value: null })),
    related: vi.fn(async (): Promise<readonly LibraryEntry[]> => [BARE]),
    fetchPdf: vi.fn(async () => ({ ok: true as const, value: FULL })),
    upload: vi.fn(async () => ({ ok: true as const, entry: BARE })),
    readText: vi.fn(async () => ({ ok: true as const, text: 'a,b\n1,2' })),
    ...overrides,
  }
}

/** Mount the view over a live store instance, flushing its first read. */
async function mount(overrides: Partial<SciLibraryInjected> = {}) {
  const store = createLibraryStore().create()
  const face = faceOf(overrides)
  const props = {
    useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
  } as unknown as LibraryViewProps
  await act(async () => { render(<LibraryView {...props} />) })
  return { store, face }
}

/** Type into the library's query box. */
function type(text: string): void {
  fireEvent.change(screen.getByLabelText('知识库检索词'), { target: { value: text } })
}

describe('LibraryView header and totals', () => {
  it('reads its subtitle off the counts the host returned', async () => {
    await mount()
    expect(screen.getByRole('heading', { name: '知识库' })).toBeTruthy()
    expect(screen.getByText('4 篇文献 · 2 个数据集')).toBeTruthy()
    expect(screen.getByText('2 / 2 条')).toBeTruthy()
  })

  it('reads the library once on mount, with no filter at all', async () => {
    const b = await mount()
    expect(b.face.list).toHaveBeenCalledTimes(1)
    expect(b.face.list).toHaveBeenCalledWith({})
  })

  it('says it is reading before the first page lands', async () => {
    const store = createLibraryStore().create()
    const face = faceOf({ list: vi.fn(() => new Promise(() => {})) as never })
    const props = {
      useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
    } as unknown as LibraryViewProps
    render(<LibraryView {...props} />)
    expect(screen.getByText('正在读取知识库…')).toBeTruthy()
  })
})

describe('LibraryView cards', () => {
  it('draws every fact an entry carries', async () => {
    await mount()
    expect(screen.getByText(FULL.title)).toBeTruthy()
    expect(screen.getByText('OpenAlex')).toBeTruthy()
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText('在读')).toBeTruthy()
    expect(screen.getByText('被引 187')).toBeTruthy()
    expect(screen.getByText('2 个文件')).toBeTruthy()
    expect(screen.getByText('thermoelectric')).toBeTruthy()
  })

  it('draws no element for a fact the entry does not carry', async () => {
    await mount({ list: vi.fn(async () => ({ ok: true as const, value: pageOf([BARE]) })) as never })
    expect(screen.queryByText(/被引/u)).toBeNull()
    expect(screen.queryByText(/个文件/u)).toBeNull()
    expect(screen.getByText('未读')).toBeTruthy()
  })

  it('opens an entry and reads it with its related list', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(screen.getByTitle(`打开「${FULL.title}」`)) })

    expect(b.face.get).toHaveBeenCalledWith(FULL.id)
    expect(b.face.related).toHaveBeenCalledWith(FULL.id)
    expect(b.store.getSnapshot().selected).toBe(FULL.id)
  })
})

describe('LibraryView filters', () => {
  it('re-reads with the kind of the pressed chip', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '文献 4' })) })
    expect(b.face.list).toHaveBeenLastCalledWith({ kind: 'paper' })
  })

  it('turns the low-confidence chip into the status the host filters by', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '低置信 1' })) })
    expect(b.face.list).toHaveBeenLastCalledWith({ status: 'low-confidence' })
  })

  it('filters by a tag from the cloud, and clears it by pressing it again', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'thermoelectric · 4' })) })
    expect(b.face.list).toHaveBeenLastCalledWith({ tag: 'thermoelectric' })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'thermoelectric · 4' })) })
    expect(b.face.list).toHaveBeenLastCalledWith({})
  })

  it('offers an explicit clear while a tag is pressed', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'snse · 2' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '清除标签筛选' })) })
    expect(b.face.list).toHaveBeenLastCalledWith({})
  })

  it('draws no cloud when the host reported no tag', async () => {
    await mount({
      list: vi.fn(async () => ({ ok: true as const, value: pageOf([FULL], { tags: [] }) })) as never,
    })
    expect(screen.queryByRole('group', { name: '标签' })).toBeNull()
  })
})

describe('LibraryView search box', () => {
  it('lets the query rest before it becomes a read', async () => {
    vi.useFakeTimers()
    try {
      const store = createLibraryStore().create()
      const face = faceOf()
      const props = {
        useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
      } as unknown as LibraryViewProps
      await act(async () => { render(<LibraryView {...props} />) })
      expect(face.list).toHaveBeenCalledTimes(1)

      type('sn')
      type('snse')
      // Still one read: two keystrokes inside the pause are one query.
      expect(face.list).toHaveBeenCalledTimes(1)

      await act(async () => { vi.advanceTimersByTime(QUERY_DEBOUNCE_MS) })
      expect(face.list).toHaveBeenCalledTimes(2)
      expect(face.list).toHaveBeenLastCalledWith({ query: 'snse' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the typed text in the store, so a view switch does not lose it', async () => {
    const b = await mount()
    type('snse')
    expect(b.store.getSnapshot().query).toBe('snse')
    expect(screen.getByLabelText<HTMLInputElement>('知识库检索词').value).toBe('snse')
  })
})

describe('LibraryView empty and failed states', () => {
  it('tells an empty library apart from a query that matched nothing', async () => {
    const empty = pageOf([], { counts: { all: 0, paper: 0, dataset: 0, note: 0, lowConfidence: 0 } })
    const view = await mount({ list: vi.fn(async () => ({ ok: true as const, value: empty })) as never })
    expect(screen.getByText('知识库还是空的。从检索结果里「加入知识库」，或上传一份 PDF、数据文件。')).toBeTruthy()
    cleanup()
    void view

    await mount({ list: vi.fn(async () => ({ ok: true as const, value: pageOf([]) })) as never })
    expect(screen.getByText('没有匹配的条目。换个说法，或清掉筛选条件。')).toBeTruthy()
  })

  it('states the host code when the library cannot be read', async () => {
    await mount({
      list: vi.fn(async () => ({ ok: false as const, code: 'LIBRARY_REMOTE_UNAVAILABLE' })) as never,
    })
    expect(screen.getByRole('alert').textContent).toBe('读取知识库失败（LIBRARY_REMOTE_UNAVAILABLE）。')
  })
})

describe('LibraryView upload', () => {
  /** One picked file, as the browser hands it to the change handler. */
  function pick(name: string, mediaType: string): void {
    const input = screen.getByLabelText('＋ 上传文件')
    fireEvent.change(input, { target: { files: [new File(['bytes'], name, { type: mediaType })] } })
  }

  it('sends a picked PDF as a new paper and names it once stored', async () => {
    const b = await mount()
    await act(async () => { pick('snse.pdf', 'application/pdf') })

    expect(b.face.upload).toHaveBeenCalledWith({
      entryId: 'new', kind: 'paper', file: expect.any(File) as File,
    })
    expect(screen.getByText('已上传 snse.pdf')).toBeTruthy()
    // The stored entry is now known to be in the library.
    expect(b.store.getSnapshot().stored).toContain(BARE.id)
  })

  it('sends anything else as a dataset', async () => {
    const b = await mount()
    await act(async () => { pick('zt.csv', 'text/csv') })
    expect(b.face.upload).toHaveBeenCalledWith({
      entryId: 'new', kind: 'dataset', file: expect.any(File) as File,
    })
  })

  it('states each refusal the route can answer with', async () => {
    const refusals = [
      ['too-large', '文件超过上传上限，未保存。'],
      ['unsupported-type', '不支持这个文件类型，未保存。'],
      ['forbidden', '这次上传未获信任，未保存。'],
      ['failed', '上传失败，未保存。'],
    ] as const
    for (const [code, copy] of refusals) {
      await mount({ upload: vi.fn(async () => ({ ok: false as const, code })) as never })
      await act(async () => { pick('a.bin', 'application/octet-stream') })
      expect(screen.getByRole('alert').textContent).toBe(copy)
      cleanup()
    }
  })

  it('says it is uploading while the route is still out', async () => {
    await mount({ upload: vi.fn(() => new Promise(() => {})) as never })
    await act(async () => { pick('snse.pdf', 'application/pdf') })
    expect(screen.getByText('上传中…')).toBeTruthy()
    // A second pick while the first is in flight changes nothing.
    await act(async () => { pick('other.pdf', 'application/pdf') })
    expect(screen.getByText('上传中…')).toBeTruthy()
  })

  it('ignores a picker the user closed without choosing a file', async () => {
    const b = await mount()
    fireEvent.change(screen.getByLabelText('＋ 上传文件'), { target: { files: [] } })
    expect(b.face.upload).not.toHaveBeenCalled()
  })
})

describe('LibraryView detail route', () => {
  /** Open FULL's card off a freshly mounted list. */
  async function open(overrides: Partial<SciLibraryInjected> = {}) {
    const b = await mount(overrides)
    await act(async () => { fireEvent.click(screen.getByTitle(`打开「${FULL.title}」`)) })
    return b
  }

  it('states a detail read the host refused, and still offers the way back', async () => {
    const b = await open({
      get: vi.fn(async () => ({ ok: false as const, code: 'LIBRARY_NOT_FOUND' })) as never,
    })
    expect(screen.getByRole('alert').textContent).toBe('读取条目失败（LIBRARY_NOT_FOUND）。')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '← 返回知识库' })) })
    expect(b.store.getSnapshot().selected).toBeNull()
  })

  it('walks back to the list from a loaded entry', async () => {
    const b = await open()
    expect(screen.getByRole('heading', { name: FULL.title })).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '← 返回知识库' })) })
    expect(b.store.getSnapshot().selected).toBeNull()
  })

  it('hops to a related entry without leaving the detail route', async () => {
    const b = await open()
    await act(async () => { fireEvent.click(screen.getByText(BARE.title)) })
    expect(b.store.getSnapshot().selected).toBe(BARE.id)
    expect(b.face.get).toHaveBeenLastCalledWith(BARE.id)
  })

  it('writes a saved patch through to the shared page', async () => {
    const read = { ...FULL, status: 'verified' as const }
    const b = await open({ update: vi.fn(async () => ({ ok: true as const, value: read })) as never })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'verified' } })
    })
    expect(b.face.update).toHaveBeenCalledWith(FULL.id, { status: 'verified' })
    // The store shows what the host returned, in the detail and the list row.
    expect(b.store.getSnapshot().detail).toEqual(read)
    expect(b.store.getSnapshot().page?.entries.find(row => row.id === FULL.id)?.status).toBe('verified')
  })

  it('leaves the list without the removed entry', async () => {
    const b = await open()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })) })

    expect(b.face.remove).toHaveBeenCalledWith(FULL.id)
    expect(b.store.getSnapshot().selected).toBeNull()
    expect(b.store.getSnapshot().page?.entries.map(row => row.id)).toEqual([BARE.id])
  })
})
