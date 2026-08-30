# Agent Note: A persona roster that is the mounted delegation tools, not a table beside them

Status: proposed

English | [中文](2026-08-31-sci-agents.zh.md)

## Problem

The `sci` profile now mounts six `@deepseek-ai/dsh-tool-subagent` rows, one per persona, and each of them carries a settings section a person can retune between delegations. Nothing yet lets a person see or touch those six sections: `ctx.settings.describe()` returns namespaces named `subagent-researcher` … `subagent-deliverer` with no charter, no display copy, and no usage behind them, and the browser's 智能体 view needs all three.

The studied platform answered the same need with an *Agents* page over a roster table, whose rows were editable and whose «训练新智能体» button created more of them (`ClawsGO-System/09-Target-Architecture/04-persistence-model.md`). That table was a second source of truth: a row could say an agent existed, was enabled, and had a model, while the running system delegated to something else entirely — nothing in the delegation path read the table.

So the question is not "where do we store the roster". It is "how does a page show, and change, facts that are already true of the running system", for four kinds of fact with four different owners: the charter (a package resource), the configuration (a settings section), the model catalog (`ctx.llm`), and the usage (the session log and its audit projection).

## Proposal

`packages/sci/sci-agents` is a read-mostly projection over those four owners, publishing `ctx.sciAgents` and four Typert Remote endpoints under `sci.agents`. It owns no table, no session event, and no cache; the single write it makes is to the settings section a delegation tool already re-reads on every execution.

```ts ignore-check
roster(): { agents: RosterAgent[] }
configure({ persona, patch }): { agent: RosterAgent }
calls({ persona, limit }): { calls: AgentCall[] }
models(): { providers: ModelProvider[]; failures: ModelCatalogFailure[] }
```

- **Identity is the persona id, and the tool name is derived from it.** `subagentToolName(persona)` (`@deepseek-ai/dsh-sci-tier`) is the single derivation the G1 latch, the roster prompt, the settings namespace, and this service all go through, so a card, a gate, and a stored section cannot disagree about which tool a persona is.
- **Card copy moves into the persona documents.** `SciPersona` gains an optional `display` block (`name`, `role`, `description`), read by the same parser that reads the charter, so the model-facing English and the person-facing Chinese are reviewed and translated as one file. A document declaring none falls back to `name`/`summary`, and `personas.spec.ts` asserts the SHIPPED tree never takes that fallback.
- **Permissions ARE the deny list.** The three switches are not stored anywhere; they are computed from, and written into, `toolFilter.deny` — the list `ctx.tools.restrict()` applies at child creation. A switch reads off as soon as any tool of its group is denied, which is the honest reading of a partly-scoped child.
- **The preset is ensured before settings are read.** `ctx.agentPresets.standingKeyFor(preset)` mounts the preset's standing composition without starting an agent, a session, or a turn, which is what makes the page answer correctly with no session open.
- **`models()` consumes `ctx.llm`, not a catalog of its own.** It is the same directory `sessions.models` builds the session picker from, so a provider a deployment registers is offered here immediately, and a provider whose lookup fails is reported rather than fatal.
- **`durationMs` is the child's, folded by the child's own projection.** `subagentTimingProjectionDefinition` is applied to the child log rather than re-derived, and the parent's call-to-result interval is deliberately never used.

## Alternatives considered

**Store the roster in a `sci_agents` table.** One read, no scanning, and stats could be incremented as they happen. Rejected: it is the studied platform's failure mode restated. Every row would be a claim that nothing in the delegation path verifies, and the first drift — a preset that stopped mounting a persona, a settings section written by hand — would be invisible on the page that exists to report it.

**Let `configure` write the three switches as switches, and translate to `toolFilter` at delegation time.** The stored document would read the way the UI does. Rejected: `tool-subagent` would then need to know about permission groups, which are a `sci` product concept, and a composition-level `toolFilter.deny` and a stored switch could contradict each other with no defined winner. Storing the enforced list keeps one truth.

**Report `enabled: true` for a persona whose row the composition does not mount.** The card would show the persona's default state rather than a state it is not in. Rejected: no delegation can reach an unmounted tool, so `true` would be false. The two causes of "no work will reach this" are not distinguished on the card because a person can act on neither differently; `configure` distinguishes them, because there the difference decides whether a write is possible.

**Index delegations in `sci_audit` so the roster need not scan.** The audit projection already folds `tool/call`, and adding `callId` and the call's `description` to the row would make `calls()` a table read. Rejected for now, but only for now: it is a change to a projection another package owns and to a stored schema, it needs a `rebuild` to take effect on existing logs, and the roster's cost is linear in a corpus a research deployment keeps small. The README states the cost as deferred work rather than hiding it.

**Add `reasoningEffort` to the roster and the patch.** The spec asked for a three-way depth selector. Rejected on evidence: `AgentOptions` carries `provider`/`model`/`maxTokens` only (`packages/core/agent/src/runtime-types.ts:24-31`), and `agent-loop` seeds a child request from exactly those three, restoring an effort only from a persisted header whose route already matches (`packages/core/agent-loop/src/agent.ts:437-455`). A stored effort would be read by nobody, so the field is absent from `RosterAgent` and `AgentPatch`, and `models()` declares no `reasoningEfforts` — which is what keeps the configuration page from rendering the selector at all. The full evidence is in `2026-08-30-subagent-runtime-settings.md`.

## Acceptance criteria

- `roster()` answers six rows in `PERSONA_NAMES` order whose `toolName` is `subagentToolName(persona)`, with card copy from the shipped documents' `display` blocks and no fallback to English.
- A `configure` write of `{ permissions: { web: false } }` leaves `ctx.settings.get('subagent-<persona>')` carrying `toolFilter.deny` with the three web tool names, and the next delegation through that tool sends them to `ctx.tools.restrict()`.
- Turning every permission back on removes `toolFilter.deny` from the user layer while leaving a denial the mapping does not own standing.
- `roster()` and `configure()` succeed with no session open, having ensured the preset's standing mount.
- `monthCalls` equals the count of this month's `sci_audit` `tool-call` rows for that tool name, and `avgDurationMs` the mean of the matched children's own turn times; both are absent rather than zero when nothing reported them.
- `models()` drops a provider advertising nothing and reports a provider whose lookup threw, without failing.
- `packages/sci/sci-agents/src` stays at 100% per-file coverage; `tsc -b tsconfig.host.json`, `oxlint`, and the doc-sync gates pass.

## Risks

- **Every roster and log read scans the whole session corpus.** `listSessions()` then `readSession()` for each, six times over for the roster's six personas. A deployment with a large corpus will feel it; the mitigation is the deferred audit index above, and the read is a person's gesture rather than anything on a model's path.
- **A call is joined to its child by creation label.** Two delegations to the same persona with identical `description` text in one session are ambiguous; they are resolved by consumption in log order, which is right on average and wrong for the individual row when the two children took very different times. The charter narrowing prevents a sibling persona from lending its timing, but nothing distinguishes two identical labels.
- **`agentsRoot` is configured twice.** This package and `dsh-sci-profile` each take one, and a deployment that changes one without the other draws cards for charters the mounted rows do not carry. The mount reads the tree eagerly, so a directory that is not a complete roster fails at load rather than at the first read — but two VALID trees that differ are not detectable here.
- **The service reads `sciAudit` optionally and falls back silently.** A deployment that composes the roster but not the audit projection reports a `monthCalls` derived from logs, which excludes sessions whose logs the corpus can no longer serve. The two numbers can differ, and the card does not say which one it is showing.
