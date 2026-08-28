# Agent Note: Record a nameless tool call without toolName so one bad row cannot refuse boot

Status: implemented

English | [中文](2026-08-28-sci-audit-nameless-tool-call-row.zh.md)

## Problem

`@deepseek-ai/dsh-sci-audit` projects every `tool/call` into a `sci_audit` row with `toolName: event.data.name`, and its record schema requires `toolName`, when present, to be a non-empty string. A malformed model stream produced tool calls with `name: ''` (see [the adapter fix](2026-08-28-deepseek-tool-call-identity-survives-empty-deltas.md)); the projector wrote ten rows with `toolName: ""`. The storage domain validates stored records against the schema when the plugin loads, so on the next boot `sci-audit` failed with `stored record 'session-…#287' in table 'sci_audit' does not match its schema`, the loader reported `plugin tree failed to load`, and the production VM crash-looped until the rows were removed by hand. An audit trail that can take the whole profile down is the wrong trade for a defensive record.

## Decision

The write side never produces the invalid shape. `auditRow()` drops every optional column whose value is the empty string (`toolName`, `target`, `rule`, `reason`, `sha256`) — the fields are optional, and "a call with no name" or "a result for a call with no id" is exactly what an absent value says. The same incident produced both shapes: `tool/call` rows with `toolName: ""` and `tool/result` rows with `target: ""`. The schema stays strict: a non-empty `toolName` remains the contract for every row that has one, and the read-side check keeps catching real corruption.

## Alternatives considered

**Relax the schema to accept `""`.** Rejected: it would enshrine the malformed value in the audit vocabulary and every consumer would have to treat `""` and absent alike.

**Skip unreadable rows at load instead of failing.** Not done here: the strictness belongs to the storage domain, shared by every plugin, and weakening it silently is a platform decision. Recorded as a follow-up worth having (quarantine + warn) for the platform owner.

## Consequences

A nameless call is audited as `kind: tool-call` with `actor` and timing but no `toolName`; boot no longer depends on a model never emitting a blank name. Operators who hit the crash loop on an older build remove rows with `"toolName": ""` from `$DSH_HOME/storages/sci_audit.json` (backup first) and restart.

## Testing

`packages/sci/sci-audit/tests/project.spec.ts`: "records a nameless tool call without toolName instead of an empty string".
