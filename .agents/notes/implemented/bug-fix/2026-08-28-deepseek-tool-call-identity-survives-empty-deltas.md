# Agent Note: Keep a streamed tool call's id and name when continuation deltas carry empty strings

Status: implemented

English | [中文](2026-08-28-deepseek-tool-call-identity-survives-empty-deltas.zh.md)

## Problem

`@deepseek-ai/dsh-llm-deepseek` assembles a streamed tool call from `choices[].delta.tool_calls[]` fragments keyed by wire `index`. The translator copied `id` and `function.name` from every fragment whenever the field was present (`!== undefined`). DeepSeek's own stream sends both only on the opening fragment, so this was harmless there. A relay in front of the harness routed some requests to an upstream that repeats the fields on every continuation fragment as empty strings: `{"index":1,"id":"","function":{"name":"","arguments":"{\"prompt\": \""}}`. Those empty strings overwrote the opening values, the block closed as `{ id: '', name: '' }`, and the agent loop dispatched a call the router could only answer with `ToolNotFoundError: unknown tool ""`. In production the model then retried the same nameless call nine times inside one turn and reported "工具名称被置空" to the user; the first call of a session was unaffected, which is why single-call probes passed.

## Decision

An empty string is "unchanged", not a new value. The translator now assigns `callId` and `name` only from fragments whose value is a non-empty string; argument fragments still accumulate from every delta. The fix is two conditions in `translate.ts`, pinned by a test that replays the captured shape (opening fragment with id and name, continuation fragments with `id: ""` and `name: ""`) and asserts the closed block and every emitted `tool-call-delta` keep the opening identity.

## Alternatives considered

**Fail the stream when a block closes without a name.** Not adopted here: it would turn this upstream's ordinary stream into a hard `MALFORMED_RESPONSE` on every tool call, and the identity is present in the stream — the translator just discarded it. A loud failure for a call that is nameless after all fragments (no fragment ever carried a name) remains worth adding; it is a separate change because it alters the adapter's error surface.

**Route tool calls by `index` only and drop id handling.** Rejected: the loop pairs `tool/result` to `tool/call` by id, and the wire id is what a resumed session replays.

## Consequences

Tool calls survive relay upstreams that echo empty identity fields on continuation fragments. A stream whose opening fragment itself lacks id or name still closes with empty strings, as before; the follow-up above would make that loud.

## Testing

`packages/llm/llm-deepseek/tests/translate.spec.ts`: "keeps the call identity when continuation deltas carry empty id and name (live relay capture)". Suite: 10 files, 346 tests.
