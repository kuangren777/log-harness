# sci-memory — memory nodes, write timing, and recall for the `sci` profile

English | [中文](README.zh.md)

Replaces the memory and recall layer of the studied platform (`ClawsGO-System/06-Memory-and-Tasks/README.md`, data model in `ClawsGO-System/09-Target-Architecture/04-persistence-model.md`): memory nodes carried a `metadata.originSessionId` back-pointer to the transcript they were distilled from, but nothing wrote it when the model forgot, and the `clawsgo-recall` skill reached the transcripts by globbing raw JSONL out of the sandbox. Here a node written without an origin is repaired in place from the session that wrote it, when each node was written becomes a projection, and recall reads the harness's own session log through two RPC endpoints instead of a private on-disk format.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Memory-write observer | `tools/post-execute`, accept-only | `memoryDir`, `memoryTools` |
| `metadata.originSessionId` repair | `ctx.fs.editText`, guarded by the version read before the content | `memoryDir` |
| Session event `sci/memory-written` | appended to the writing session, `ignorable` | — |
| `sci_memory_index` projection | `ctx.storageDomain`, domain `sci_memory` | — |
| RPC `sci.recall.index` | Typert Remote, namespace `sci.recall` | `openingRequestLimit` (default `120`) |
| RPC `sci.recall.session` | Typert Remote, namespace `sci.recall` | — |

`memoryDir` is required and has no default: the home layout differs per sandbox image, and a guessed default would index nothing while the plugin looked healthy.

`memoryTools` names the tools whose accepted calls are inspected and the argument each one uses for its path, because the tool layer owns those names: `write` and `edit` take `file_path`, while `str_replace_editor` takes `path` and multiplexes reads and writes behind a `command` argument. A binding that names `commandArg` without `writeCommands`, or the reverse, fails the load — either half alone would silently index every read or nothing at all.

## Observation

The observer runs on `tools/post-execute` and always returns the decision the chain already reached; it can enrich the log but never blocks a write. `fs/write-intent` and `fs/edit-intent` are deliberately untouched: both are single-slot waterfalls already owned by `@deepseek-ai/dsh-fs-observation-policy`, and a second claimant there would drop that policy's compare-and-set guard.

An accepted call whose target resolves under `memoryDir` and ends in `.md` is read back and parsed. A file with no frontmatter mapping is not a memory node and is left alone. A node with no `metadata.originSessionId` is repaired with one literal edit anchored on its whole frontmatter block, guarded by the version read before the content, so a concurrent writer makes the repair fail rather than corrupt the node. The record then names the slug (frontmatter `name`, else the file's base name), the origin, and the turn the write landed in.

Failures after the write are contained and logged: the tool call already succeeded and was already reported to the model, so a node deleted between the write and the read-back indexes nothing instead of turning an accepted call into an error.

## Write timing

`memoryTimingScore(rows)` is `1 - mean(writtenAtTurn / turnsTotal)`: a node written in the first of many turns scores close to `1`, a node deferred to the final turn scores `0`. It is computed on demand, never on a session-end trigger — `session/end` does not exist. `turnsTotal` follows `turn/end`, whose own `turn` number is exactly the count of turns a session has completed, so the live projection and a cold replay agree. A node written before any turn opened has no position in its session and is not scored.

## Recall

`sci.recall.index()` returns one row per session in the `ctx.sessionQuery` corpus: id, start time, working directory, the opening human request bounded to `openingRequestLimit`, and the titles of the files delivered during it. A message a plugin, tool, or compaction replacement produced is never the opening request. `sci.recall.session({ sessionId })` returns that session's dialogue with tool calls, tool results, stream chunks, and reasoning stripped, and a marker where a compaction replaced history.

Delivery titles are read from `sci/delivered` records structurally rather than by importing `@deepseek-ai/dsh-sci-deliver`, so a deployment that mounts memory without delivery still produces an index — with empty `deliveries` lists.

## Model Experience

### Memory node content

#### What the model sees

Nothing at write time. The repair is applied to the file after the tool result the model already received, so a model that re-reads its own memory node later finds one line it did not write: `originSessionId` under `metadata`, naming the session that produced the node. That line is what makes `sci.recall.session` reachable from a recalled fact.

#### Token effect

The repaired line costs roughly twenty tokens, once, and only in a request that reads the node back. Nothing this package registers enters the system prompt or standing context, so an ordinary turn carries no cost from it at all.

#### KV Cache effect

None. `sci/memory-written` is log-only and never reaches a model request, so no prefix this package owns can move and no cached prefix is invalidated by observation or projection.

### Recall RPC results

#### What the model sees

Only indirectly, and only when it asks: the `sci-recall` skill calls these endpoints from inside the sandbox and the output arrives as an ordinary command result. The transcript projection is what bounds that cost — dropping tool traffic is typically the difference between a recalled session that fits in context and one that does not.

#### Token effect

Proportional to what the model requested: one index line per past session, or one session's prose. Neither is standing context.

#### KV Cache effect

None beyond the ordinary cost of any tool result appended to the conversation.

## Known Limitations and Deferred Work

- **Deletion of a memory node is not observed.** `ctx.fs` has no unlink verb, so a node removed through bash leaves its `sci_memory_index` row behind. The row is corrected the next time a node of the same slug is written; reconciling orphans belongs to `sci audit rebuild` (spec P9).
- **`turnsTotal` is folded live.** A session whose turns ended while this plugin was not mounted leaves rows reading a lower total, which biases their timing score upward. The cold rebuild that repairs this is P9's, not this package's.
- **The generated Remote client is not registered.** `pnpm run build` emits `lib/typert.host.*` and `lib/typert.remote-client.*` from the `./typert` and `./remote` exports, but adding this package to `packages/api/remotes/src/client/index.ts` is a cross-package change the profile assembly owns.
