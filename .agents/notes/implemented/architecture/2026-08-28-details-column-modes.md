# Agent Note: The details column as a mode ring

Status: implemented

English | [中文](2026-08-28-details-column-modes.zh.md)

## Problem

The right-hand details column was one component's private body. `ui-conversation`'s `DetailsPanel` occupied the layout's single `details` slot and rendered exactly one thing: the tool-call inspector, with `conversation.details.tool` as the only hole in it. A plugin that wants to show something else in that column — a workspace file browser, a preview surface — had two options, both wrong. It could take the `details` seat itself, which is a `single` slot, so the tool inspector disappears along with the `conversation.details.tool` declaration every tool renderer registers into. Or it could register a tool renderer and pretend its content is a tool result, which lies about what the panel is showing and only appears when the user has selected a call. The column had room for exactly one domain, and that domain was decided by whichever package shipped the panel.

## Decision

The details column is a mode ring, the same shape the conversation view ring already uses for tabs. The `details` registration declares one child slot and hosts whichever mode is active:

```ts
type DetailsModeOwnerProps = { sessionId: string; cwd?: string; active: boolean }
interface SlotMap {
  'conversation.details.mode': { kind: 'list'; scope: 'session'; owner: DetailsModeOwnerProps }
}
```

The list entry's registration options carry the mode: `id` is the mode id the store holds, `label` its tab text (a thunk over the registrant's own `t`, so the tab follows the active locale without re-registration), and `order` its position. The owner share is `{ sessionId, cwd?, active }` — session identity and the workspace root a mode needs to resolve and shorten displayed paths, plus whether the panel is showing this mode.

The tool inspector this package always shipped is no longer the panel: it is `DetailsToolMode`, the ring's `tool` entry at `order: 0`, and it is the entry that declares and renders `conversation.details.tool`. `DetailsPanel` keeps only the chrome — the header title, the close button, and the tab strip — and dispatches the active entry through `only: <active id>`. Everything in the column is a contribution, including the shipped one; nothing about a mode's registration marks it as the built-in.

Three rules keep the seam predictable. The tab strip renders only from the second registered mode on, so a deployment that composes no extra mode has the DOM it had before. The active mode lives in the shared chat store as `detailsMode`, beside the selection the inspector already reads, so the panel stays a pure reader and mode choice survives view switches like every other per-session preference. An id that names no live entry — a plugin composed out, unmounted, or a snapshot persisted before the field existed — resolves to `tool`, which is why the fallback mode is the one this package guarantees.

Two gestures write the mode. `openDetails(target)`, the chat view's existing tool-row click, sets `tool` along with the selection: the gesture asks for one call's output, so a mode another gesture left behind must not swallow it. `showDetailsMode(id)` is the inverse, selecting a mode and opening the column together, for a contributor that wants to reveal its own surface.

The panel reads the ring through an injected projection (`DetailsInjected.modes`, a `list`/`subscribe`/`version` triple over the slot ledger) rather than importing the registry, exactly as the session header reads the view ring. Both projections are one closure in `apply.ts`.

## Alternatives considered

- **Keep the tool inspector inside `DetailsPanel` and let the ring hold only contributed modes.** This is the smaller diff: no component split, no moved `conversation.details.tool` declaration, and the six direct-render suites in `ui-tool` keep mounting `DetailsPanel`. Rejected because it makes the shipped mode privileged — it cannot be ordered against contributed modes, cannot be shadowed by priority, and does not appear in `slots.entries`, so the panel would need two enumeration paths and the live-slot inspector would under-report the column. "Everything is a plugin" is cheap here and the asymmetry is not.
- **Give the column a `keyed` slot dispatched by mode id instead of a `list`.** Rejected: keyed dispatch needs the owner to know the key domain, and the whole point is that the panel does not know which modes exist. A list carries `order` and `label` for free — the tab strip is a projection of the ledger, not a table the panel maintains.
- **Let a mode take the `details` seat at a lower priority and shadow the panel.** Slot shadowing already supports this. Rejected because it is replacement, not addition: the shadowing entry owns the header, the close button, and the tool inspector's fate, and two plugins wanting a column each would fight over one cell instead of appearing as two tabs.
- **Keep every visited mode mounted and hidden, switching visibility with the `active` flag.** This preserves a file browser's tree and scroll position across tab trips, which is the reason `active` exists on the owner share. Rejected for now: the column opens on a gesture, and a mode that mounts while another one shows pays for a listing the user never asked for. `active` stays in the contract so the panel can adopt keep-alive later without changing what a mode component must handle — an entry that already branches on it keeps working either way.
- **Put the active mode in component state instead of the chat store.** Rejected: the store is the cross-registration share this column already uses for the selection, it is per-session and persisted, and a writer outside the panel (`showDetailsMode`, `openDetails`) needs somewhere to write that the panel reads.

## Consequences

A deployment with no contributed mode renders the column exactly as before: no tab strip, the call name as the header title, the same body. `tests/details-panel.client.spec.tsx` pins that, plus the behavior a second mode unlocks — the tab strip, a click writing `detailsMode` and swapping the body, the header title becoming that mode's label, `openDetails(target)` returning to `tool`, and an unregistered active id falling back to `tool`. `tests/apply-inject.client.spec.tsx` pins the two inject faces: `showDetailsMode(id)` sets the mode and calls `layout.openDetails()`, and the `modes` projection tracks ledger registrations. Tabs are `role="tablist"` / `role="tab"` with `aria-selected`, matching the session header's view ring.

The ring has a single entry until `ui-sci-files` registers the second, so the strip never renders in the shipped bundle yet and the seam is exercised by tests alone. That plugin reaches the column by registering one entry, with no change to `ui-conversation` — which is the whole point of the change and the first real proof of it.

`active` is a constant today. Every mounted mode reads `true`, because the panel mounts the active entry alone. A contributor that ignores the flag will silently need work if the panel later keeps modes mounted; the contract documents the flag as the panel's announcement, not a value to assume.

Moving the `conversation.details.tool` declaration onto the tool mode narrows its lifetime. The slot collapses when the `tool` entry is disposed rather than when the whole `details` entry is. Every current registrant (`ui-tool`) reaches it through `ctx.slots.inject`, which waits for the declaration, so the change is invisible — but a registrant that ever registers eagerly would depend on an entry, not a panel.

The mode id is a bare string across a plugin boundary. It is a display-layer cell key, not a cross-process identity, so it is not branded; the cost is that a typo in `showDetailsMode` silently falls back to `tool` instead of failing loud. The alternative — a registry of known ids — would put the panel back in the business of knowing which modes exist.

The change reaches outside its package. `ui-tool`'s six details suites mounted `DetailsPanel` to exercise their cards and now mount `DetailsToolMode` (commit `84c4ea6590`, tests only), and any future change to `DetailsInjected` has the same reach. The ring itself shipped in `46034e3865`.

The gesture has since moved onto the layout service, superseding the `layout.openDetails()` call named above: `ILayout.showDetailsMode(id)` selects the mode and opens the column in one call, `ui-conversation`'s apply registers the column's mode writer through `registerDetailsModeSelector` at mount, and `ChatViewInjected.showDetailsMode` delegates there, so a plugin owning a mode switches the column to itself through `ctx.layout` alone — without importing this package, and while its own entry is still unmounted behind another tab. The reach outside the package grew by one step with it: a hand-built `ctx.layout` fake that mounts `ui-conversation`'s apply must now carry `registerDetailsModeSelector`, which the three `ui-tool` suites doing so were updated for.
