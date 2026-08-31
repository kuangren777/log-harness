# Agent Note: Live referenced-text stores — a skill body follows its catalog

Status: implemented

English | [中文](2026-08-31-live-referenced-text-stores.zh.md)

## Problem

`ReferencedTextRegistry` verified every store read against the logged `sha256`, so a logged reference named exactly one text forever. `dsh-sci-skills` registered its body store under that contract while reading by name through the boot-time catalog: after a vault body update and a container restart, every session that had loaded the older body failed each subsequent model request with `DIGEST_MISMATCH`, permanently. Observed in production on 2026-08-31: skill `univer` in store `sci`, the 15:28 body recorded by the session, the 16:11 body served by the new catalog. The vault's never-deleted object store could have served the recorded body, but the store never consulted `ref.sha256` — and pinning old sessions to old bodies was judged the wrong product semantics anyway: a skill instruction update should reach running sessions instead of stranding them.

## Decision

`ReferencedTextStore` declares `mode: 'immutable' | 'live'`; absence means `immutable` and the prior contract is unchanged. For a `live` store the registry returns the store's current text with no digest verification; the logged `sha256` documents the text the model saw when the reference was logged, nothing more. `dsh-sci-skills` registers its store as `live`: a name the catalog lists resolves to the catalog's current body, and a name it no longer lists falls back to `source.object(ref.sha256)` — exact only for bodies that contained no `$SCI_SKILL_ROOT`, since expansion moves the digest off the vault's raw-body key — otherwise the read fails with the chained source error. `loadSkillBody` now takes the catalog entry instead of a name, deleting the unknown-name branch both callers already guarded against.

## Alternatives considered

- **Pin old sessions by hash** — the store reads `ref.sha256` from the vault's permanent object store. Preserves byte-exact replay but strands sessions on stale instructions, and is inexact for expanded bodies because the log records the expanded digest while the vault keys raw bodies; carrying the raw digest too would widen `ReferencedTextRef` for one store's need. Rejected by the operator for freshness.
- **Skip verification registry-wide** — removes tamper evidence for stores that are genuinely immutable, which the digest check exists to protect.
- **Re-record the reference when drift is detected** — rewriting logged history from the resolution path inverts the log's ownership; resolution is a read.

## Consequences

- **Model-visible ⟺ logged gains a declared exception**: for a `live` store, the log plus the store's current content — not the log alone — reconstructs the request. [Reconstructable requests](2026-07-05-reconstructable-requests.md) remains authoritative for every other block; this note owns the carve-out.
- A skill body update re-resolves every request position still carrying the reference: one full prefix-cache miss per session that loaded it, then stable again.
- A retired skill whose body used `$SCI_SKILL_ROOT` is unrecoverable by reference; recorded as a Known Limitation in the `sci-skills` README.
- Snapshot coverage is unchanged: resolution of a stable body stays byte-identical, and the changed path requires mutating the store mid-session, which the package suites exercise directly.
