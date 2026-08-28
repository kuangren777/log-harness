# Referenced-text content blocks

Status: implemented

English | [中文](2026-08-27-referenced-text-blocks.zh.md)

## Decision

A new merge-extensible content block, `referenced-text { store, id, sha256 }`, carries a content-addressed reference to model-visible text instead of the text itself. The session log stores the reference; the body is fetched and substituted only when a model request is built, inside the DeepSeek adapter, at the same point `ImageAttachmentRef` bytes are resolved.

## Why

Skill bodies are platform IP that must not persist in the session log, reach the browser client, or ship inside the harness image. The repository already generalized "Model-visible ⟺ logged" to "Model-visible ⟺ durably referenced" for images (see [2026-07-05-reconstructable-requests](2026-07-05-reconstructable-requests.md)): a request is reconstructable from the log plus the immutable content-addressed objects it references. Text references are the second instance of that exception. The `sha256` is the content commitment the resolver verifies, exactly as the image digest is; a mismatch or a missing store fails the request loud rather than silently substituting other text.

## Mechanism

- `@deepseek-ai/dsh-referenced-text` owns the `ReferencedTextBlock` type (merged into `ContentBlockMap`) and the `ctx.referencedText` registry. A provider registers a named `ReferencedTextStore`; `read(ref)` fetches and verifies the digest; `resolveMessages(messages)` replaces every `referenced-text` block (top-level and nested inside `tool-result`) with a `text` block, returning the same array instance when nothing needs resolving.
- The DeepSeek adapter (`llm-deepseek`) calls `resolveMessages` on a copy of `GenerateOptions.messages` before serialization when any message carries a reference, and throws `UNSUPPORTED_CONTENT` when no registry is mounted. It never mutates the loop's `options`, so the `dsh-agent-loop/invariant` comparison at `llm/stream` (which runs before the adapter) is unaffected.
- Resolution at the adapter seam covers replay, resume, and the compaction summarize call for free: they all rebuild the request through the same `ctx.llm.stream` path (`compaction-basic/src/summarizer.ts`). The `compaction-tool-result-pruner` passes non-text blocks through verbatim, so a reference block survives pruning.

## Fail-loud policy

A store that is missing, returns a digest mismatch, or cannot serve the object fails the model request rather than degrading it. This matches the image contract: unreadable referenced objects fail requests; byte-exact reconstruction is never weakened.

## What remains

The `skill` tool and the user-explicit `/name` invocation path emit referenced-text blocks when a skill definition carries a `reference` (sibling change in `dsh-skill` / `dsh-tool-skill`); the `sci-skills` provider is the first store, backed by the HTTP skill vault (14-Skill-Vault). No UI renders the body: `ui-skill` shows the digest only.
