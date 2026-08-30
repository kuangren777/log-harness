# Agent Note: the sci knowledge library — one table, three writers, bytes outside the RPC channel

Status: proposed

English | [中文](2026-08-30-sci-library.zh.md)

## Problem

`literature_search` (`dsh-sci-literature`) finds works in the public indexes and remembers only a query history. Nothing in the `sci` profile remembers the works themselves: the model re-downloads a PDF it has already summarized, the 知识库 view of the workbench design has no data source, and a record found in ②'s search view cannot be kept.

Three consumers need to read and write the same collection: the model (through tools), the library view, and ②'s result cards (an add action). Two of them live in the browser, where file bytes also have to enter and leave — and the Remote RPC channel caps a reply at 8 MiB, while a stored PDF is routinely larger.

## Decisions

**One storage domain, three surfaces over it.** `dsh-sci-library` owns domain `sci_library` (table `sci_library_entry`) and exposes it as the `library_search`/`library_add` tools, the `ctx.sciLibrary` service with Remote namespace `sci.library` (`LibraryRuntime extends TypertRemoteService`, the `dsh-sci-literature` pattern), and two HTTP routes. Every surface goes through the one runtime, so counts, tag histograms, and merge semantics cannot diverge.

**The library is a direct-write table, not a projection.** Like `sci_literature_history`, browser edits have no agent session to replay, so the table is authoritative and unreconstructable. The session event `sci/library-changed` (`ignorable: true`) is appended only on the tool path, where a session exists — the model-visible ⟺ logged rule is satisfied because the record text is already in the neighbouring `tool/result`.

**Entry identity is the literature record's identity.** An entry keeps the search layer's id (`doi:…`/`arxiv:…`/`title:…`), `file:<sha256>` for bare uploads, `note:<ulid>` for notes. Adding an existing id merges (tags union, files union, absent fields fill) and answers `created: false`, so 「加入知识库」 pressed twice, or a tool add over a browser add, converges instead of duplicating.

**Bytes travel outside the Remote channel.** `POST /library-api/upload` (multipart, extension allowlist, `413`/`415`) writes through `ctx.fs.writeBytes` — the primitive the [fs Agent Note](2026-08-30-fs-write-bytes.md) added for exactly this consumer — into `<libraryRoot>/<entry-dir>/`, and `GET /library-api/file` streams stored bytes back, both behind the same request-trust check as the Univer routes. Files land in the sandbox, so the `read` tool and the PDF skill open them at the path `library_search` prints; the prompt section `tool:library` (order 112) tells the model to do that instead of re-downloading.

**`fetchPdf` treats the network as hostile.** `https:` only, private hosts refused at every redirect hop (three at most), the size cap enforced while reading, and a reply that is neither `application/pdf` nor `%PDF`-prefixed refused — a login page saved as `paper.pdf` is the concrete failure this rejects.

**② grows a seat instead of a dependency.** `ui-sci-search`'s view entry declares `search.result.actions` (a per-record list seat carrying the record in owner props); `ui-sci-library` injects the 「加入知识库」 entry into it. A profile without ③ has cards without the strip; a profile without ② has a library without the shortcut. The two packages share no import in either direction. The action's initial pressed-state comes from a mount-time id listing (capped at one host page), never from a guess.

**Search is lexical and says so.** Query tokens score title (×3), tags (×2), abstract (×1), authors (×1). No embedding index exists in the repository, and the README states the miss-on-paraphrase behaviour as expected rather than pretending semantics.

## The typert pitfall this change surfaced

`tsconfig.base.json`'s `@deepseek-ai/dsh-*` wildcard maps only bare package names. A `/types` subpath import without its own explicit paths row falls through to node_modules and resolves to the built `lib/types/*.d.ts` — which typechecks (the declarations are equivalent) but hands the typert workspace analyzer a symbol identity foreign to the source program, and it refuses the referencing package's Remote contribution with `package reference … is not exported`. The fix is one paths row per cross-package `/types` import (`@deepseek-ai/dsh-sci-literature/types` → `src/types.ts`); any future package whose Remote payloads reference another package's `/types` owes the same row.

## Known deferrals

- `sci-deliver`'s `.base64` snapshots are not migrated to `writeBytes` this cycle (on-disk format change for existing consumers); its README now names the deferral instead of claiming the seam has no binary write.
- Inline preview in the 知识库 view stops at the RPC reply cap; larger files are offered through `/library-api/file` as downloads.
