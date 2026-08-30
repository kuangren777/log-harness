/**
 * Pure column solver for the three-column AppFrame.
 * The details column has exactly two states: closed (zero width) or open at
 * DETAILS_RATIO of the frame — no drag range and no wide mode, by product
 * decision. It auto-closes (derived zero width — the open preference is never
 * rewritten, so widening the window restores it) only when the fixed share
 * would squeeze the center below DETAILS_CENTER_FLOOR. The sidebar never
 * concedes: its rendered width is always the drag preference (or the
 * collapsed rail), and center absorbs any remaining deficit. Inputs are the
 * layout store's plain width preferences (0 = closed); a closed sidebar
 * resolves to the fixed SIDEBAR_COLLAPSED control rail. The
 * SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; details: number }

// Contract-frozen geometry: the three-column frame's fixed points.
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/**
 * Open-details sentinel the store writes; the solver renders any non-zero
 * details preference at DETAILS_RATIO, so the value itself never reaches the
 * screen. Kept as a width-typed number so the store stays plain px
 * preferences with 0 = closed.
 */
export const DETAILS_DEFAULT = 360
/** The open details column's fixed share of the frame's inner width. */
export const DETAILS_RATIO = 0.5
/** Center width below which the fixed-share details column auto-closes. */
export const DETAILS_CENTER_FLOOR = 320

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  // Open details take their fixed share of the frame — the preference value
  // only says open or closed, never a width.
  const d0 = details === 0 ? 0 : Math.round(viewport * DETAILS_RATIO)

  // The fixed share auto-closes (derived — the preference is untouched) when
  // it would squeeze the center below its floor; center then absorbs any
  // remaining deficit (may drop below CENTER_MIN on a tiny frame).
  const d = d0 !== 0 && viewport - s - d0 < DETAILS_CENTER_FLOOR ? 0 : d0
  return { sidebar: s, center: Math.max(0, viewport - s - d), details: d }
}
