# dsh-sci-manifest

English | [中文](README.zh.md)

Replaces the prompt-only manifest contracts of the ClawsGO `clawsgo-paper`, `clawsgo-sciplot`, and `clawsgo-canvas` skills (archived at `ClawsGO-System/01-Skills/_raw-skills/`, outside this repository). Those skills state the rules as prose the model is asked to honour — never write `versions`, never edit `history`/`output`/`annotations`, never move an existing canvas node, double-check edge ids — so a model that ignores them still corrupts the user's submission history or re-lays-out their board. This package turns each rule into a pure function that returns a named field, so `sci-workspace` can deny the write at `tools/pre-execute` and `sci-deliver` can reject the delivery, instead of asking the model to behave. Design: `ClawsGO-System/09-Target-Architecture/06-delivery-and-workspace.md` (P1), test T7.

No Cordis service, no plugin, no filesystem access: everything a manifest cannot answer for itself arrives as an injected predicate, so the same functions run inside a policy gate, inside the delivery chain, and inside the in-sandbox `sci` CLI.

## What each kind owns

| Kind | Path | Fields the agent must not write | Cross-reference checks |
|---|---|---|---|
| `paper` | `*.paper` | `versions` (the workbench appends submission snapshots) | `entry` is a bundle-relative `.tex` file |
| `sciplot` | `*.sciplot` | `history`, `output` (render script), `annotations` (user) | `entry` is a bundle-relative `.py` / `.r` / `.sh` / `.jl` script |
| `canvas` | `*.canvas` | `position` and `size` of every node that already exists | node ids unique, edge ids unique, every edge endpoint is a node id, every `src` is contained and exists |

## API

`validatePaper(json)`, `validateSciplot(json)`, and `validateCanvas(json, { assetExists })` take an already-parsed value — strict JSON is `JSON.parse`'s job, and a comment or trailing comma never reaches a validator. Each returns `{ ok: true, kind }` or `{ ok: false, kind, errors }`, where every message names the offending field path (`canvas manifest.nodes[2].position.x`), node id, or edge id, so a denial reason can quote it without re-deriving the location. A pass reports every offending field, not the first.

`diffOwnedFields(kind, before, after)` returns the owned fields an edit would change: `['versions']`, any of `['history', 'output', 'annotations']`, or `nodes[<id>].position` / `nodes[<id>].size` per canvas node. Comparison is structural and ignores object key order. Neither revision needs to be a valid manifest — an unreadable side reads as absent, so replacing a manifest with garbage still reports its owned fields. Canvas nodes the edit added or removed are not reported: the skill permits both, and only re-laying-out an existing node is forbidden. Every canvas ambiguity resolves toward reporting a change, because the consumer reads a non-empty result as a denial: a `before` node whose id is missing, non-string, or duplicated is reported by index (`nodes[0].position`), an `after` revision whose node list is unreadable reports every `before` node's geometry, and an id duplicated on the `after` side is reported even when one copy matches.

`isManifestPath(path)` classifies a path by extension without touching the filesystem, matching the extension case-insensitively (`Report.PAPER` is the same file as `Report.paper` on the case-insensitive filesystems the user-side workbench runs on, and `requireEntry` already accepts `a.TEX`) and only with a non-empty file name in front, so a dotfile named `.paper` is not a manifest. `BUNDLE_KINDS` is the kind vocabulary; the name predates the `sci-bundle` → `sci-manifest` package rename and stays as the published constant.

## What it deliberately does not check

The rows inside `versions`, `history`, `output`, and `annotations` carry no schema. The workbench, the render script, and the user write them, and the skills' JSON blocks fix only the containers, so a stricter row schema would reject manifests this agent never produced. Their container type is checked; that the agent must not write them at all is `diffOwnedFields`, not the validators.

Timestamps are checked for ISO-8601 UTC format, not calendar validity. Two canvas checks are stricter than the renderer on purpose: the renderer silently drops an edge that points at a missing node id, and it cannot display an asset that is not beside the manifest — both reach the user as a board that is quietly wrong, so both are errors here.

## Fixtures

`tests/fixtures/{paper,sciplot,canvas}/` holds plain-JSON manifests beside an `expected.json` that maps each file name to `{ "errors": [...] }` — the substrings the validation output must contain, empty for a valid fixture. Canvas entries add `"assets": [...]`, the inventory the injected `assetExists` reports as present. The in-sandbox `sci` CLI ports this validator to Python and reuses these fixtures unchanged, so both implementations are pinned to one corpus: keep the files plain JSON, keep every fixture listed in `expected.json`, and keep the expectations substrings rather than exact messages.

## Model Experience

Indirectly, through the gates that consume these results, such as `dsh-sci-workspace` and `dsh-sci-deliver`, which render a denial reason from a named field.

#### KV Cache effect

No direct invalidation: this package registers no prompt section, tool schema, or runtime context. A denial a consumer renders appends at that consumer's own position in the request.

## Known Limitations and Deferred Work

- **The Python port is a second implementation, not a shared one** — the in-sandbox `sci` CLI reimplements these rules; only the fixture corpus keeps the two in step, so a rule added here without a fixture drifts silently.
- **Owned-field enforcement needs the before revision** — `diffOwnedFields` compares two manifests, so a caller that cannot read the current file (a create, or a read the gate denies) cannot use it and must fall back to rejecting the whole write.
- **Asset existence is a point-in-time answer** — `assetExists` is consulted during validation; a board that passes can still reference a file deleted before the user opens it.
- **Platform-written rows are unvalidated** — a workbench or render-script defect that writes a malformed `versions` or `history` row passes validation here and surfaces only in the user's viewer.
