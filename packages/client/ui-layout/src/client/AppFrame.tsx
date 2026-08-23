/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 *
 * At or below PHONE_MAX_WIDTH the frame leaves that form for its phone
 * layout: one full-width conversation column under a bar carrying the drawer
 * toggle, the sidebar slot rendered wide inside an off-canvas drawer, and the
 * details column out of the flow. The drawer is modal — Escape, the backdrop
 * and the toggle all close it, Tab cycles inside it (drawer.ts), and closing
 * it returns focus where it was when it opened.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  computeColumns, drawerWidth, PHONE_MAX_WIDTH, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import { focusableWithin, trapTarget } from './drawer.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share + the frame's own copy. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/**
 * Keyboard containment for the open phone drawer: Escape closes it, Tab
 * cycles inside it, entering it lands on its first control, and leaving it
 * restores the focus the opening gesture took — the toggle, in every path a
 * user can reach it by.
 * @param open - whether the drawer is currently revealed.
 * @param panel - the drawer element.
 * @param onClose - close request raised by Escape.
 */
function useDrawerContainment(
  open: boolean,
  panel: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const root = panel.current
    /* v8 ignore next -- the drawer element renders unconditionally in phone mode, so the ref is attached by effect time. */
    if (root === null) return
    const restore = document.activeElement
    focusableWithin(root)[0]?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab') return
      const target = trapTarget(root, document.activeElement, event.shiftKey)
      if (target === undefined) return
      event.preventDefault()
      target.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // Only take focus back if the drawer still holds it: a close that
      // followed the user clicking into the conversation must not yank it.
      if (root.contains(document.activeElement) && restore instanceof HTMLElement) restore.focus()
    }
  }, [onClose, open, panel])
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  // The phone form reuses the narrow override as its drawer state: below the
  // auto-collapse breakpoint toggleSidebar already flips exactly that flag,
  // so the drawer, the sidebar's own toggle and ctx.layout stay one control.
  const phone = viewport <= PHONE_MAX_WIDTH
  const drawerOpen = phone && panels.narrowExpanded
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  const toggleSidebar = useCallback(() => { actions.toggleSidebar() }, [actions])
  const drawer = useRef<HTMLDivElement | null>(null)
  useDrawerContainment(drawerOpen, drawer, toggleSidebar)

  // Phone: one full-width column under the toggle bar, the drawer taken out
  // of the grid by CSS. Desktop: the solved three tracks.
  const phoneWidth = drawerWidth(viewport)

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: phone
          ? 'minmax(0, 1fr)'
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
      data-phone={phone || undefined}
      data-drawer-open={drawerOpen || undefined}
    >
      {phone && (
        <header className={css.phoneBar}>
          <button
            type="button"
            className={css.phoneToggle}
            aria-label={drawerOpen ? t('drawer.close') : t('drawer.open')}
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            onClick={toggleSidebar}
          >
            <IconPanelLeftOutline16 size={20} />
          </button>
        </header>
      )}
      <div
        ref={drawer}
        className={css.sidebarCol}
        // Phone: the drawer's own box, parked one width to the left while
        // closed (AppFrame.module.css explains why this is `left`, not a
        // transform).
        style={phone ? { width: phoneWidth, left: drawerOpen ? 0 : -phoneWidth } : undefined}
        role={phone ? 'dialog' : undefined}
        aria-modal={phone ? true : undefined}
        aria-label={phone ? t('drawer.label') : undefined}
      >
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). The drawer has no rail state — a phone
            never shows the 56px column — so it always renders wide. */}
        {renderSlot('sidebar', {
          collapsed: phone ? false : sidebarCollapsed,
          width: phone ? phoneWidth : cols.sidebar,
        })}
      </div>
      {drawerOpen && (
        // Pointer-only affordance, and deliberately not a control: Escape and
        // the toggle are the keyboard paths, so exposing a third one would
        // only add an unnamed tab stop in front of the drawer's own content.
        <div className={css.drawerBackdrop} aria-hidden="true" data-drawer-backdrop onClick={toggleSidebar} />
      )}
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed, and
          the phone form has no resizable track at all. */}
      {!phone && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!phone && cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
