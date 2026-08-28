# Agent Note: Referenced-text content blocks

Status: implemented

English | [中文](2026-08-27-referenced-text-blocks.zh.md)

## Problem

Skill bodies are platform IP that must not persist in the session log, reach the browser client, or ship inside the harness image. But a skill body is model-visible text, and the repository's invariant is that anything a model request contains is reconstructable from the log ("model-visible ⟺ logged"). Storing the body inline satisfies the invariant and leaks it; omitting it protects the body and breaks replay, resume, and compaction, which all rebuild requests from the log.

## Decision

A new merge-extensible content block, `referenced-text { store, id, sha256 }`, carries a content-addressed reference to model-visible text instead of the text itself. The session log stores the reference; the body is fetched and substituted only when a model request is built, inside the DeepSeek adapter, at the same point `ImageAttachmentRef` bytes are resolved.

- `@deepseek-ai/dsh-referenced-text` owns the `ReferencedTextBlock` type (merged into `ContentBlockMap`) and the `ctx.referencedText` registry. A provider registers a named `ReferencedTextStore`; `read(ref)` fetches and verifies the digest; `resolveMessages(messages)` replaces every `referenced-text` block (top-level and nested inside `tool-result`) with a `text` block, returning the same array instance when nothing needs resolving.
- The DeepSeek adapter (`llm-deepseek`) calls `resolveMessages` on a copy of `GenerateOptions.messages` before serialization when any message carries a reference, and throws `UNSUPPORTED_CONTENT` when no registry is mounted. It never mutates the loop's `options`, so the `dsh-agent-loop/invariant` comparison at `llm/stream` (which runs before the adapter) is unaffected.
- A store that is missing, returns a digest mismatch, or cannot serve the object fails the model request rather than degrading it — the same fail-loud contract images have: unreadable referenced objects fail requests; byte-exact reconstruction is never weakened.

This is the second instance of the generalized invariant in [2026-07-05-reconstructable-requests](2026-07-05-reconstructable-requests.md): "model-visible ⟺ durably referenced" — a request is reconstructable from the log plus the immutable content-addressed objects it references. The `sha256` is the content commitment the resolver verifies, exactly as the image digest is.

## Alternatives considered

- **Keep the body inline in the log and redact it at the client wire (api-proxy).** Rejected: the log is the durable artifact users can obtain through export, resume, and any future operator tooling; redacting one wire copy leaves the body in every other copy. Wire redaction is still used for the lower-value catalog descriptions, where the log legitimately keeps the text.
- **Resolve the reference at `agent/pre-step` instead of in the adapter.** Rejected: pre-step output becomes new logged messages, so the body would be logged after all; and compaction's summarize call does not pass through `agent/pre-step` but does pass through `ctx.llm.stream`, so only the adapter seam covers replay, resume, and compaction with one implementation.
- **Encrypt the body field in the log.** Rejected: the key would have to live beside the log for replay to work, and every reader of the log format would need the cipher; a content-addressed reference needs neither and reuses the image mechanism.
- **A new `SessionEventMap` entry for referenced content.** Rejected: the reference rides the existing `tool/result` and `user/message` envelopes exactly as `ImageBlock` does, so no event-schema change is needed.

## Consequences

- Resolution at the adapter seam covers replay, resume, and the compaction summarize call for free: they all rebuild the request through the same `ctx.llm.stream` path (`compaction-basic/src/summarizer.ts`). The `compaction-tool-result-pruner` passes non-text blocks through verbatim, so a reference block survives pruning.
- A store must serve byte-identical content for a given `sha256` for as long as any log references it; the skill vault therefore keeps every body version and never deletes an object.
- The `skill` tool and the user-explicit `/name` invocation path emit referenced-text blocks when a skill definition carries a `reference` (`dsh-skill` / `dsh-tool-skill`); the `sci-skills` provider is the first store, backed by the HTTP skill vault (14-Skill-Vault). No UI renders the body: `ui-skill` shows the digest only.
- Only the DeepSeek adapter family resolves references today; a second adapter family must add the same pre-serialization step or reject referenced content with `UNSUPPORTED_CONTENT`.
