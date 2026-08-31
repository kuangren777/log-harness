# @deepseek-ai/dsh-referenced-text

English | [中文](README.zh.md)

The content-addressed text seam. `ctx.referencedText` owns the `referenced-text` content block, the registry of named stores that can produce its text, and the digest verification that, for an immutable store, proves a logged reference still names the same text.

A `ReferencedTextRef` records a store name, a store-local id, and the lowercase hex SHA-256 of the UTF-8 encoding of the text. A producer logs `{ type: 'referenced-text', store, id, sha256 }` instead of the text itself, so the session log holds the reference while the model request holds the text — the same split [`ImageBlock`](../attachment/README.md) uses for durable images, and the way this package satisfies the [reconstructable-request contract](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md).

`registerStore(name, store)` files one borrowed same-process store under a unique name and returns the disposer; a duplicate name throws, and disposing the registering fiber removes the store. `read(ref, signal)` finds the owning store and awaits `store.read(ref, signal)`. A store declares its `mode`: `'immutable'` (the default when absent) promises byte-identical text for a reference forever, so the registry hashes the returned text and returns it only when the digest matches the reference; a `'live'` store serves its current text for the id, the registry performs no digest verification, and the recorded `sha256` documents the text the model saw when the reference was logged. `resolveMessages(messages, signal)` walks the assembled request, replaces every `referenced-text` block — including blocks nested in `tool-result` content — with the verified `{ type: 'text', text }` block, and leaves every other block as the log recorded it. Messages that carry no reference are passed through by identity, and an input array with no reference anywhere is returned unchanged, so a caller can detect "nothing resolved" with a reference comparison. Input messages are never mutated; they may be deep-frozen. Each distinct reference is read once per `resolveMessages` call.

`ReferencedTextError.code` uses the closed `ReferencedTextErrorCode` union. The registry raises `STORE_MISSING` when no store owns `ref.store` and `DIGEST_MISMATCH` when an immutable store's returned text hashes to another digest; a store raises `NOT_FOUND` when its content no longer holds the id. A failure anywhere aborts the whole resolution: `resolveMessages` returns no partial result.

## Model Experience

### Referenced text resolved into the request

#### What the model sees

The exact UTF-8 text the store returns, as an ordinary `text` block in the position the `referenced-text` block occupied. The model never sees the store name, the id, or the digest; a reference that fails verification produces an error instead of substitute text, and a live store's reference resolves to whatever text the store currently holds for the id.

#### Token effect

Conditional and equal to the resolved text: a reference costs the tokens of its full body on every request that still carries the block, and zero once the block leaves the request. The reference fields themselves are never serialized, so they cost nothing.

#### KV Cache effect

Append-only while the referenced text is stable, because resolution is deterministic: the same reference yields byte-identical request text on every request, preserving an already-reusable prefix. Editing an immutable store's text changes its digest, which makes the old reference fail verification rather than silently rewriting an earlier request position. A live store trades that stability for freshness: when its text changes, every request position still carrying the reference re-resolves to the new text, rewriting the prefix at one full cache miss.

## Known Limitations and Deferred Work

- **No adapter resolves the block yet** — `resolveMessages` has no caller until the DeepSeek adapter family calls it at serialization time; only that family is planned, so any other adapter reaching a `referenced-text` block treats it as an unknown block.
- **No UI rendering** — transcript consumers have no presentation for a `referenced-text` block and show it as opaque content until a client-side row lands.
- **Compaction passes references through unchanged** — the tool-result pruner measures and prunes `text` blocks only and copies every other block verbatim, so a referenced body is neither measured against the character budget nor pruned.
