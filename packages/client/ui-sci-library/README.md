# @deepseek-ai/dsh-client-ui-sci-library

English | [中文](README.zh.md)

The CaMeL Science knowledge-base surface: the full-bleed 「知识库」 view with its entry detail page, the rail button that routes to it, the in-conversation rows a `library_search` or `library_add` call renders, and the 「加入知识库」 action that joins the search view's result cards.

The wire seam is `src/client/index.ts` alone. `apply` mounts the host's generated Remote contribution for `sci.library` before any registration and resolves the namespace through `ctx.get('remote.sci.library')`; the injected face folds transport rejections into the outcomes `src/client/contract.ts` declares, so a click handler never meets a rejected promise. File bytes travel outside the Remote channel: uploads post multipart bodies to `/library-api/upload`, large files link out through `/library-api/file`, and previews at or under the RPC reply cap reuse the files panel's reader.

Five contributions, every one through `ctx.slots.inject` so a composition without the declaring package simply lacks that surface: the `view` entry `library`, the `rail.item` button (order 20), the `tool.call.toolview` bodies for `library_search` and `library_add`, and the `search.result.actions` entry whose button reads 「加入知识库」 until the entry exists and 「已在知识库」 after — the initial state comes from a mount-time id listing, never from a guess.

Every number on screen is read off the host's replies: the counts behind the filter chips, the tag histogram, the citation and year tiles, the file sizes, and the related-entry list. Statuses, tags, and notes save through `update` on change and render the returned entry, so the page shows what the table holds rather than what was typed.

## Known Limitations and Deferred Work

- **Preview stops at the RPC reply cap (8 MiB by default).** Larger stored files render a download link to `/library-api/file` instead of an inline preview.
- **The add action's initial state is a snapshot.** 「已在知识库」 reflects the id listing taken when the search view mounted the action; an entry removed from another tab reads as present until the next mount.
- **BibTeX is regenerated client-side.** `bibtex.ts` mirrors the search view's citekey rule (family name + year) instead of importing across packages; the two stay aligned by their shared spec tests.

## Model Experience

None, as this is a browser-side presentation package over the `sci.library` Remote namespace: it registers no tool, prompt section, or session event, and everything it draws is host state the user already owns.
