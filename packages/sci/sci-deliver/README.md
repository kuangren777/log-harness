# sci-deliver — `deliver_files`, the shell delivery spool, and failure re-injection for the `sci` profile

English | [中文](README.zh.md)

Replaces the two parallel delivery channels of the studied platform — the `mcp__clawsgo__deliver_files` MCP tool (`ClawsGO-System/02-MCP/clawsgo-server.md` §2) and the `__CLAWSGO_SEND__` stdout sentinel (`ClawsGO-System/03-Hooks-and-Mechanisms/mechanism-D-stdout-sentinel.md`) — with one validation chain behind both. There, the tool had a schema but the sentinel had none, the delivery-area rule was one hardcoded "must be inside the workspace" check with its two manifest exceptions living only in skill prose, and a sentinel delivery that named the wrong path produced nothing at all: no card, no error, and an agent that went on believing the file had reached the user. Here `validateDelivery` is one pure function both channels re-run on the harness side, its refusal names the remedy, and a failed shell delivery is materialised into the model's next prompt exactly once.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `deliver_files` | `ctx.tools.register()`, render intent `generic` | `deliveryDir` (named in the description) |
| Shell spool drain | `agent/pre-step`, at each turn's first step | `spoolDir`, `pollOnTurnStart` (default `true`) |
| Delivery snapshot | `ctx.fs`, under `<snapshotDir>/<deliveryId>/` | `snapshotDir`, `maxDeliveryBytes` (default 64 MiB) |
| Prompt context `sci:delivery-failures` | `ctx.systemPrompt.context()`, order `50` | — |
| Session event `sci/delivered` | appended to the delivering agent's session | — |
| Session event `sci/delivery-failed` | appended for a refused spool entry | — |

`projectRoot`, `spoolDir`, and `snapshotDir` are required and have no default. The home layout differs per sandbox image; a guessed `projectRoot` refuses every delivery the agent attempts, and a guessed `spoolDir` reads a directory the in-sandbox `sci` command never writes, which is exactly the silent failure this package exists to remove.

## The delivery area

`isDeliverablePath(path, config)` is the whole rule, evaluated without touching the filesystem. Two shapes pass: anything under `<projectRoot>/<projectId>/<deliveryDir>/`, and a `.paper` or `.sciplot` manifest sitting directly in its own bundle directory (`<papers>/<slug>/<name>.paper`). A `.canvas` board is not a third exception — it is authored in the delivery directory already, so it passes through the first rule and carries its manifest kind from there. Everything else is refused with a reason that tells the model to copy the file into the delivery directory and deliver the copy.

This package deliberately does not depend on `@deepseek-ai/dsh-sci-workspace`, whose `classifyPath` answers a larger question (which of twelve path classes, for a write/edit/delete decision). Delivery needs one predicate over four outcomes, and both were written in parallel.

## The validation chain

`validateDelivery(request, io)` is pure over injected `exists` / `isFile` / `readManifest` / `alreadyDelivered` predicates, and its step order is model-facing behaviour, not an implementation detail:

1. The delivery area, decided before any I/O, so a wrong path is told where files go rather than that it is absent.
2. Existence, then that the entry is a regular file.
3. For a manifest: the `@deepseek-ai/dsh-sci-manifest` validator, then the once-per-session budget — a manifest opens a live workbench, so a second delivery is refused with `already delivered; later edits reach the open workbench live — describe the change in chat instead`.

The budget is read from the session log's own `sci/delivered` records, so it survives replay and needs no side table. `./invariant` asserts the same relationship over the committed log, catching a bypassing caller rather than trusting the gate.

## The spool

The in-sandbox `sci deliver` command writes one JSON entry (`{ path, title, description? }`) into `<spoolDir>/pending/`, keeping the sentinel's one virtue — it fits inside a shell loop — and gaining a schema. `<spoolDir>/pending/` is the only model-writable path under `.sci/`, so an entry is untrusted input and `via: 'spool'` on the resulting event is a **display field, not an authorization signal**: a model can forge it. Correctness comes only from re-running the chain here.

`FileSystem` has neither unlink nor rename, so a settled entry is "moved" by writing it under `done/` or `failed/` and overwriting the pending copy with the tombstone `{"consumed":true}`, which the next round reads and skips. A crash between those two writes re-delivers at most one entry; a manifest is then refused by the once-per-session rule, and an ordinary file's second delivery costs one extra card.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`deliver_files` schema](../../../docs/tool-catalog.md#deepseek-aidsh-sci-deliver): `files[]` of `{ path, title, description? }`. The description interpolates the configured delivery directory, because that name is the fact the model must get right.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Tool-call history and result

#### What the model sees

The result is one line naming what reached the user (`delivered 2 files: report.md (12 KB), fig1.png (340 KB)`) and one line per refused file with its reason, so a call that delivers three of four files still delivers three instead of failing whole. The call renders as a `generic` card carrying every requested path in `locations`. The `sci/delivered` and `sci/delivery-failed` session events are log-only and never enter model history.

#### Token effect

Small, fixed-shape result; the arguments remain in history until compaction like any tool call.

#### KV Cache effect

Append-only; a delivery costs no tokens beyond the tool result and does not disturb KV-cache reuse.

### Delivery-failure context

#### What the model sees

After a spool drain records a failure, the next assembly carries the `sci:delivery-failures` runtime context — one line per failed entry with its reason — and the assembly after that omits it.

#### Token effect

A few dozen tokens for the turn that surfaces the failures; nothing otherwise.

#### KV Cache effect

A runtime context flipping on or off re-materialises the whole reminder snapshot, so that turn pays a KV-cache miss on the reminder block — accepted, since a silently lost delivery costs more.

## Known Limitations and Deferred Work

- **A non-UTF-8 snapshot is stored base64-encoded.** The snapshot path predates `FileSystem.writeBytes` and is not migrated to it yet, so a delivered PNG or PDF is still snapshotted as base64 text under a `.base64` suffix. The `sha256` and `size` in the event always describe the original bytes, so a card projected from the event is correct; a consumer reading the snapshot file must honour the suffix. Migrating the spool to `writeBytes` would remove the encoding entirely, but also changes the on-disk snapshot format existing consumers read.
- **The spool is drained per turn, not watched.** `pollOnTurnStart` is the fallback for a deployment with no directory watcher, which is every deployment today. A shell delivery therefore becomes visible at the next turn boundary rather than immediately, and `pollOnTurnStart: false` is only correct once a watcher drives the same drain.
- **A settled spool entry is never removed.** Retention of `<spoolDir>/done/` and `<spoolDir>/failed/` belongs to the image's cron policy (`ClawsGO-System/11-Deployment-Plan`), not to this package.
- **Canvas assets are resolved by walking the manifest's directory.** `canvasAssetDepth` (default `3`) bounds that walk; an asset referenced below it reads as missing and refuses the delivery.
