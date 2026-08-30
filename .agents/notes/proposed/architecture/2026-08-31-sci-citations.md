# Agent Note: per-project citation pools over an authoritative `refs.bib`

Status: proposed

English | [中文](2026-08-31-sci-citations.zh.md)

## Problem

The `sci` profile can find works (`literature_search`) and remember them (`sci-library`), but nothing connects either to the manuscript being written. Three consequences follow, and all three are silent.

A model writing a review has no way to obtain a citekey, so it types one. A `\cite{zhao2015}` naming a key no bibliography defines renders as `[?]` in the built PDF, and a reader cannot distinguish it from a typo. `sci-manifest`'s `.paper` kind has no references field (`sci-manifest/src/kinds.ts:9-46`), and `sci-paper/SKILL.md:43` states only that citekeys must be stable — so `papers/<slug>/src/refs.bib` is where citations actually live, and nothing in the harness reads or writes it.

Nothing tells the user which citations are load-bearing. "Cited N times" cannot be asserted by a turn that claims to have written a paragraph; it has to be read out of the files. Without it, an entry added early and never used is indistinguishable from one the argument rests on.

Nothing separates a work four indexes agree on from one that appeared once in a preprint. Behavioural invariant #2 (`00-Architecture/04-behavioral-invariants.md:8`) requires citations in prose to be real rather than invented, and the profile has no per-work signal to act on.

## Proposal

A `packages/sci/sci-citations` host package publishing `ctx.sciCitations` (Remote namespace `sci.citations`), the tools `citations_add` and `citations_list`, and the prompt section `tool:citations` at order 113.

**The bibliography on disk is authoritative; the decisions are not re-derivable.** A citation row splits in two. The bibliographic half — title, authors, year, venue, DOI, arXiv id — and the in-text `uses` count both come from files and can always be read again: `rescan` parses every bundle's `refs.bib` and scans the project's `.md` and `.tex` through the `ctx.fs` seam the model's own `read` tool uses. The other half — the group a person filed the citation under, their note, a quarantine they set by hand — has no second origin, so the merge rule updates the first half and never touches the second. This is what makes the storage domain a convenience store rather than a projection, and it is stated as such in `spec.ts` rather than left implicit.

**Writing is byte-conservative.** `upsertBibtexEntry` replaces exactly the span of the citekey it rewrites and appends otherwise, so a hand-written file full of comments, `@string` macros, and its own spacing survives the model writing one entry into it. The parser is deliberately partial and deliberately loud: a block it cannot read becomes one `parseErrors` entry carrying file and line, because a pool missing one entry with a visible reason beats a pool that is silently short.

**Confidence is arithmetic.** A pure function of the signals: source agreement, a known year, a venue, not being an arXiv-only preprint, and a log-scaled citation count. No model call, no network, no clock — so the number can be stored on the row, shown to a user as a reason rather than an opinion, and recomputed identically by any client. A library status is a person's verdict rather than a signal, so it clamps the result afterwards instead of feeding into it.

**The quarantine floor is one-directional, and is the package's runtime invariant.** Below 70 an entry is held back automatically; above it the flag is purely someone's decision. Four paths write the flag (`add`, `rescan`, `move` out of the `quarantine` group, and `update` from a patch), so `./invariant` asserts over `domain/changed` that no committed row scoring below the threshold is released. It matters because that flag is what keeps a weak work out of a manuscript on three surfaces at once — the prompt, the tool output, and the view.

**Neither tool asks the model which project it is in.** The session already sits in one, so the slug is inferred from its working directory under `projectRoot`, and a session that is nowhere gets a refusal naming the directory shape it needs rather than a guess. Guessing here files a citation into another manuscript's bibliography, which is exactly the damage the citekey stability contract exists to prevent.

## Alternatives considered

**Store references in the `.paper` manifest instead of `refs.bib`.** Rejected: LaTeX reads `refs.bib`, so the manifest would be a second copy that drifts, and the build would keep using the file either way. Making the file authoritative removes the question of which one is right.

**Have the model write `refs.bib` with the `write` tool.** Rejected: it puts key minting, de-duplication, and metadata resolution in the model's head, which is where invented citekeys come from. Routing through a tool is what makes the returned citekey a fact rather than a claim.

**Score confidence with a model call.** Rejected: a score a user cannot check is an opinion wearing a number. The arithmetic version is auditable line by line and costs nothing per row.

**Recompute confidence for every row on rescan.** Rejected: an index-sourced row carries signals `refs.bib` never held — `citedBy` above all — so rescoring it from the file lowers it on every scan. Only rows whose sole provenance is the file are rescored.

**Let `update({ quarantined: false })` release any row.** Rejected: the flag is documented as the disjunction of an automatic rule and a decision, and only the decided half is anyone's to lower. Releasing a row scoring 30 would make it read as vouched-for everywhere at once. The request is honoured to the extent the rule allows and the returned row says so.

**Persist the scanned-file count.** Rejected: it is what one scan happened to walk, it is recovered by pressing rescan, and nothing can be done about it. A third table holding one such number is not worth the migration.

## Acceptance criteria

- `citations_add` resolves a DOI through `ctx.get('sciLiterature')`, refuses a DOI no index holds rather than minting a key that points at nothing, writes the entry into the project's `refs.bib`, and returns the citekey; `citations_list` renders the pool with real counts and marks quarantined entries.
- Both tools infer the project from the session's working directory and refuse, naming `<projectRoot>/<项目>/`, when it is not inside one.
- `rescan` takes in a citekey only the file knew about, counts `\cite{}` / `\citep{}` / `\citet{}` / `` `[key]` `` / `[key]` across the project's `.md` and `.tex`, and leaves group, note, and hand-set quarantine untouched.
- An unreadable `refs.bib` block is reported through `parseErrors` with its file and line, and the readable entries around it still load.
- No committed `sci_citation` row scoring below 70 carries `quarantined: false`, through every write path.
- Per-file 100% coverage over `packages/sci/sci-citations/src`, a real Loader composition test over a real project tree, and a keyless snapshot of `citations_add` + `citations_list` that replays.

## Risks

**Hand-written bibliographies vary more than any parser covers.** The reader guarantees only the common `@type{key, field = {…} | "…" | bare,}` forms with nested braces. Everything else surfaces as a `parseErrors` entry rather than a failure, which keeps the pool usable but means a project with an exotic file sees fewer citations than it has. Mitigation is the error list itself: the view can show exactly which block was skipped and where.

**One bundle owns the bibliography.** `add` writes into the first paper bundle in listing order. A project with two manuscripts citing different works needs `rescan` plus a manual split. Per-bundle pools are a larger model change and are not proposed here.

**The tables are not reconstructable.** Changes made from the browser view have no session log to replay, so losing the storage medium loses the groups, notes, and hand-set quarantines. The bibliographic half survives in `refs.bib` and returns through `rescan`, which bounds the loss but does not remove it.

**A `[n]` in prose does not link to the pool.** `ui-primitives` parses inline-code mentions only, so the connection a reader would expect between a rendered citation and the pool view does not exist yet. This is a known limitation rather than a regression, and the seam that would close it is not part of this change.
