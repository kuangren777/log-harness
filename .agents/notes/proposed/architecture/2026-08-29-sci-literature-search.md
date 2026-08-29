# Agent Note: Literature search as its own runtime — four indexes, one record shape

Status: proposed

English | [中文](2026-08-29-sci-literature-search.zh.md)

## Problem

The `sci` profile had no way to find papers as papers. `web_search` returns URLs with snippets; a researcher needs authors, venue, year, citation counts, an abstract, and an identifier that resolves — a DOI or an arXiv id — and needs them from the indexes that actually hold the literature: OpenAlex, Semantic Scholar, arXiv and Crossref. The workbench design also puts a full-screen 检索 view beside the conversation, so the same capability has to serve a browser without a session as well as the model inside one.

`ctx.web` cannot carry this. Its seam selects one provider at call time and refuses when two are usable (`WEB_PROVIDER_AMBIGUOUS`), and `WebSearchSource` has no bibliographic fields. Literature search is the opposite shape: every query fans out to all four indexes at once and the answer is their merge.

## Proposal

One host package, `packages/sci/sci-literature`, carrying all three seam roles because only the sci profile consumes it and the four sources evolve together.

- `LiteratureRuntime` (`ctx.sciLiterature`, Typert Remote namespace `sci.literature`) runs one query against the four adapters in parallel with a per-source timeout. A source that fails lands in `sourceErrors`; only when every source fails does the call throw `LITERATURE_ALL_SOURCES_FAILED`. Replies normalize to one `LiteratureRecord`, merge on DOI → arXiv id → normalized title (a group re-registers its keys after each merge, so an OpenAlex record and its arXiv preprint collapse), and rank by per-source rank plus `0.15·log10(citedBy+1)`.
- The same service registers the `literature_search` tool and its prompt section from `Service.init` after the storage domain opens, so a call can never reach a runtime whose history has no medium. The tool's `presentationMeta` carries `{ kind: 'literature', records }` for the browser card.
- History rows in `sci_literature_history` are keyed by `sha1(query)` so a repeated search moves one chip instead of stacking, and `forget` names a row. The table is a convenience store, not a log projection: browser searches have no session to replay.
- `sci/literature-searched` is appended `ignorable: true` on the tool path only; the record text already sits in the neighbouring `tool/result`.
- Outbound calls are `https:` to a four-host allowlist, `redirect: 'error'`, 2 MB read cap, explicit product User-Agent with the deployment's `mailto` for the polite pools. The Semantic Scholar key is optional and resolved through `ctx.credentials` with an environment fallback; `available()` stays true without it.

`packages/client/ui-sci-search` registers the `view` key `search`, the `rail.item`, and the `tool.call.toolview` for `literature_search`. It reaches the host only through `ctx.remote['sci.literature']` and mirrors the record types locally (a client package may not depend on a host package), so the two halves build in parallel against the spec.

## Alternatives considered

**A `ctx.web` provider.** Rejected: the seam picks one provider and its source shape has no authors, venue, DOI or citations; bending it would leak bibliographic fields into every web consumer.

**One provider package per index behind a `LiteratureRuntime` seam with selection config.** Mirrors `dsh-web`, but no one wants to pick one index — the product value is the merge. Kept the four adapters as modules of one package with per-source failure isolation instead.

**A raw `webServer` HTTP route for the browser view.** Justified for Univer because its viewer is a third-party iframe; the 检索 view is ordinary client code, and the Remote channel already carries the trust check and typed errors.

**History as a projection of `sci/literature-searched`.** The event exists only where an agent session exists; the browser view has none, so a projection would never see its searches.

## Acceptance criteria

- `literature_search` returns a merged, de-duplicated list for `n-type SnSe thermoelectric` with the OpenAlex/arXiv pair collapsed into one record carrying both sources; a 429 from Semantic Scholar shows up in `sourceErrors` while the other three sources' records still return.
- The keyless snapshot `examples/sci-agent/tests/snapshots/sci-literature-search.txt` replays from the recorded fixtures.
- The 检索 view lists results with source tags, BibTeX copy, PDF links only where an OA URL exists, and a deep-dive action that opens a prefilled conversation.
- `pnpm run typecheck`, `test:gui`, `lint`, `doc-sync` pass; both packages sit at 100% per-file coverage.

## Risks

- Semantic Scholar rate-limits shared egress without a key; the result degrades to three sources with a visible error, never silently.
- The arXiv Atom reader is a fixed-field parser; a feed change surfaces as a failed fixture test, not a silent field loss.
- The merge is single-pass, so a transitive A–B–C chain arriving out of order can stay two groups (documented in the package README).
