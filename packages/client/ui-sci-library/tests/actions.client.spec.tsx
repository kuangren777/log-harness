// @vitest-environment jsdom
/**
 * The two surfaces this package puts into other packages' seats: the rail
 * button, and the 「加入知识库」 action on ②'s result cards — whose state is
 * the shared store's id set rather than anything the button remembers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AddToLibrary, type AddToLibraryProps } from '../src/client/AddToLibrary.tsx'
import { LibraryRailItem, type LibraryRailItemProps } from '../src/client/RailItem.tsx'
import { createLibraryStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { BARE, FULL } from './entries.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** The record ② hands the action, as its owner share carries it. */
const RECORD = {
  id: FULL.id,
  title: FULL.title,
  authors: FULL.authors,
  url: FULL.url,
  source: 'openalex',
  sources: ['openalex'],
}

describe('LibraryRailItem', () => {
  /** The button's props over one view id. */
  function itemProps(view: string, showView = vi.fn()) {
    return {
      props: { view, showView, t } as unknown as LibraryRailItemProps,
      showView,
    }
  }

  it('is pressed exactly while the frame shows the library view', () => {
    const view = render(<LibraryRailItem {...itemProps('library').props} />)
    expect(screen.getByRole('button', { name: '知识库' }).getAttribute('aria-pressed')).toBe('true')
    view.unmount()

    render(<LibraryRailItem {...itemProps('conversation').props} />)
    expect(screen.getByRole('button', { name: '知识库' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('routes the frame to the library view', () => {
    const b = itemProps('conversation')
    render(<LibraryRailItem {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: '知识库' }))
    expect(b.showView).toHaveBeenCalledWith('library')
  })
})

describe('AddToLibrary', () => {
  /** Mount the action over a live store instance. */
  function mount(overrides: { add?: unknown; stored?: readonly string[] } = {}) {
    const store = createLibraryStore().create()
    if (overrides.stored !== undefined) store.actions.setStored(overrides.stored)
    const add = overrides.add ?? vi.fn(async () => ({ ok: true as const, value: FULL }))
    const props = {
      record: RECORD,
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      add,
      t,
    } as unknown as AddToLibraryProps
    render(<AddToLibrary {...props} />)
    return { store, add: add as ReturnType<typeof vi.fn> }
  }

  it('offers the gesture for a record the library does not hold', () => {
    mount()
    expect(screen.getByRole('button', { name: '加入知识库' })).toBeTruthy()
  })

  it('reads its stored state off the shared id set, not off a click', () => {
    mount({ stored: [FULL.id] })
    expect(screen.getByText('已在知识库')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入知识库' })).toBeNull()
  })

  it('adds the record and turns into the stored state', async () => {
    const b = mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加入知识库' })) })

    expect(b.add).toHaveBeenCalledWith(RECORD)
    expect(b.store.getSnapshot().stored).toEqual([FULL.id])
    expect(screen.getByText('已在知识库')).toBeTruthy()
  })

  it('says it is adding while the host is still out, and refuses a second click', async () => {
    const add = vi.fn(() => new Promise(() => {}))
    const b = mount({ add })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加入知识库' })) })

    const busy = screen.getByRole('button', { name: '加入中…' })
    expect(busy.hasAttribute('disabled')).toBe(true)
    fireEvent.click(busy)
    expect(b.add).toHaveBeenCalledTimes(1)
  })

  it('states the host code when the add is refused, and stays offerable', async () => {
    const b = mount({ add: vi.fn(async () => ({ ok: false as const, code: 'LIBRARY_FULL' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加入知识库' })) })

    expect(screen.getByRole('alert').textContent).toBe('加入失败（LIBRARY_FULL）。')
    expect(screen.getByRole('button', { name: '加入知识库' })).toBeTruthy()
    expect(b.store.getSnapshot().stored).toEqual([])
  })

  it('sees an id another surface stored, without being clicked at all', async () => {
    const b = mount()
    expect(screen.getByRole('button', { name: '加入知识库' })).toBeTruthy()

    // What the library view does after any write; the same handle, so the
    // card follows it.
    await act(async () => { b.store.actions.patched({ ...FULL, id: RECORD.id }) })
    expect(screen.getByText('已在知识库')).toBeTruthy()
  })
})

describe('the shared library store', () => {
  it('drops a removed entry from the page, the id set, and the related list', () => {
    const store = createLibraryStore().create()
    store.actions.succeed({
      entries: [FULL, BARE],
      total: 2,
      tags: [],
      counts: { all: 2, paper: 1, dataset: 1, note: 0, lowConfidence: 0 },
    })
    store.actions.open(FULL.id)
    store.actions.detailLoaded(FULL)
    store.actions.setRelated([BARE])
    expect(store.getSnapshot().stored).toEqual([FULL.id, BARE.id])

    store.actions.removed(BARE.id)
    expect(store.getSnapshot().stored).toEqual([FULL.id])
    expect(store.getSnapshot().page?.entries.map(row => row.id)).toEqual([FULL.id])
    expect(store.getSnapshot().related).toEqual([])
    // Another entry's removal does not close the open one.
    expect(store.getSnapshot().selected).toBe(FULL.id)

    store.actions.removed(FULL.id)
    expect(store.getSnapshot().selected).toBeNull()
    expect(store.getSnapshot().detail).toBeNull()
  })

  it('leaves an unread page alone when an entry is removed or patched', () => {
    const store = createLibraryStore().create()
    store.actions.removed(FULL.id)
    expect(store.getSnapshot().page).toBeNull()

    store.actions.patched(FULL)
    expect(store.getSnapshot().page).toBeNull()
    // A patch of an entry no page is showing still records that it is held.
    expect(store.getSnapshot().stored).toEqual([FULL.id])
    expect(store.getSnapshot().detail).toBeNull()
  })

  it('replaces only the patched row, and keeps the page totals', () => {
    const store = createLibraryStore().create()
    store.actions.succeed({
      entries: [FULL, BARE],
      total: 9,
      tags: [],
      counts: { all: 9, paper: 4, dataset: 5, note: 0, lowConfidence: 0 },
    })
    store.actions.open(FULL.id)
    store.actions.patched({ ...FULL, status: 'verified' })

    expect(store.getSnapshot().page?.total).toBe(9)
    expect(store.getSnapshot().page?.entries.map(row => row.status)).toEqual(['verified', 'unread'])
    expect(store.getSnapshot().detail?.status).toBe('verified')
  })

  it('records a failed detail read and clears it on the next open', () => {
    const store = createLibraryStore().create()
    store.actions.open(FULL.id)
    store.actions.detailFailed('LIBRARY_NOT_FOUND')
    expect(store.getSnapshot().detailError).toBe('LIBRARY_NOT_FOUND')

    store.actions.open(BARE.id)
    expect(store.getSnapshot().detailError).toBeNull()

    store.actions.close()
    expect(store.getSnapshot().selected).toBeNull()
  })

  it('drops the page when a read fails, so no stale list survives it', () => {
    const store = createLibraryStore().create()
    store.actions.succeed({
      entries: [FULL], total: 1, tags: [], counts: { all: 1, paper: 1, dataset: 0, note: 0, lowConfidence: 0 },
    })
    store.actions.begin()
    store.actions.fail('LIBRARY_REMOTE_FAILED')
    expect(store.getSnapshot().page).toBeNull()
    expect(store.getSnapshot().error).toBe('LIBRARY_REMOTE_FAILED')
    // The id set is knowledge about the library, not about the last read.
    expect(store.getSnapshot().stored).toEqual([FULL.id])
  })
})
