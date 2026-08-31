# sci-tier — the balanced/cluster/auto tier, its prompt section, and the gates that make it true

English | [中文](README.zh.md)

Replaces the two per-turn tier reminders of the studied platform — the 762-byte balanced injection and the 3.5 KB agent-cluster injection (`ClawsGO-System/04-System-Prompts/verbatim/reminder-B-balanced-mode.txt` and `reminder-C-cluster-mode-2026-08-24.txt`, analysed in `ClawsGO-System/09-Target-Architecture/05-tier-model.md`). There the tier was prose and nothing else: thirteen balanced sessions produced zero fan-outs because the model complied, not because it could not, and the cluster reminder re-materialised 3.5 KB into every request while asserting runtime behaviour — a completion notification that never arrives, a `TaskOutput` polling loop, `resumeFromRunId` recovery — that this harness does not have. Here the tier is a property of the agent preset, its text is a prompt section assembled once, and gates enforce it: the cluster tier spends one declared plan per fan-out, and the balanced tier denies every fan-out name outright. A third composition, `auto`, answers the platform's other tier defect — the user chose the tier before the task was known, and a single-threaded session facing a task that needed a real experiment delivered a hollow one (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §1.2, §3): the swarm is mounted but shut until the model resolves the tier from the task with `resolve_tier`, and a balanced resolution can be raised to cluster mid-session.

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tier section `sci:tier:balanced` / `sci:tier:cluster` / `sci:tier:auto` | `ctx.systemPrompt.section()`, order `170` | `tier` |
| G1, declare before fan-out | `tools/pre-execute`, cluster and auto | `fanoutTools` |
| G2, the balanced lock | `ctx.tools.guard()` plus a load-time refusal, balanced only | `fanoutTools` |
| G0, the resolution lock | `tools/pre-execute` plus `ctx.tools.guard()`, auto only | `fanoutTools` |
| Tool `suggest_tier_upgrade` | `./suggest`, mounted by the balanced preset only | — |
| Tool `resolve_tier` | `./resolve`, mounted by the auto preset only | — |
| RPC `sci.tier.fork` | `./fork`, host plane | — |
| Session event `sci/tier-resolved` | appended on `session/created` (balanced, cluster) or by `resolve_tier` (auto, last record wins), required-on-read | — |
| Session events `sci/tier-upgrade-suggested`, `sci/tool-denied` | appended by the tool and the two gates, ignorable | — |

The package ships four mountable modules because they belong in four different places. The entry goes in every science-research preset; `./suggest` goes only in `sci-balanced`, where suggesting an upgrade is the model's one legitimate exit; `./resolve` goes only in `sci-auto`, the one composition whose tier the model resolves; and `./fork` is a Service and therefore host-plane — a service published from the entry would collide the moment the second preset mounted it.

The balanced text leaves the model exactly two exits from a task one pass cannot cover — a genuinely smaller real result with its scope stated, or `suggest_tier_upgrade` — and names the third one it closes: a large-looking result whose numbers no real run produced. The platform's text offered the honest exit only for research tasks, and on a reproduction task the model built the hollow result instead (§3 of the analysis).

## G1 · declare before you fan out

A latch is one `sci/plan-declared` record from `@deepseek-ai/dsh-sci-plan` plus whether a fan-out has spent it. The authoritative copy lives in this process, because consumption must be atomic: two `workflow` calls in one assistant message both reach `tools/pre-execute` before either result is in the log, so a gate that re-read the log would admit both. `rebuildLatch` is the replay path — after a restart it recovers the same state from the last declaration and any fan-out `tool/call` following it, excluding the call currently being decided, whose own `tool/call` the agent loop has already written.

A refused fan-out counts as spending the plan on a rebuild. That is the safe direction: it costs one extra declaration, where admitting an unauthorized fan-out costs a swarm.

## G2 · the balanced lock

`ctx.tools.restrict()` cannot serve here. It validates every name against the mounted catalog and throws on one the preset never mounted (`packages/core/tools/src/index.ts:1088`), which is exactly the balanced tier's situation: it mounts none of the names it wants blocked. `ctx.tools.guard()` is deny-only and name-blind, runs after the whole `tools/pre-execute` waterfall, and cannot be force-allowed by a listener, so the tier survives the composition it is protecting.

The load-time check is the complementary half: a fan-out tool already in the catalog when this row mounts is a misconfiguration, not an accident, and `apply` throws with the names it found.

## G0 · the resolution lock

In the `auto` composition the fan-out tools are mounted, so neither the load-time refusal nor a static guard applies. Instead both the `tools/pre-execute` listener and a `ctx.tools.guard()` read the session's latest `sci/tier-resolved` — kept per session in this process and rebuilt from the log on first use, the LAST record deciding because a raise appends a second one. Unresolved, every fan-out is refused under rule `unresolved` with `resolve_tier` as the exit; resolved to `balanced`, under rule `tier` with the raise as the exit; resolved to `cluster`, the call meets G1 exactly as in the cluster composition. `resolve_tier` itself refuses to lower a cluster session: the swarm's spend is what the user reserved, and a session that started one finishes in it. The auto session appends no `sci/tier-resolved` on creation — the model's own call is the record.

## The upgrade fork

`ctx.sessions.fork()` is deliberately not used: it copies the source log into the child as seed history (`packages/core/session/src/index.ts:1091`), and replaying a single-threaded transcript into a swarm session spends the wider tier re-reading work already done. `sci.tier.fork` creates an empty session instead, records the source in the header's `parentSession`, and appends ONE synthesised user message carrying the three things the new tier needs: the last request the human typed, the titles already delivered, and the reason the previous session gave for wanting a swarm. `sci/delivered` is read structurally, without depending on `@deepseek-ai/dsh-sci-deliver`, so a deployment that mounts tiers without delivery still forks.

## Model Experience

### Tier section `sci:tier:balanced` / `sci:tier:cluster`

#### What the model sees

Exactly one of the two texts, at order `170`, one step after the *Irreversible actions* chapter `@deepseek-ai/dsh-sci-guard` contributes at `165`. Each opens by naming the mode the user picked, in the words the picker shows — `Solo mode (单体)` or `Swarm mode (蜂群)`. The balanced text names no fan-out tool at all — this tier mounts none of them, and naming a tool the model cannot see only teaches it the tool exists — and ends by routing an over-large task to `suggest_tier_upgrade`. The cluster text keeps five of the original reminder's six disciplines (decompose, orchestrate, cross-check, cite in place, synthesize) and drops the third whole, because `notification never arrives`, `TaskOutput`, and `resumeFromRunId` describe a runtime this harness does not have; the real semantics live in the *Runtime environment* chapter of `@deepseek-ai/dsh-sci-prompt`. The cluster text states the gate as a gate: one declaration authorizes one fan-out.

#### Token effect

Roughly a hundred tokens for the balanced text or three hundred for the cluster text, once, in the static section block — against 762 B or 3.5 KB on every single turn before.

#### KV Cache effect

Prefix-stable: a section is assembled ahead of every dynamic context and neither text ever changes within a session, so the tier costs no re-materialisation at all.

### Tool schema

#### What the model sees

In the balanced tier only, the generated [`suggest_tier_upgrade` schema](../../../docs/tool-catalog.md#deepseek-aidsh-sci-tier): one required `reason` string. The description states what the tool does NOT do — it does not change the current session and does not start a swarm — because a model reading "upgrade" as an action would call it and then wait for capabilities that never arrive.

#### Token effect

Fixed schema cost on every request where the tool is visible; nothing in the cluster tier, which does not mount it.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Fan-out refusals

#### What the model sees

A refused call reads `Error: ` plus one of three sentences, each naming the way forward rather than only the rule: `declare_research_plan has not been called in this session` with the instruction to declare first; `the declared plan was already consumed by an earlier fan-out` with the instruction to declare again; and, in the balanced tier, `this session runs in Solo mode, which has no subagent orchestration` with the pointer to `suggest_tier_upgrade`. The `sci/tier-resolved`, `sci/tool-denied`, and `sci/tier-upgrade-suggested` records are log-only and never enter model history.

#### Token effect

Two or three sentences in place of the tool result, only on a call that was refused.

#### KV Cache effect

Append-only: both gates decide before dispatch, so the denial occupies the position the tool result would have and the reusable request prefix is unchanged.

## Known Limitations and Deferred Work

- **The load-time catalog check sees only what mounted before this row.** `apply` reads `ctx.tools.get()` at mount time, so a fan-out tool added by a LATER row in the same preset does not throw. The guard is what makes that harmless — it denies the call whenever the tool arrived — and the throw exists for the composition that is visibly wrong at the moment this row loads.
- **The invariant companion checks the shipped fan-out names, not the mounted `Config.fanoutTools`.** A companion is installed once per process and reads logs that may come from other compositions, so it uses `DEFAULT_FANOUT_TOOLS`. A deployment that renames its delegation tools keeps both runtime gates, which read its own configuration.
- **`sci.tier.fork` forks only a live session.** It reads `ctx.sessions.get()`, so a session that is no longer in this process answers `session-not-found` rather than being loaded from storage. Forking a stored session needs `@deepseek-ai/dsh-session-query` and a decision about what "the last human request" means across a compaction.
- **The effort dimension is deferred.** `reasoningEffort` is a plugin `Config` of `@deepseek-ai/dsh-llm-deepseek` (`packages/llm/llm-deepseek/src/index.ts:163`) with no per-request override, so a per-turn effort command would mean mutating Config at runtime. It needs a new request field on the llm seam and is out of scope here.
