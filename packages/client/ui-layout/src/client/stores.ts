/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 * `view` names the frame's top-level view (CONVERSATION_VIEW = the three
 * columns; any other id routes the center track to a `view` slot entry). The
 * details column is open/closed only — its rendered width is the solver's
 * fixed share, so no drag action exists for it.
 */
type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  view: string
}

/**
 * The frame's default top-level view id: the three-column conversation
 * layout. Every other id routes the center track to a `view` slot entry, so
 * consumers compare against this constant instead of a bare string literal.
 */
export const CONVERSATION_VIEW = 'conversation'

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  showView: (draft: LayoutState, id: string) => void
}

/**
 * Create the layout panel store handle. For the sidebar the preference IS
 * the width, so closing forgets its drag width — reopening restores the
 * contract default; for details the preference only says open (the sentinel
 * default) or closed (0) and the solver owns the rendered width. Actions are
 * the complete write set: the sidebar drag write clamps into its contract
 * range and never crosses the open/closed line; open/close transitions write
 * 0 / the default explicitly. Below the auto-collapse breakpoint (AppFrame
 * feeds setNarrow) the sidebar toggle flips the narrowExpanded override
 * instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false,
      view: CONVERSATION_VIEW,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      showView: (d, id: string) => { d.view = id },
    },
  })
  return handle
}
