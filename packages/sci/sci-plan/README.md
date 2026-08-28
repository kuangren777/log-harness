# sci-plan — `declare_research_plan`, the validated agent DAG, and the fan-out authorization for the `sci` profile

English | [中文](README.zh.md)

Replaces the studied platform's `mcp__clawsgo__declare_workflow_plan` MCP tool (`ClawsGO-System/02-MCP/clawsgo-server.md` §3), whose parameter schema this package reproduces verbatim because a user interface keys its progress-card artwork off the five icons. Three things changed. There the plan was accepted as written — a repeated agent id, an edge naming an agent that was never declared, or a cycle all produced a drawn card and no complaint — and here `validatePlan` refuses all of them in one pass, naming the offending agent index, id, or edge. There the plan existed only as cards in the user's browser and the model read nothing back; here the accepted plan is echoed in run order, so what the model committed to is in the transcript. And there "declare before you fan out" was a discipline stated in the system prompt; here the declaration is the logged `sci/plan-declared` event that `@deepseek-ai/dsh-sci-tier`'s G1 gate spends on the next `workflow` or `subagent` call (`ClawsGO-System/09-Target-Architecture/05-tier-model.md`).

## Surfaces

| Surface | Where | Config |
|---|---|---|
| Tool `declare_research_plan` | `ctx.tools.register()`, render intent `generic` | `maxAgents` (default `16`) |
| Session event `sci/plan-declared` | appended to the declaring agent's session | — |
| `ICON_PERSONA` | plain export, read by `sci-tier` when it spawns the fan-out | — |

## What a plan must satisfy

`validatePlan(input)` is pure and reports every violation at once, because one refused call has to be enough for the model to write a correct plan on the next one:

1. Every text field is trimmed, and edges are matched against the trimmed ids, so surrounding whitespace never becomes a dangling reference.
2. `id`, `name`, and `task` are non-empty, ids are unique, and the plan declares at least one agent.
3. Each edge holds exactly two endpoints, does not point an agent at itself, and names declared agents on both ends.
4. Only once no field or reference error remains does the cycle check run — a graph with an unresolvable endpoint has no meaningful cycle to report — and a cycle names every agent it traps.

`topologicalSort` is index-based Kahn ordering: ids were already resolved by `validatePlan`, so its only failure mode is a cycle. Ready nodes keep declaration order, which makes the run order reproducible from the log, and a dependency declared twice counts once rather than blocking its target forever.

## Identity and the fan-out gate

Each accepted declaration mints one `SciPlanId` (a `Branded<'SciPlanId'>` UUID) and appends `sci/plan-declared`. That event is **required-on-read** and carries no `ignorable` marker: a reader that skipped it would admit a fan-out the deployment refused, since `sci-tier` rebuilds its latch by replaying the log after a restart. `./invariant` asserts the matching relationship over the committed log — no two declarations in one session share a plan id, because a repeat hands the latch a token it has already spent.

`maxAgents` exists because the cluster width a deployment can actually run varies with its machine. A plan wider than the cap is refused at declaration, where the model still has the turn to narrow it, rather than accepted and then partly unrunnable.

## Icons and personas

`ICON_PERSONA` maps each of the five card icons to one of the six subagent personas the `sci` preset installs: `web` → `researcher`, `search` → `scout`, `security` → `adversary`, `code` → `writer`, `check` → `deliverer`. On the studied platform the icon was decoration and the persona was decided later by prose in the Workflow script; here the card a user sees and the agent definition that runs are the same choice, made once, at declaration.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`declare_research_plan` schema](../../../docs/tool-catalog.md#deepseek-aidsh-sci-plan): `agents[]` of `{ id, name, icon, task }` with `icon` enumerating `web | search | security | code | check`, and an optional `edges[]` of `[from, to]` pairs. The description names the persona each icon selects and states the obligation the gate enforces — one declaration authorizes one fan-out — because a model that learns that only from a denied `workflow` call has already lost a turn.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged; `maxAgents` does not appear in the description, so narrowing it does not invalidate the prefix.

### Tool-call history and result

#### What the model sees

An accepted call returns a summary line, the agents in run order with the persona each icon selected, and the dependency graph drawn as text (`installer → verifier`). A refused call returns every problem at once, each naming the agent index, id, or edge that caused it. The call renders as a `generic` card titled with the declared agent count. The `sci/plan-declared` event is log-only and never enters model history.

#### Token effect

The result is proportional to the plan: roughly one line per declared agent plus one per agent others wait on. A sixteen-agent plan costs a few hundred tokens once.

#### KV Cache effect

Append-only; a declaration adds a tool call and its result and disturbs no earlier prefix.

## Known Limitations and Deferred Work

- **Declaring is not enforcing.** This package records the authorization; the G1 gate that consumes it lives in `@deepseek-ai/dsh-sci-tier`, and nothing here refuses a fan-out. A profile that mounts `sci-plan` without `sci-tier` gets validated, logged plans and unconstrained fan-out.
- **Nothing reconciles the declared plan against the agents that actually ran.** The plan is what the model announced, not a record of the cluster; an agent declared and never spawned, or a subagent spawned under no declared id, is visible only to a reader comparing `sci/plan-declared` with the `tool-workflow/*` records — which is `@deepseek-ai/dsh-sci-audit`'s job, not this package's.
- **`plotter` is unreachable from any icon.** Figure work is not distinguishable at the card level — a plotting step reads as `code` to a user watching the plan — so the sixth persona is selected only from an agent's `task` text by the orchestrating thread. Adding a sixth icon would change a schema a user interface draws its artwork from.
- **The summary line counts declared dependencies, not distinct ones.** A pair declared twice is drawn once but counted twice in the header, because the count describes what the model wrote.
