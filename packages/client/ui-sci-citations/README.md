# @deepseek-ai/dsh-client-ui-sci-citations

English | [中文](README.zh.md)

The CaMeL Science citation-pool surface: the full-bleed 「引用池」 view with its group column and citation list, the rail button that routes to it, and the in-conversation rows a `citations_list` or `citations_add` call renders.

The wire seam is `src/client/index.ts` alone. `apply` mounts the host's generated Remote contribution for `sci.citations` before any registration and resolves the namespace through `ctx.get('remote.sci.citations')`; the injected face folds transport rejections into the outcomes `src/client/contract.ts` declares, so a click handler never meets a rejected promise. Every mutation answers with the pool the host reports *after* the write — the plugin re-reads `pool` rather than trusting a mutation's own return — so a move, a group deletion, and a rescan cannot leave the header and the list describing two different pools.

Four contributions, every one through `ctx.slots.inject` so a composition without the declaring package simply lacks that surface: the `view` entry `citations`, the `rail.item` button (order 30), and the `tool.call.toolview` bodies for `citations_list` and `citations_add`. The tool rows validate the host-computed `result.meta` field by field before drawing it and fall back to the generic tool card otherwise, and they derive nothing from the call's arguments, so replaying a log draws the same rows.

Every number on screen is read off the host's replies: the header's total, mean confidence, quarantine count and scanned-file count, the counts beside each group, each citation's use count, and its confidence reading (≥90 green, ≥75 blue, below that orange). The group tag opens a menu of the project's real groups rather than rotating through them, and both destructive gestures — deleting a group, dropping a citation — ask before they act. The two hand-offs that leave the browser are total: the clipboard write and the object-URL download each state whether they landed, so 「复制引用块」 and 「导出 BibTeX」 never fail silently.

## Model Experience

None, as this is a browser-side presentation package over the `sci.citations` Remote namespace: it registers no tool, prompt section, or session event, and everything it draws is host state the user already owns.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`[n]` in prose does not link to the pool.** The conversation renderer resolves inline-code mentions only, so a numbered reference in a rendered answer stays plain text; the pool is reached through the rail button instead.
- **The record vocabulary is mirrored, not imported.** `src/client/contract.ts` restates the pool types and the namespace signatures from `packages/sci/sci-citations`; assembly replaces the block with the host's `/types` export and the generated `ctx.remote['sci.citations']` declaration.
- **A tool row shows a group's key, not its label.** A `citations_list` result carries the key the citation sits in without the project's group table, so a user-created group reads as its key rather than the name the user typed.
- **Group colors come from the host as written.** The column renders `group.color` verbatim and falls back to the neutral dot on an empty string; it does not check that color against the current theme.
