# Agent Note: Runtime settings for one mounted delegation tool

Status: proposed

English | [中文](2026-08-30-subagent-runtime-settings.zh.md)

## Problem

`tool-subagent` resolves its `Config` once, in `apply()`, and closes over it for the fiber's whole life. Every per-child choice it carries — the child's model route, its persona, its tool filter, whether the tool exists at all — is therefore a composition-time constant: changing one means editing a preset `cordis.yml` and reloading the deployment.

A product that presents delegation as a roster of named agents needs three of those choices to move at runtime, from a person's click, without a reload and without re-registering the tool mid-conversation: turn one agent off, point it at a different model, and take a capability away from it. The settings seam already serves exactly this pattern — `installSettingsSection` layers a stored section over the composition entry and hands the consumer a thunk it re-reads per use, as `web-search-deepseek` does per search — but `tool-subagent` neither injects `settings` nor reads such a thunk.

The remaining question is which choices belong in that section, and it is not "all of them": `provider`, `toolName`, `backgroundMode`, and `enableRunInBackground` are promises the tool's own schema and prompt section already made to the model, and `persona` and `maxDepth` define what a distinctly named instance IS.

## Proposal

`tool-subagent` registers one settings namespace per mounted instance and re-reads it on every execution.

- The namespace is the tool's own name in namespace spelling: `subagent` for the default, `subagent-researcher` for `subagent_researcher` (`_` becomes the `-` a namespace admits). A configuration surface maps a tool the model calls to the section that governs it without a registry, and `subagentSettingsNamespace(toolName)` is exported so a consumer never spells the derivation itself.
- `RuntimeConfig` is `{ enabled: boolean = true; model?: { provider; model }; toolFilter?: { allow?; deny? } }`, every field defaulted, registered through `installSettingsSection` with the composition entry projected into the `base` layer. A deployment that composes no settings service, and one whose provider detaches, both keep running on that entry: the dependency is soft by construction, because `installSettingsSection` scopes the whole registration under `ctx.inject(['settings'])` and restores the entry thunk on disposal. The plugin's own `inject` stays `['tools', 'subagents', 'systemPrompt']` — naming `settings` there would make a settings-less composition fail to boot, which is the opposite of the intent.
- `enabled: false` refuses at the executor: the tool stays registered and every call throws `该智能体已停用，请在「智能体」页启用后再委派。` before a parent is read or a child is started. Removing the tool from the catalog instead would change the model's tool list mid-conversation and invalidate its prefix; a refusal the model can read and report is both cheaper and honest.
- `model` replaces the entry's `agentOptions.provider`/`model` pair and leaves `maxTokens` standing. Both fields are required together, because a provider without a model selects nothing.
- `toolFilter` merges asymmetrically, and deliberately: `deny` is the UNION of the entry's list and the stored one, so a denial written into the composition is a floor no stored section lifts, while `allow` — a whitelist — replaces, because intersecting two whitelists is how a child ends up with no tools at all. The merged filter travels the existing path (`SubagentStartRequest.toolFilter` → provider → `applyChildComposition` → `ctx.tools.restrict()`), so the enforcement point is unchanged and the stored denial vanishes from the child's prompt as well as refusing execution.

### Reasoning effort is not offered, and what offering it would take

The spec asked for a `reasoningEffort` field. It is omitted, because nothing in the seam between this tool and a child's model request can carry it today:

- `AgentOptions` (`packages/core/agent/src/runtime-types.ts:24-31`) declares `provider`, `model`, and `maxTokens`. The only other field it carries anywhere is `subagentDepth`, added by `dsh-subagent` through declaration merging (`packages/subagent/subagent/src/depth.ts:11-16`) and read by that package's own accounting, not by the loop.
- The loop seeds a child request from exactly those three (`packages/core/agent-loop/src/agent.ts:437-455`): route from `this.options.provider`/`model`, `maxTokens` from `this.options.maxTokens`, and a `reasoningEffort` restored ONLY from the persisted header of a session whose route already matches. A fresh child has no such header, so a merged-in `AgentOptions.reasoningEffort` would be read by nobody.
- The one path that does reach a request is agent-scoped, not options-scoped: `sessions.selectModel` validates the effort through `ctx.llm.resolveCallConfig` and writes it into a `ModelSelectionRef` whose `agent/request` waterfall listener applies it (`packages/host/apiproxy/src/api-proxy.ts:2390-2410`, `packages/core/agent/src/model-selection.ts:54-70`). That listener is installed on a live agent's own context by whoever created it — for a child, the in-process subagent driver — and this tool holds neither the child's context nor a hook into its creation window.

So a real passthrough is a two-package change: a `reasoningEffort?: ReasoningEffortId` field on `AgentOptions`, plus its seeding in `agent-loop`'s `buildRequest` and a matching relaxation of the header-match check in `packages/core/agent-loop/src/invariant.ts:44-50`. Shipping the settings field without those would be a knob wired to nothing, so the field, and the UI selector that would drive it, are both deferred. A second reason to defer: an effort id is adapter-owned and opaque (`LlmReasoningEffortInfo.id`, per exact model route), and `llm-deepseek` offers `off`/`low`/`high`/`max` — a fixed `low | medium | high` union would name a level that provider has no id for.

## Alternatives considered

**Put the whole `Config` in the settings section.** One schema, one namespace, nothing to project. Rejected: `toolName` and `backgroundMode` are baked into the registered tool's name, description, and prompt section, so changing them at runtime means re-registering the tool and invalidating the parent's prefix mid-conversation; `provider` decides which tool exists at all. A section whose keys mostly cannot take effect is worse than a smaller one that always does.

**Let a stored section lift an entry denial (plain replace for `deny`).** Symmetric with `allow` and simpler to explain. Rejected: the composition entry is where a deployment writes what a given persona must never do, and a settings document is the surface most exposed to a UI and to a stored file. A floor that only composition can lower keeps the weaker surface from widening a child's reach.

**Dispose the tool registration when `enabled: false`.** The tool disappears from the catalog, which is the strongest possible enforcement. Rejected: the tool list changes mid-conversation, invalidating the request prefix and leaving the model to infer why a tool it just saw is gone. The executor refusal is enforcement at the operation that makes the decision, and it tells the model what happened.

**A `kind: 'disabled'` success result instead of a thrown refusal.** The Chinese copy would reach the model without the registry's `Error: ` prefix. Rejected: a refusal is not a completed delegation, and returning one as `isError: false` invites the model to treat it as a started child it can wait on.

**Add `reasoningEffort` to `AgentOptions` now and leave `agent-loop` alone.** Small diff, keeps the settings schema matching the spec. Rejected: nothing would read the field, so the UI would present a working control over a value with no effect — the exact failure the omission avoids.

## Acceptance criteria

- A stored `model` reaches the NEXT delegation's `SubagentStartRequest.agentOptions` with the entry's `maxTokens` intact, with no re-registration of the tool (its schema count stays 1).
- A stored `enabled: false` produces an errored tool result carrying the pinned copy verbatim, and the provider records no start; re-enabling restores delegation in the same context.
- The entry's `deny` and the stored `deny` arrive as one deduplicated list, and in a real spawn composition both denied names are absent from the child session's persisted `request/header` tool list while the parent still advertises them.
- A composition with no settings service, and one whose settings provider disposes, both send the composition entry's `agentOptions`/`toolFilter` unchanged.
- `packages/subagent/tool-subagent/src` stays at 100% per-file coverage; `tsc -b tsconfig.host.json`, `oxlint`, and `verify-export-jsdoc` pass.

## Risks

- A stored `toolFilter` on a provider without the `toolFilter` capability fails the delegation rather than the mount, because the capability is checked at `ctx.subagents.start()`. The composition-time key fails loud at mount; the stored one cannot, since the section outlives any single mount. The README states where each failure lands.
- `restrict()` throws on an unknown tool name, so a stored denial naming a tool the child's catalog never mounted fails that delegation. This is the existing behavior of the composition-time filter, now reachable from a settings document — a configuration surface should offer names, not free text.
- The namespace derivation rejects a `toolName` that is not lowercase snake or kebab case, at mount, where a composition-time misspelling belongs. Every `toolName` in this repository's presets and examples is already lowercase snake case.
- Two instances sharing a `toolName` now collide twice: on the tool name, and on the namespace. The namespace collision throws during `apply()`, which is earlier and better-explained than the existing late one-shot duplicate (`TODO(subagent-dup-toolname)`).
