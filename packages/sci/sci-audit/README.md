# sci-audit — session-log audit projection, summaries, and cold rebuild for the `sci` profile

English | [中文](README.zh.md)

Replaces the audit and statistics layer the studied platform designed but never wrote (`ClawsGO-System/09-Target-Architecture/08-security-model.md` §审计, table inventory in [`04-persistence-model.md`](../../../../ClawsGO-System/09-Target-Architecture/04-persistence-model.md)): OpenClaw specified a 74-table operational schema whose `audit_events` table stayed empty, and its statistics page hung on a session-end hook. Here the append-only session log is the only source of truth, every table is a projection of it, and the figures a panel shows are computed when someone asks — this harness has no `session/end` event to trigger on.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Live projection | `session/event`, every session the process holds | — |
| `sci_audit`, `sci_delivery`, `sci_plan` | `ctx.storageDomain`, domain `sci_audit` | — |
| Human command `/audit-rebuild` | `ctx.commands`, optional session-id arguments | — |
| `ctx.sciAudit.rebuild(sessionIds)` | cold replay through `ctx.sessionQuery` | — |
| `ctx.sciAudit.summarize(sessionId)` | computed on demand, never on a trigger | `webToolNames` |

## Table ownership

The persistence model lists six projection tables. This package owns three of them — `sci_audit`, `sci_delivery`, and `sci_plan` — and rebuilds exactly those. **This corrects the spec**, which reads as though one projector owned all six: `sci_skill_usage` and `sci_skill_lifecycle` are written by [`@deepseek-ai/dsh-sci-skills`](../sci-skills/README.md) from its own curation rules, and `sci_memory_index` by [`@deepseek-ai/dsh-sci-memory`](../sci-memory/README.md) from the frontmatter of the files it observes. Neither is reconstructable from the log alone, so neither can be truncated and replayed here. `summarize` reads the memory index through `ctx.sciMemory` and writes nothing to it; a composition without that package still summarizes, without the timing figure.

## Projection

`project(event, sessionId)` is pure and total: one log record in, zero or more rows out, no clock and no I/O. Every `sci_audit` row is keyed by the log coordinate it came from (`<sessionId>#<seq>`), so replaying a log writes the same keys the live path wrote instead of appending duplicates. Delivery and plan rows are keyed by the identity their event carries.

Only the session log is read. `tools/post-execute`, `workflow/end`, and every other Cordis-only event are deliberately absent: a row folded from them could not be reproduced by a cold replay, which would break the one guarantee this package exists to provide.

`AuditFold` holds the little that one event cannot decide. Today that is exactly one relation — a workflow run belongs to the plan declared before it, and `tool-workflow/run-start` names only the run — so the fold remembers the open declaration and claims it once. `projectLog` runs a fresh fold over a whole log and is what `rebuild` replays.

`sci/authorized`, `sci/tool-denied`, `sci/tier-resolved`, and `sci/tier-upgrade-suggested` are matched by their type string and read structurally, because `sci-guard` and `sci-tier` land after this package. Each carries a `TODO(sci-audit)` naming the payload type to import once it exists; a payload missing a field leaves that column unfilled rather than writing an empty one.

## Rebuild

`/audit-rebuild` re-projects every session in the `ctx.sessionQuery` corpus; naming session ids re-projects only those. A schema change to any owned table is a truncate-and-replay, never a migration.

The requested ids are checked against the corpus before anything is deleted, because `rebuild` deletes first and reads second — an id the corpus cannot serve would otherwise leave its tables emptied. Truncation of every requested session completes before any re-projection begins, so a `sci_plan` row claimed by a later session is not deleted after being rewritten.

The cold read goes through `sessionQuery`, which prefers live sessions, so a session still in memory is replayed from the same records the live fold saw. Rebuilds and live commits share one write chain and cannot interleave.

## Summaries

`summarize(sessionId)` returns the refusal count (`tool-denied` plus `fs-denied` rows), the delivery count, the count of explicitly granted authorizations, the memory write-timing score when the memory index is composed, and whether the session missed a citation. The counts come from the committed rows rather than from the log, so a caller sees what the projection actually committed; a divergence between the two is what `rebuild` exists to expose.

`citationMissing` is true when the session consulted the web and then answered without an inline Markdown link. A web tool CALL alone does not count — a call that failed or was refused produced no fact to cite — so the measured condition is a returned result, paired to its call by `callId` because `tool/result` does not repeat the tool name. It is measured, not gated.

## Config

`webToolNames` names the registered tools that consult the web, defaulting to `web_search` and `web_fetch`, the names [`@deepseek-ai/dsh-tool-web`](../../web/tool-web/README.md) composes. Tool registration is a composition choice, so a deployment that renames or replaces those tools tells this package here rather than losing the citation figure silently.

## Model Experience

Indirectly, through the packages whose events this projection reads and through the human command surface that triggers a rebuild; this package registers no model-visible context, tool, or prompt section of its own.

#### KV Cache effect

No direct invalidation; this package contributes no request tokens, and neither the projection nor a rebuild moves any prefix a model request is assembled from.

## Known Limitations and Deferred Work

- **The command is `/audit-rebuild`, not `sci audit rebuild`.** Slash commands are single names in `@deepseek-ai/dsh-commands`, so the spec's three-word CLI form is not registrable; the package publishes a service so a future Remote surface can call `rebuild` directly.
- **No RPC surface.** The statistics page the security model describes needs a Typert Remote endpoint over `summarize`; the service method exists, the wire surface does not, and adding one is a profile-assembly change (spec P12).
- **No `subagent:<id>` actor.** The security model's actor vocabulary includes delegated subagents, but the log records this projection is allowed to read (`02-w0-adversary-resolution.md`, M6) name workflow runs and their members only, so a delegated call is attributed to the session that made it.
- **Four `sci/*` types are read structurally.** Until `sci-guard` and `sci-tier` export their payload types, a rename in either package silently stops filling this package's columns instead of failing the build.
- **Rebuild does not reconcile foreign orphans.** A stale `sci_memory_index` row left by a deleted memory node is `sci-memory`'s to repair; this package neither owns that table nor can replay it.
