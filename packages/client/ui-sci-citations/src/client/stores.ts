/**
 * Shared state of the citation-pool view: which project is open, which group
 * the left column selects, the pool the host last reported, and whether a
 * write is in flight.
 *
 * Nothing transient lives here. Which row's group menu is open, whether a
 * delete is waiting for its confirmation, and the copy notice are facts only
 * one component knows, so they stay in that component's own state; this store
 * carries what the whole view (and a remount of it) has to agree on.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { CitationPool, CitationProject } from './contract.ts'
import { ALL_GROUP } from './pool-view.ts'

/** Lifecycle of the pool read the view is showing. */
export type PoolStatus = 'idle' | 'loading' | 'ready'

/** The view's shared state. */
export interface CitationsState {
  /** Paper projects the host offers, in its own order. */
  projects: CitationProject[]
  /** Slug of the open project, or an empty string before one is chosen. */
  project: string
  /** Left-column selection: `all`, `quarantine`, or a group key. */
  group: string
  /** The pool the host last reported, or null before one lands. */
  pool: CitationPool | null
  /** Where the current pool read stands. */
  status: PoolStatus
  /** Failure code of the last read or write, or null. */
  error: string | null
  /** Whether a rescan or a write is in flight. */
  busy: boolean
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type CitationsActions = {
  setProjects: (draft: CitationsState, rows: readonly CitationProject[]) => void
  chooseProject: (draft: CitationsState, slug: string) => void
  chooseGroup: (draft: CitationsState, key: string) => void
  beginLoad: (draft: CitationsState) => void
  loaded: (draft: CitationsState, pool: CitationPool) => void
  failed: (draft: CitationsState, code: string) => void
  setBusy: (draft: CitationsState, busy: boolean) => void
}

/**
 * Declares the pool view's shared state and its complete write surface.
 * @returns the store handle (one per plugin body — never a module singleton).
 */
export function createCitationsStore(): EngineStoreHandle<CitationsState, CitationsActions> {
  return defineStore({
    init: (): CitationsState => ({
      projects: [], project: '', group: ALL_GROUP, pool: null, status: 'idle', error: null, busy: false,
    }),
    actions: {
      // The first project opens itself: a selector with nothing selected would
      // make the whole view an empty state the user has to dismiss by hand.
      setProjects: (d, rows: readonly CitationProject[]) => {
        d.projects = [...rows]
        const first = rows[0]
        if (d.project === '' && first !== undefined) d.project = first.slug
      },
      chooseProject: (d, slug: string) => {
        d.project = slug
        d.group = ALL_GROUP
        d.pool = null
        d.error = null
      },
      chooseGroup: (d, key: string) => { d.group = key },
      beginLoad: (d) => {
        d.status = 'loading'
        d.error = null
      },
      loaded: (d, pool: CitationPool) => {
        d.pool = pool
        d.status = 'ready'
        d.error = null
      },
      // The pool the view already drew stays on screen: a failed move must
      // not blank the list it failed to change.
      failed: (d, code: string) => {
        d.status = 'ready'
        d.error = code
      },
      setBusy: (d, busy: boolean) => { d.busy = busy },
    },
  })
}

/** The pool view's store handle type, for the components' `PropsStore` share. */
export type CitationsStore = ReturnType<typeof createCitationsStore>
