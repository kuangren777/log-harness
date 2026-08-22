# Agent Note: Manual retry re-sends the failed turn's opening user text

Status: implemented

English | [中文](2026-08-22-manual-turn-retry.zh.md)

## Problem

`dsh-llm-retry` retries only its configured transient failure codes with a finite budget, and the `turn-error` row it leaves behind offered no action. After an authentication, quota, or exhausted-budget failure the user had to paste the message again by hand.

## Decision

The `turn-error` row carries a Retry button. It calls a new `IConversation.retryTurn(failureSeq)` on the session-scoped conversation service, threaded through `ChatViewSlotProps` and `ChatNodeOwnerProps` beside `forkAt`. The service reads the session snapshot, takes the latest `user` Chat Node whose seq precedes `failureSeq`, joins its text blocks with newlines, and admits them through the existing `session.prompt(…, 'queue')` path. Nothing on the Host changes: the failed turn and the original message stay in the log, and the re-sent message opens an ordinary new turn.

Image blocks are not repeated because the client holds only durable attachment references, not the bytes a prompt needs. A message without text, or a loaded window that no longer contains the opening message, rejects; the inject wrapper swallows that rejection and the row stays as rendered, while an admission failure already lands in the session's `promptError`.

## Alternatives considered

**Host-side `session.retry` that reopens the turn over the same durable history.** Rejected for now: it changes `agent-loop` and adds an RPC, and the loop's retry boundary (`agent/request-error`) only exists while a turn is open. The client re-send covers the common case at one-tenth the surface; the Host path remains the correct follow-up when a half-finished tool turn must resume without repeating the user message.

**Always-mode `retryPolicy`.** Rejected as a substitute because it also retries permanent failures without limit.

## Consequences

The model sees the user text twice in history when a retry succeeds. Tool calls from the failed turn are not resumed. `ChatNodeOwnerProps` consumers outside this package (`ui-tool`, `ui-workflow-run` tests) supply `retryTurn`.
