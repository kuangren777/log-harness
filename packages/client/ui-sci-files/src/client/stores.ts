/**
 * Per-session viewing state of the files mode. The details column mounts the
 * active mode alone, so this store is what survives a tab trip: the file the
 * user picked and the directories they opened. File bytes, listings, and
 * office state are not here — they are fetched per selection and belong to
 * the component that shows them.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** A file the user picked, recorded against what the session had just produced. */
export interface PinnedFile {
  /** The picked file. */
  readonly path: string
  /**
   * The newest produced file at the moment of the pick, or null when the
   * session had produced none. The pick outranks that state of the world and
   * nothing else: once the session produces something newer, the mode follows
   * it again, which is what makes a second delivery locate itself without
   * making the first pick feel ignored.
   */
  readonly over: string | null
}

/** The mode's shared viewing state. */
export interface SciFilesState {
  /** The user's pick, or null while the mode follows what the session produces. */
  pinned: PinnedFile | null
  /** Directories the user opened, absolute paths. */
  expanded: string[]
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type SciFilesActions = {
  pin: (draft: SciFilesState, path: string, over: string | null) => void
  toggleExpanded: (draft: SciFilesState, path: string) => void
}

/**
 * Declares the per-session files-mode state and its complete write surface.
 * @returns the store handle.
 */
export function createSciFilesStore(): EngineStoreHandle<SciFilesState, SciFilesActions> {
  return defineStore({
    init: (): SciFilesState => ({ pinned: null, expanded: [] }),
    actions: {
      pin: (d, path: string, over: string | null) => { d.pinned = { path, over } },
      toggleExpanded: (d, path: string) => {
        const at = d.expanded.indexOf(path)
        if (at === -1) d.expanded.push(path)
        else d.expanded.splice(at, 1)
      },
    },
  })
}

/** The mode's store handle type. */
export type SciFilesStore = ReturnType<typeof createSciFilesStore>

/** One live instance of that store, as the mode's injected face carries it. */
export type SciFilesStoreInstance = ReturnType<SciFilesStore['create']>

/**
 * The file the mode shows: the user's pick while it still outranks what the
 * session has produced, otherwise the newest produced file.
 * @param pinned - the user's recorded pick, or null.
 * @param produced - the newest file the session produced, or undefined.
 * @returns the path to show, or undefined when there is nothing to show.
 */
export function shownPath(pinned: PinnedFile | null, produced: string | undefined): string | undefined {
  if (pinned === null) return produced
  return pinned.over === (produced ?? null) ? pinned.path : produced
}
