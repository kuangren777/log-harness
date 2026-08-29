# Agent Note: A rail column and keyed top-level views in the layout frame

Status: proposed

English | [中文](2026-08-29-layout-view-rail.zh.md)

## Problem

The web shell had exactly one screen. `ui-layout` owns the built-in `root` slot and declares four children — `sidebar`, `conversation`, `details` (all `single`) and `shell.overlay` (`list`) — so the frame is always the three-column conversation and nothing a downstream plugin registers can add a fifth top-level region. Settings is a modal over that frame, skills live inside the composer, and the client has no router: there was no primitive for "show a different screen".

The `sci` profile needs several full-width screens beside the conversation (a literature library, a citation pool, an agent roster, a search page) and an icon rail that switches between them. It also needs a wide details column for previewing a produced document. Forking `ui-layout` would duplicate the concession solver and the drag handles and diverge from every later fix; an overlay-based screen would leave the conversation interactive underneath.

## Proposal

`ui-layout` gains two generic root children and two store fields, and nothing sci-specific.

- `'rail'` (`single`, `root`) is a leftmost column outside the sidebar. Its occupant receives `{ view, showView }`. The frame measures the rendered rail with the ResizeObserver it already runs and subtracts that width from the viewport for the column solve, the drag-handle offsets and the auto-collapse breakpoint, so an unoccupied rail costs zero pixels and changes nothing for the existing bundles.
- `'view'` (`keyed`, `root`) holds full-bleed screens keyed by view id. The store's `view` (default `'conversation'`) selects one; `ILayout.showView(id)` writes it. While a keyed view shows, the three columns are parked rather than unmounted: their tracks collapse to zero, the column elements carry `visibility:hidden`, `aria-hidden` and `inert`, and the view renders in an extra grid cell spanning the parked tracks. Parking keeps the conversation occupants' element identity, so a composer draft and a scroll position survive a round trip through another screen.
- `detailsWide` with `ILayout.toggleDetailsWide()` gives the details column `DETAILS_WIDE_RATIO` of the inner width (never less than `DETAILS_MAX`), zeroes the sidebar track and withdraws both drag handles while active; `closeDetails` resets it.

The frame root carries `data-view` and `data-details-wide` so stylesheets can key on the state without a hook.

## Alternatives considered

**Fork `ui-layout` into a sci-owned frame.** Full control, but a second copy of the concession chain, the drag handles and the theme presenter, drifting from every upstream fix. Rejected: the needed change is two slots and two store fields.

**Render screens through `shell.overlay`.** Zero core change, but the conversation and details columns stay live underneath — focus, scrolling and shortcuts would need per-screen suppression, and every later screen would inherit the workaround. Rejected.

**Unmount the three columns while a keyed view shows.** Simpler frame code, and the first cut did this. It loses composer drafts and scroll positions on every screen switch, which the profile's multi-screen workflow would hit constantly. Replaced by parking.

**Let the rail occupant declare a fixed width.** Would avoid a measurement, but couples the frame to one occupant's CSS. Measuring keeps the rail free to size itself.

## Acceptance criteria

- With no `rail` occupant the frame's column math, handle offsets and breakpoint are unchanged (existing `app-frame` tests still pass unmodified in intent).
- With a 66px rail occupant, `computeColumns` receives `viewport − 66` and both handles shift by 66.
- `showView('x')` renders the `view` entry keyed `x`, keeps all three column `renderSlot` calls, marks the columns `data-view-hidden` / `aria-hidden` / `inert`, and renders no drag handle; `showView('conversation')` returns the same column elements.
- `toggleDetailsWide()` opens a closed column, sets the details track to `max(round(inner × DETAILS_WIDE_RATIO), DETAILS_MAX)`, zeroes the sidebar track; `closeDetails()` clears the flag.
- Every file in `packages/client/ui-layout/src` stays at 100% coverage; `pnpm run test:gui` and `tsc -b tsconfig.client.json` pass.

## Risks

- Parked columns still render, so a heavy conversation keeps paying React render cost behind another screen. Acceptable for the profile's screen sizes; a future `display:none` after a delay would trade that cost for a re-layout on return.
- The rail width participates in the auto-collapse breakpoint, so a rail shifts the narrow threshold by its width. This is the intended semantics — the rail really consumes width — but it is a visible change for any bundle that mounts one.
- `inert` is set through an empty-string attribute because React 18's typings lack it; React 19 accepts the boolean prop, and the cast is confined to one constant.
