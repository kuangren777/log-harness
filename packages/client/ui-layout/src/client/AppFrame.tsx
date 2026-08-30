/**
 * Shell frame, registered into the built-in 'root' slot (the web shell renders
 * only 'root'). Owns the grid tracks (rail | sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 *
 * The component root is a flex row: the rail column, then the grid frame. The
 * rail sits BESIDE the grid rather than inside it, so the frame keeps exactly
 * three tracks (external readers index them positionally) and the box the
 * frame's own ResizeObserver reports already excludes the rail — no width
 * measurement or subtraction anywhere. An unoccupied rail is a zero-width flex
 * item and changes nothing.
 *
 * Two frame-wide modes sit above the three columns. A view other than
 * CONVERSATION_VIEW hands the center to the keyed `view` entry of that id and
 * collapses the other two tracks, parking (not unmounting) the three column
 * occupants behind it; the wide details mode keeps the conversation columns
 * but overrides the details width and drops the sidebar. Both modes render
 * their widths from mode state rather than from a drag, so neither shows a
 * resize handle.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import { CONVERSATION_VIEW, type createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'rail' | 'view'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

// A column parked behind a keyed view stays MOUNTED and keeps rendering its
// occupant — that is what carries composer drafts, scroll positions and other
// DOM-held state across a view round trip — while going invisible (the
// data attribute drives the CSS), leaving the accessibility tree and refusing
// focus. `inert` is the empty-string form: React 18's JSX attribute table
// predates it (React 19 adds it), but the renderer forwards an unknown
// attribute verbatim when its value is a string, so the DOM gets `inert=""`.
// The one cast that needs stays on this constant.
const PARKED = { 'aria-hidden': true, inert: '', 'data-view-hidden': true } as React.HTMLAttributes<HTMLDivElement>
const ACTIVE: React.HTMLAttributes<HTMLDivElement> = {}

/**
 * Park attributes for one conversation column.
 * @param hidden - true while a keyed view owns the frame.
 * @returns the attribute bag to spread on the column element.
 */
function parked(hidden: boolean): React.HTMLAttributes<HTMLDivElement> {
  return hidden ? PARKED : ACTIVE
}

/** Center column grid item (session-body building block). */
function CenterColumn(props: { hidden: boolean; children?: ReactNode }) {
  return <div className={css.centerCol} {...parked(props.hidden)}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { hidden: boolean; children?: ReactNode }) {
  return <div className={css.detailsCol} {...parked(props.hidden)}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
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

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
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
  // The rail is a sibling, so this box is already net of it — every column
  // figure below is expressed against it with no rail arithmetic.
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
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])

  // A non-conversation view empties both side tracks and takes the center for
  // its keyed entry. The details track is the solver's fixed share — there is
  // no drag and no wide mode for it.
  const isConversation = panels.view === CONVERSATION_VIEW
  const detailsPx = cols.details
  // Always exactly three tracks: e2e goldens and the web smoke read them by
  // position, so a mode may zero a track but never add or drop one.
  const template = isConversation
    ? `${cols.sidebar}px minmax(0, 1fr) ${detailsPx}px`
    : '0px minmax(0, 1fr) 0px'

  return (
    <div className={css.shell}>
      {/* The rail lives BESIDE the grid, not in it: the frame keeps its three
          tracks for positional readers, and the frame's measured box is
          already net of the rail. Frame-wide and view-independent — it owns
          view switching, so it renders across every view. */}
      <div className={css.railCol}>
        {renderSlot('rail', { view: panels.view, showView: actions.showView })}
      </div>
      <div
        ref={frameRef}
        className={css.frame}
        style={{ gridTemplateColumns: template }}
        data-view={panels.view}
        data-sidebar-collapsed={sidebarCollapsed || undefined}
        data-details-collapsed={!isConversation || detailsPx === 0 || undefined}
        data-dragging={dragging || undefined}
      >
        <div className={css.sidebarCol} {...parked(!isConversation)}>
          {/* Render-site slot call with live concession output: a closed
              sidebar keeps the mounted slot at the compact-rail width, and the
              component sees its rendered state as owner params decided here
              (collapsed follows the resolved rail, so a derived auto-collapse
              renders the rail UI too). Keyed views park this column rather than
              unmounting it, and the ordinary solve keeps feeding it so its
              occupant sees no prop churn on the way in or out. */}
          {renderSlot('sidebar', {
            collapsed: sidebarCollapsed,
            width: cols.sidebar,
          })}
        </div>
        {/* All three column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than the
            shell's own pending rendering. The conversation is session-maybe;
            the strict details entry naturally renders empty while no session
            is current. A keyed view hides them in place instead of unmounting,
            so the DOM order below never changes and React keeps their
            identity. */}
        <CenterColumn hidden={!isConversation}>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn hidden={!isConversation}>{renderSlot('details', {})}</DetailsColumn>
        {/* The keyed view is an extra cell spanning all three tracks, stacked
            over the parked columns. */}
        {!isConversation && (
          <div className={css.viewCol}>
            {renderSlot('view', {}, { entryKey: panels.view })}
          </div>
        )}
        <div className={css.overlayLayer} data-shell-overlay>
          {renderSlot('shell.overlay', {})}
        </div>
        {/* Handles exist only where a drag can move something: the collapsed
            sidebar is fixed-width, and a keyed view and the wide details mode
            both decide their tracks themselves. Offsets are frame-relative,
            and the frame starts after the rail. */}
        {isConversation && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      </div>
    </div>
  )
}
