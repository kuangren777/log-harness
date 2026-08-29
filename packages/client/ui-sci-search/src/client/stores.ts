/**
 * Shared state of the search view: what was asked, where that search stands,
 * what came back, and the host's remembered queries.
 *
 * Nothing transient lives here. Which abstract is expanded and which card was
 * just copied are facts only one card knows, so they stay in that card's own
 * local state; this store carries what the whole view (and a remount of it)
 * has to agree on.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { LiteratureSearchResult, RecentQuery } from './contract.ts'

/** Lifecycle of the one search the view is showing. */
export type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

/** The view's shared state. */
export interface SearchState {
  /** The composer's current text, echoed back by a recent-query chip. */
  query: string
  /** Where the current search stands. */
  status: SearchStatus
  /** The settled result, or null before one lands. */
  result: LiteratureSearchResult | null
  /** The failure code of the settled search, or null. */
  error: string | null
  /** The host's remembered queries, newest first. */
  recent: RecentQuery[]
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type SearchActions = {
  setQuery: (draft: SearchState, text: string) => void
  begin: (draft: SearchState, query: string) => void
  succeed: (draft: SearchState, result: LiteratureSearchResult) => void
  fail: (draft: SearchState, code: string) => void
  setRecent: (draft: SearchState, entries: readonly RecentQuery[]) => void
}

/**
 * Declares the search view's shared state and its complete write surface.
 * @returns the store handle (one per plugin body — never a module singleton).
 */
export function createSearchStore(): EngineStoreHandle<SearchState, SearchActions> {
  return defineStore({
    init: (): SearchState => ({ query: '', status: 'idle', result: null, error: null, recent: [] }),
    actions: {
      setQuery: (d, text: string) => { d.query = text },
      begin: (d, query: string) => {
        d.query = query
        d.status = 'loading'
        d.error = null
      },
      succeed: (d, result: LiteratureSearchResult) => {
        d.status = 'done'
        d.result = result
        d.error = null
      },
      fail: (d, code: string) => {
        d.status = 'error'
        d.result = null
        d.error = code
      },
      setRecent: (d, entries: readonly RecentQuery[]) => { d.recent = [...entries] },
    },
  })
}

/** The search view's store handle type, for the components' `PropsStore` share. */
export type SearchStore = ReturnType<typeof createSearchStore>
