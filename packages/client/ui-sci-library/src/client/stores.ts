/**
 * Shared state of the library: what is being asked of it, the page that came
 * back, which entry is open, and which ids the library already holds.
 *
 * Nothing transient lives here. Whether one save is in flight, whether a copy
 * landed, and which file's preview is open are facts a single component
 * knows, so they stay in that component's own state; this store carries what
 * the view, its detail page, and the 「加入知识库」 action registered into ②
 * all have to agree on — including across a trip through another view, which
 * unmounts every component but not this handle.
 *
 * `stored` is why the action strip in ② can draw a truthful button: it is the
 * id set the host reported, not a guess, and every add, patch, and removal
 * writes through it.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { LibraryEntry, LibraryPage } from './contract.ts'

/** Which chip of the filter strip is pressed. */
export type LibraryFilter = 'all' | 'paper' | 'dataset' | 'note' | 'lowConfidence'

/** Lifecycle of the one library read the view is showing. */
export type LibraryListStatus = 'idle' | 'loading' | 'done' | 'error'

/** The library's shared state. */
export interface LibraryState {
  /** The search box's current text. */
  query: string
  /** The pressed filter chip. */
  filter: LibraryFilter
  /** The tag the cloud is filtering by, or null. */
  tag: string | null
  /** Where the current read stands. */
  status: LibraryListStatus
  /** The settled page, or null before one lands. */
  page: LibraryPage | null
  /** The failure code of the settled read, or null. */
  error: string | null
  /** The entry whose detail page is open, or null on the list. */
  selected: string | null
  /** The open entry as the host last reported it, or null while it loads. */
  detail: LibraryEntry | null
  /** The failure code of the detail read, or null. */
  detailError: string | null
  /** Entries the host scores as related to the open one. */
  related: LibraryEntry[]
  /** Ids the library holds, as the host reported them. */
  stored: string[]
}

/**
 * Replace one entry inside a settled page, leaving the page's totals alone:
 * an edit changes what a row says, never how many rows matched.
 * @param page - the settled page, or null when none has landed.
 * @param entry - the entry as the host now reports it.
 * @returns the page with that row replaced, or the page unchanged.
 */
function withEntry(page: LibraryPage | null, entry: LibraryEntry): LibraryPage | null {
  if (page === null) return null
  return { ...page, entries: page.entries.map(row => (row.id === entry.id ? entry : row)) }
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type LibraryActions = {
  setQuery: (draft: LibraryState, text: string) => void
  setFilter: (draft: LibraryState, filter: LibraryFilter) => void
  setTag: (draft: LibraryState, tag: string | null) => void
  begin: (draft: LibraryState) => void
  succeed: (draft: LibraryState, page: LibraryPage) => void
  fail: (draft: LibraryState, code: string) => void
  open: (draft: LibraryState, id: string) => void
  close: (draft: LibraryState) => void
  detailLoaded: (draft: LibraryState, entry: LibraryEntry) => void
  detailFailed: (draft: LibraryState, code: string) => void
  setRelated: (draft: LibraryState, entries: readonly LibraryEntry[]) => void
  patched: (draft: LibraryState, entry: LibraryEntry) => void
  setStored: (draft: LibraryState, ids: readonly string[]) => void
  removed: (draft: LibraryState, id: string) => void
}

/**
 * Declares the library's shared state and its complete write surface.
 * @returns the store handle (one per plugin body — never a module singleton).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({
      query: '',
      filter: 'all',
      tag: null,
      status: 'idle',
      page: null,
      error: null,
      selected: null,
      detail: null,
      detailError: null,
      related: [],
      stored: [],
    }),
    actions: {
      setQuery: (d, text: string) => { d.query = text },
      setFilter: (d, filter: LibraryFilter) => { d.filter = filter },
      setTag: (d, tag: string | null) => { d.tag = tag },
      begin: (d) => {
        d.status = 'loading'
        d.error = null
      },
      succeed: (d, page: LibraryPage) => {
        d.status = 'done'
        d.page = page
        d.error = null
        // Every row of a settled page is by definition in the library, so the
        // read that draws the list also keeps the id set the ② button reads.
        for (const row of page.entries) {
          if (!d.stored.includes(row.id)) d.stored.push(row.id)
        }
      },
      fail: (d, code: string) => {
        d.status = 'error'
        d.page = null
        d.error = code
      },
      open: (d, id: string) => {
        d.selected = id
        d.detail = null
        d.detailError = null
        d.related = []
      },
      close: (d) => {
        d.selected = null
        d.detail = null
        d.detailError = null
        d.related = []
      },
      detailLoaded: (d, entry: LibraryEntry) => {
        d.detail = entry
        d.detailError = null
      },
      detailFailed: (d, code: string) => {
        d.detail = null
        d.detailError = code
      },
      setRelated: (d, entries: readonly LibraryEntry[]) => { d.related = [...entries] },
      patched: (d, entry: LibraryEntry) => {
        d.detail = d.selected === entry.id ? entry : d.detail
        d.page = withEntry(d.page, entry)
        if (!d.stored.includes(entry.id)) d.stored.push(entry.id)
      },
      setStored: (d, ids: readonly string[]) => { d.stored = [...ids] },
      removed: (d, id: string) => {
        d.stored = d.stored.filter(known => known !== id)
        d.page = d.page === null
          ? null
          : { ...d.page, entries: d.page.entries.filter(row => row.id !== id) }
        d.selected = d.selected === id ? null : d.selected
        d.detail = d.detail?.id === id ? null : d.detail
        d.related = d.related.filter(row => row.id !== id)
      },
    },
  })
}

/** The library's store handle type, for the components' `PropsStore` share. */
export type LibraryStore = ReturnType<typeof createLibraryStore>
