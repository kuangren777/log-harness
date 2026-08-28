/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 * Showing one details mode is the same kind of gesture but its state belongs
 * to the column's occupant, so that plugin registers a selector here and every
 * other plugin reaches the column through showDetailsMode without importing
 * it.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * Writes one details-column mode id into the state of the plugin that owns
 * the column. Supplied by that plugin through
 * {@link ILayout.registerDetailsModeSelector}; this package never knows which
 * ids exist.
 */
export type DetailsModeSelector = (id: string) => void

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /**
   * Open the details column and select mode `id`; an id naming no live
   * `conversation.details.mode` entry leaves the panel on `tool`. The column
   * opens either way — with no registered selector this is exactly
   * {@link ILayout.openDetails}.
   * @param id - the `conversation.details.mode` entry id to show.
   */
  showDetailsMode(id: string): void
  /**
   * Adopt the mode selector of the plugin occupying the `details` slot, so
   * any plugin can reach its column through {@link ILayout.showDetailsMode}.
   * The latest registration replaces the previous one (one details column,
   * one owner); a disposer that is no longer the current registration removes
   * nothing, so an HMR swap that registers before the old fiber unloads keeps
   * the fresh selector.
   * @param select - writes one mode id into the column owner's own state.
   * @returns disposer removing this selector.
   */
  registerDetailsModeSelector(select: DetailsModeSelector): () => void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #selectDetailsMode: DetailsModeSelector | undefined

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * Adopt the details column's mode selector (see the {@link ILayout} contract
   * for replacement and disposer semantics).
   * @param select - writes one mode id into the column owner's own state.
   * @returns disposer removing this selector.
   */
  registerDetailsModeSelector(select: DetailsModeSelector): () => void {
    this.#selectDetailsMode = select
    return () => {
      if (this.#selectDetailsMode === select) this.#selectDetailsMode = undefined
    }
  }

  /**
   * Select the mode, then open the column (see the {@link ILayout} contract).
   * @param id - the `conversation.details.mode` entry id to show.
   */
  showDetailsMode(id: string): void {
    // Selection first: the column owner reads its own state on the render the
    // open triggers, so the panel never paints the previous mode in between.
    this.#selectDetailsMode?.(id)
    this.openDetails()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
