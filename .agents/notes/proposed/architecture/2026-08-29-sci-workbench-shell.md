# Agent Note: The sci workbench shell — rail, tool-card frame, artifact chips, file panel chrome

Status: proposed

English | [中文](2026-08-29-sci-workbench-shell.zh.md)

## Problem

The `sci` profile shipped with the stock harness shell: a sidebar, the conversation, and a details column whose 文件 mode came from `ui-sci-files`. The product design (Claude Design project `225a21da…`, "CaMeL Science 工作台") asks for a different frame — an icon rail that will switch between the conversation and several full-width screens, a conversation whose tool calls read as cards with a live status and an agent galaxy for fan-outs, a chips row of what each turn produced, and a right panel with document chrome (badge, 预览/源码, wide mode, download). Every number and button in that design must be backed by real session data; nothing may be drawn from a placeholder.

Three constraints shaped where the code could go. The client has no router and `ui-layout` owns every top-level region ([layout rail/view note](2026-08-29-layout-view-rail.md)). A keyed slot cell can be shadowed by a lower-priority entry but the shadowing entry cannot re-declare the shadowed entry's child slots (`SlotCore.register` rejects a second declaration), so replacing `ui-tool`'s tool-call renderer would have silently dropped every per-tool view. And `conversation.chat.turnTail` is a chain — one winner per turn — so a chips row and a galaxy board could not both hang there.

## Proposal

Three sci-owned browser plugins plus one generic seat in `ui-tool`; the host is untouched.

- **`ui-sci-shell`** occupies `rail` and declares `rail.item` / `rail.footer` so later screens add their own buttons. It ships the conversation item, a theme toggle over `ctx.theme`, a profile button whose popover reads the gate's `/gate/api/me` and `/gate/api/credit/balance` (an offline line when the gate is unreachable; logout posts `/gate/api/logout`), and the aurora backdrop as a click-through `shell.overlay` entry.
- **`ui-tool` gains `tool.call.frame`** (single, session), declared by its own tool-call entry. `ToolCallTree` dispatches the per-tool body first and then offers the whole call to the frame occupant — body, subcall branch, selection target, `openDetails` — with the unchanged row as fallback. Anchors stay on ui-tool's wrapper so selection and scrolling do not depend on the occupant.
- **`ui-sci-conversation`** fills that frame with the workbench card and swaps the body for the agent galaxy on `subagent` / `workflow` calls. A turn-scoped `sci-artifacts` node definition folds `deliver_files` and `univer_export` settlements into turn data, so the artifact chips claim the turn tail from turn data alone (union with the deliverables reading) at priority −10 and hand clicks to `ctx.sciFiles.locate`. A 打开产出 header action and a token-only stylesheet over the shipped conversation's `data-*` attributes complete the skin.
- **`ui-sci-files`** grows the panel chrome, a chips row of every path the session produced, the `sciFiles` service, and a priority −10 occupant of `conversation.details.tool` for the workbench tool details.

`ui-brand-sci` carries the shared tokens (`--dsw-sci-*`) and the `SciLogo` mark. `ui-conversation` passes `openDetails` to keyed node renderers so a card can select its call and open the details column.

## Alternatives considered

**Shadow `conversation.chat.node['tool-call']` with a sci tree.** The first cut did this; the registry refused the re-declaration of `tool.call.toolview`, and dropping the declaration lost the web / terminal / diff / read / search views. A frame seat keeps ui-tool the owner of per-tool rendering and gives every future skin the same hook.

**Disable `ui-tool` in the profile and re-register its views from the sci package.** Would need ui-tool to export seven internal views, turning it into an implementation detail of one profile. Rejected.

**Galaxy board as a second `turnTail` entry.** The chain mounts one winner; the board and the chips would fight. The board belongs to the delegation call anyway, so it lives in that card's body.

**Chips claimed from the deliverables reading only.** A turn whose only product came through `deliver_files` rendered no chips. A turn-scoped definition owned by the sci package closes that without touching `ui-deliverables`.

**Render placeholder quota / plan badges from the design.** No data source exists for them in the gate or the harness; drawing them would be fiction. Omitted.

## Acceptance criteria

- Rail visible with the conversation item active; theme toggle flips `ctx.theme` and survives reload; profile popover shows the gate identity or the offline line.
- A real session produces cards for `bash` / `write` / `deliver_files` with running → settled transitions, collapsible bodies that still show ui-tool's per-tool views, ↗ opening the details column on the `tool` mode with the sci details body, and a chips row that locates the produced file in the 文件 mode.
- The 文件 panel header shows badge / name / size, 预览/源码 toggles, wide mode widens the column to `DETAILS_WIDE_RATIO` and hides the sidebar, download yields the file, close collapses the column.
- A cluster-tier delegation renders the galaxy with per-agent status and elapsed; token counts appear only when the settlement carries them.
- `pnpm run test:gui`, `tsc -b tsconfig.client.json`, `pnpm run lint`, `pnpm run doc-sync` pass; every new package sits at 100% per-file coverage.

## Risks

- The skin keys on eight `data-*` attributes of the shipped conversation; renaming one silently drops a rule. They are listed in the package README.
- The files store is a single instance across sessions, so the expanded-folder set carries over when switching sessions.
- `toolDisplayName` is a fixed Chinese table rather than a locale entry; the English UI shows Chinese tool names.
- Parked columns behind a future screen keep rendering (see the layout note).
