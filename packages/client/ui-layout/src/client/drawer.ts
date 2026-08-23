/**
 * Pure keyboard-containment helpers for the phone drawer. The drawer is modal
 * while open — the conversation behind it is covered by a backdrop — so Tab
 * must cycle inside it rather than walking into content the user cannot see.
 * DOM reads only: no React, no component state, so the rules are testable
 * against a plain element tree.
 */

/**
 * Elements the trap treats as tab stops. Disabled controls and
 * `tabindex="-1"` are excluded because the browser skips them too; nothing
 * here filters by visibility, so callers pass a revealed subtree.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * The tab stops inside a subtree, in document order.
 * @param root - the subtree to scan.
 * @returns every focusable descendant, first to last.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
}

/**
 * Where focus must be forced so a Tab keystroke stays inside `root`.
 * @param root - the trapping subtree.
 * @param active - the currently focused element.
 * @param backwards - true for Shift+Tab.
 * @returns the element to focus instead, or undefined when the browser's own move already stays inside.
 */
export function trapTarget(
  root: HTMLElement,
  active: Element | null,
  backwards: boolean,
): HTMLElement | undefined {
  const stops = focusableWithin(root)
  const last = stops.length - 1
  if (last < 0) return undefined
  // Entering from outside lands on the edge the keystroke moves towards; the
  // opposite edge is the one a further keystroke would fall off.
  const entry = backwards ? stops[last] : stops[0]
  if (!root.contains(active)) return entry
  const edge = backwards ? stops[0] : stops[last]
  return active === edge ? entry : undefined
}
