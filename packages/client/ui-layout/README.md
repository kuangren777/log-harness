# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, and `conversation.empty`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 56px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

At or below 640px (`PHONE_MAX_WIDTH`) the frame leaves the three-column form for its phone layout: one full-width conversation column under a bar carrying the drawer toggle, the details column out of the flow, and the sidebar slot rendered wide inside an off-canvas drawer instead of the 56px rail. The drawer is modal — Escape, a backdrop tap and the toggle all close it, Tab cycles inside it, and closing returns focus to whatever opened it. Its open state is the layout store's existing narrow-viewport override, so the header toggle, the sidebar's own control and `ctx.layout.toggleSidebar()` remain one switch. The drawer slides with `left` rather than a transform, because a transformed ancestor becomes the containing block for `position: fixed` descendants and the settings panel renders inside this column. The frame also applies `env(safe-area-inset-*)` for the whole shell: its occupants do not touch the display edges. Above the breakpoint nothing changes, including the 1024px rail auto-collapse.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the four owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
- **The phone breakpoint is a fixed 640px** — it is a contract constant, not configuration, and CSS modules outside this package that need the same threshold restate the literal (a custom property cannot be read in a media query).
