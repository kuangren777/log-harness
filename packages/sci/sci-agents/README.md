# sci-agents — the persona roster, its live configuration, and its delegation log

English | [中文](README.zh.md)

Replaces the studied platform's *Agents* page, where "训练新智能体" was a button over a roster table that nothing enforced (`ClawsGO-System/09-Target-Architecture/04-persistence-model.md`). Here a persona is not a row in a table: it is a MOUNTED `@deepseek-ai/dsh-tool-subagent` instance named `subagent_<persona>`, whose charter reaches the child through the provider and whose availability, base model, and tool scoping live in that instance's settings section. This package owns no state of its own. It reads the persona documents `@deepseek-ai/dsh-sci-profile` ships, the settings sections those instances registered, the model directory `ctx.llm` publishes, and the session logs the corpus keeps — and it writes exactly one thing, the settings section that the delegation tool re-reads on its next execution.

That is also why there is no "train a new agent" endpoint. A seventh persona needs a seventh mounted row, and rows come from a preset composition file, not from a click.

## Configuration

```yaml
- name: '@deepseek-ai/dsh-sci-agents'
  config:
    preset: sci-cluster
```

| Field | Default | Meaning |
|---|---|---|
| `preset` | `sci-cluster` | Preset id whose composition mounts the six `subagent_<persona>` rows |
| `agentsRoot` | the tree bundled in `dsh-sci-profile` | Absolute path of the persona charter directory |
| `webTools` | `web_search`, `web_fetch`, `literature_search` | Tool names the `web` switch withholds |
| `codeTools` | `bash`, `write`, `edit`, `univer_execute` | Tool names the `code` switch withholds |
| `libraryTools` | `library_add`, `citations_add` | Tool names the `writeLibrary` switch withholds |

The three tool lists are configuration rather than constants for the same reason `dsh-sci-audit`'s `webToolNames` is: tool registration is a composition choice, and a deployment may rename or replace any of them. `agentsRoot` must match the `dsh-sci-profile` row's, or the roster would draw cards for charters the mounted rows do not carry.

## The four endpoints

`sci.agents.roster`, `configure`, `calls`, and `models` are Typert Remote endpoints under the `sci.agents` namespace.

`roster()` answers the six personas in `PERSONA_NAMES` order. Card copy — the name, the one-line role, the description — comes from each document's `display` frontmatter block, falling back to the charter's own English `name` and `summary` when a deployment's tree declares none. Availability, the pinned model route, and the permission switches come from the settings section `subagent-<persona>`; the stats come from the log.

`configure({ persona, patch })` writes availability, the base model route, or the three permission switches into that same section. The write is path-addressed rather than a merge patch, because turning every permission back on REMOVES the deny list, which a merge cannot express.

`calls({ persona, limit })` answers that persona's delegations, newest first, read out of the delegating sessions' logs.

`models()` answers the base models this deployment can route a child to, read from `ctx.llm` — the same directory `sessions.models` serves the session model picker from — so a provider a deployment added is offered here the moment it registers. A provider whose catalog lookup fails is reported in `failures` instead of failing the read.

### Ensuring the roster is composed

The settings sections belong to the mounted `tool-subagent` rows, and a preset is mounted once per process by the first session that joins it. A roster page opened before any session exists would therefore read six unregistered namespaces. `roster` and `configure` call `ctx.agentPresets.standingKeyFor(preset)` first, which ensures that standing mount without starting an agent, a session, or a turn.

A persona the deployment's composition mounts no row for reports `enabled: false`. The two causes — an operator switched it off, and the composition never carried it — are deliberately not distinguished on the card, because the only fact a person can act on is that no delegation will reach it. `configure` on such a persona fails loudly instead, naming the preset.

## Permissions are the deny list

The three switches are not stored. `toolFilter.deny` is, because that is the list `tool-subagent` sends with every start request and `ctx.tools.restrict()` applies at child creation — a denied tool is absent from the child's prompt AND refuses to execute. A stored switch would be a second truth that a composition-level denial could silently contradict.

| Switch | Denies |
|---|---|
| `web` | `web_search`, `web_fetch`, `literature_search` |
| `code` | `bash`, `write`, `edit`, `univer_execute` |
| `writeLibrary` | `library_add`, `citations_add` |

A switch reads `false` as soon as ANY tool of its group is denied, not only when all of them are: a child that lost `web_search` but kept `web_fetch` does not have the web permission, and reporting it as granted would describe a capability the child does not have. A write touches only the names this mapping owns, so a denial written by something else survives it.

## Where the numbers come from

Nothing on a card is estimated. `monthCalls` is the count of `sci_audit` rows with `kind: 'tool-call'` and this persona's `toolName` since the first instant of the current month; a deployment that composes no `sciAudit` falls back to counting the `tool/call` records the same scan just read.

`durationMs` is the CHILD's own turn time, folded from its log with `@deepseek-ai/dsh-subagent`'s `subagentTiming` projection — deliberately not the parent's call-to-result interval, which for a `continuable` delegation is milliseconds while the child works for minutes. A call is joined to its child by the creation label the two share (`tool/call.arguments.description` becomes the descriptor's `label`), narrowed to children carrying this persona's charter, and each child is consumed once so two calls with the same label do not both claim the first.

`outputTokens` and `monthTokens` appear only when a settlement carried `meta.usage.outputTokens`. Nothing in this repository attaches one today, so the column is normally absent rather than zero.

## Model Experience

None, as this package registers no tool, prompt section, or session event: every endpoint is called from the browser's agent view on a person's gesture, and the one thing it writes — a delegation tool's settings section — reaches the model only later, as that tool's own availability and tool scoping on the next delegation.

#### KV Cache effect

None directly, and one indirect effect worth stating. Nothing this package writes enters prompt assembly, so no prefix it owns can move. But a `configure` write that changes a persona's `toolFilter` changes the CHILD's tool catalog on its next delegation, which invalidates that child's prefix — never the parent's, whose own catalog is untouched, and never retroactively for a child already running.

## Known Limitations and Deferred Work

- **Reasoning depth is not offered.** `AgentOptions` (`packages/core/agent/src/runtime-types.ts:24-31`) carries `provider`, `model`, and `maxTokens` only, and `agent-loop` seeds a child request from exactly those three, restoring a `reasoningEffort` only from the persisted header of a session whose route already matches (`packages/core/agent-loop/src/agent.ts:437-455`). A stored effort would be read by nobody, so neither `roster` nor `configure` carries the field and `models` declares no `reasoningEfforts` — the configuration page renders no depth selector rather than one wired to nothing. See the Agent Note `2026-08-30-subagent-runtime-settings.md`.
- **Every read scans the whole corpus.** `roster` and `calls` list every session and read every log, because the audit projection records that a tool was called but not the `callId` or the arguments it was called with, and the child timings live in the children's own logs. The cost is linear in the corpus and paid per call; a projection that indexed delegations by tool name would remove it, and belongs in `dsh-sci-audit` rather than here.
- **A partial composition-level denial reads as a switch that will not turn on.** The entry's `toolFilter.deny` is a floor the settings layer cannot lift, so a preset that denies one tool of a group leaves that switch off however the user sets it. No shipped charter declares `tools.deny`, so this is reachable only through a deployment's own preset.
- **No session event records a configuration write.** Configuring a persona has no session and no Agent behind it, so `sci-audit` cannot show when a persona was switched off; the settings seam's own commit record is the only trace.
- **The generated Remote client is not registered.** `pnpm run build` emits `lib/typert.host.*` and `lib/typert.remote-client.*` from the `./typert` and `./remote` exports, but adding this package to `packages/api/remotes/src/client/index.ts` is a cross-package change the profile assembly owns.
