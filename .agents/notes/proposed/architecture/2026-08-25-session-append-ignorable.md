# Agent Note: The writer surface for the ignorable envelope marker

Status: proposed

English | [中文](2026-08-25-session-append-ignorable.zh.md)

## Problem

The [session-log version mechanism](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md) shipped the read side of `SessionEvent.ignorable` in v0: seed validation, both persistence backends, the BFF wire schema, and the unknown-type refusal in `PersistenceCoordinator` that skips an unrecognized event only when its envelope carries the marker. No writer could set it — `Session.append` had no parameter for it — so the marker was reachable only by hand-built envelopes in tests. That note deferred the writer surface to its first producer.

`packages/sci/sci-skills` is that producer. `sci/skills-synced` is one log-only record per sync round, carrying the sandbox-relative paths written and removed; nothing later in the log is interpreted differently by its presence. Without the marker, any build that does not mount the plugin refuses to reconstruct a log containing it, which is exactly the over-refusal the default is supposed to make rare rather than routine.

## Proposal

`Session.append` gains a third parameter for non-surface types: `append(type, data, { ignorable: true })`, typed by a new `AppendOptions` interface in `packages/core/session/src/types.ts`. Omitting it writes no envelope field, so every existing call site and every existing log is byte-identical.

The option is offered only to non-`SurfaceEventType` events. The three surface types are a closed set every build knows, changed only by a `SESSION_FORMAT_VERSION` bump, so a marker on one could never take effect and would offer to drop model-visible content; the compiler keeps taking `SurfaceIntent` there. `sci-skills` passes `{ ignorable: true }` at its single `session.append('sci/skills-synced', …)` call site, and its README drops the limitation that recorded the missing surface.

`SESSION_FORMAT_VERSION` stays `0`. The bump rule is about what a writer emits that an older reader cannot handle correctly: the marker is already read by every v0 reader, and an old reader meeting a marked event of a type it knows behaves exactly as before. Adding the ordinary event type is precisely the vocabulary growth the marker exists to absorb.

## Alternatives considered

**Put `ignorable` on `SurfaceIntent` so every type accepts it.** Symmetric and one interface smaller, but it would make a meaningless option available on the three types whose loss guts a session, in exchange for uniformity a reader can never observe.

**Default `ignorable: true` for events outside a core allowlist.** Rejected upstream and still wrong: a forgotten marker would silently resume a gutted session instead of loudly over-refusing a resumable one.

**Register `sci/skills-synced` as a known type instead.** It already is — the generated `KNOWN_SESSION_EVENT_TYPES` covers every in-repo `SessionEventMap` merge — so this fixes nothing for a build that composes without the plugin, which is the case that refuses.

## Acceptance criteria

`session.append(type, data, { ignorable: true })` produces an envelope whose `ignorable` is `true`, and that value survives a live-session flush and reload through the memory, sqlite, and jsonl backends (asserted once in the shared coordinator contract, so every backend runs it). A default append carries no `ignorable` own property and serializes exactly as before. A reader whose known-type set lacks the event's type still skips it when marked and refuses when not — the behavior already covered in the coordinator contract. `sci-skills` records the marker on its real sync event.

## Risks

The option is easy to over-apply: any producer can mark its event skippable, and a wrong marker turns a required event into silent data loss at reconstruction, the failure mode the required-by-default rule was chosen to avoid. The compiler cannot judge whether a payload is informational, so review of new `ignorable: true` call sites is the only control. Out-of-repo plugin events remain refused regardless of this change unless they set the marker themselves; a registration surface for their types stays deferred.
