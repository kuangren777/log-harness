# sci-profile — the `dsh-sci` bundle, the two tier presets, and the six persona charters

English | [中文](README.zh.md)

Replaces the studied platform's fixed, unnamed composition: there the science agent was one deployment with one tool set, the two tiers were a reminder injected into every turn, and the six personas existed only as prose in a Workflow script (`ClawsGO-System/09-Target-Architecture/05-tier-model.md`). Three things changed. The tiers are compositions rather than requests — `sci-balanced` mounts no fan-out tool at all, so the refusal is the absence of the tool plus a deny-only guard, not a sentence the model may talk itself out of. The profile is assembled from three named patch layers a reader can diff (`dsh-base`, `dsh-web-app`, `dsh-sci`), so what a science deployment adds to the shared harness is one file. And the personas are six reviewed documents in `config/agents/` that reach the model as one prompt section, rather than six paragraphs retyped into each orchestration script.

## What is in here

| Artifact | Path | Consumed by |
|---|---|---|
| Bundle patch layer | `cordis.patch.yml` | `dsh --profile sci`, as the third layer over `dsh-base` + `dsh-web-app` |
| Balanced preset, shown as `单体 / Solo` | `config/agent-presets/sci-balanced/` | `dsh-agent-presets`, once per process, joined per session |
| Cluster preset, shown as `蜂群 / Swarm` | `config/agent-presets/sci-cluster/` | the same roster |
| Persona charters | `config/agents/*.md` | the plugin below, as one system-prompt section |
| Persona roster plugin | `src/index.ts` | the `sci-cluster` preset only |

`dsh-web-app` is a layer rather than an alternative: `storageDomain`, `session-query-sqlite`, and the browser roster live there, and the audit projection, the memory index, and the tier-upgrade button all need them. It has also already moved the whole agent plane behind agent presets, which is what makes the two preset directories the only per-agent composition this profile has.

## The plane split

The criterion is the one the web layer states, and every row in the patch and in the presets follows it: a Service other rows resolve, a registry keyed by session or agent, and any row that INJECTS a service belong to the host plane; the model-facing tools, the tier section, and the delivery tool are what one agent contributes.

That puts `sci-prompt`, `sci-skills`, `sci-workspace`, `sci-guard`, `sci-credit`, `sci-memory`, `sci-audit`, `sci-remote-hosts`, `sci-tier/fork`, and `office-univer` in `cordis.patch.yml`, and `sci-tier`, `sci-tier/suggest`, `sci-plan`, `sci-deliver`, `office-univer/tools`, and the delegation tools in the presets, with `camel-runtime` (the `fork_workspace` engine over `ctx.e2b` and AgentENV) in the cluster preset only, its row gated on `AENV_API_KEY` so a deployment without an AgentENV server mounts no fork tool rather than failing every cluster session at load. `office-univer` follows the split inside one package: the host row runs the Univer Gateway, publishes the `univer` service, and serves the Viewer with `tools: false` and `skills: false` — the `univer_*` skills are the protected built-in tier the skill vault serves through `sci-skills`, so the package's bundled copies stay unpublished — and each preset mounts `@deepseek-ai/dsh-office-univer/tools` over that service, withholding `univer_screenshot` and `univer_lint` because the dsh image ships no headless Chromium. `sci-tier/fork` is host-plane for the same reason as the subagent registry: the package entry is a function plugin BOTH presets mount, and a service published from there would collide the moment the second preset mounted it. `sci-credit` is host-plane because it meters the `llm/stream` waterfall for every agent in the process, and its `vmToken` has no default: a deployment with no gate deletes that row rather than blanking the token.

The layer also swaps the workspace directory picker, for the same reason it moved `fs` and `subprocess`: with both seams inside Dormice, a host path an `-auto`-resolved backend offers is a session cwd every command then fails on. `directory-picker` is disabled and `@deepseek-ai/dsh-host-directory-picker-e2b` is inserted with its browser face `@deepseek-ai/dsh-client-ui-directory-picker-browse` — both faces, because a patch cannot rewrite a row's `name` and `-auto` mounts the client surface itself. It is the same disable-plus-insert pair as `apps/web/tests/pin-browse-picker.overlay.yml`.

A service row inside a preset must sit in a group carrying an `isolate` realm or `dsh-agent-presets` rejects it at mount, which is why the `compaction` and `delegation` groups carry one and nothing else in either file publishes a service.

## The two tiers

`sci-balanced` is the default, because a swarm is compute the user chooses rather than receives. It mounts no fan-out tool, and its `sci-tier` row lists the fan-out names twice over: `ctx.tools.guard()` denies them at call time, and the same list is checked against the mounted catalog at LOAD time, so a composition that states one tier and can execute another throws instead of running. `suggest_tier_upgrade` is the tier's one legitimate exit and is mounted only here.

`sci-cluster` adds `declare_research_plan`, the delegation tools behind an entry-local `workflowEngine` realm, and the persona roster. `declare_research_plan` is deliberately absent from its `fanoutTools`: it is the token's source, and gating it would make the first declaration unreachable. `tool-subagent-fork`, the codex and claude-code providers, and `tool-ralph` are absent by tier policy rather than by plane — a research swarm fans out to fresh children from a declared plan, and each extra fan-out name is one more path the latch has to cover.

The two are the only presets this profile offers. The patch's `agent-presets` row declares `config/agent-presets/` as the roster's one configured root, resolved through the launcher's `dshBundlePath` because only a resolver that can find this package knows the absolute path; `@deepseek-ai/dsh-sci-profile` exports the same directory as `BUNDLED_PRESET_ROOT`. A launcher appends its own shipped root only for a composition that declares none (`apps/cli/src/profile-boot.ts::resolvePresetRootPatch`), so `dsh`'s four general-purpose presets — which compose tools this profile disabled and a sandbox it does not run in — stay off the picker. `includeUserRoot` is left at its default, so `$DSH_HOME/.agent-presets` is still scanned, after this root and with `user` trust.

## The personas

This harness has no file-discovered agent definitions, and `@deepseek-ai/dsh-tool-subagent` binds one persona per MOUNTED row rather than per call. A persona is therefore what the orchestrating thread opens a child prompt with, which makes the roster model-facing text rather than a composition. `loadPersonas` reads `config/agents/*.md` at load, refuses anything that is not exactly the six names `@deepseek-ai/dsh-sci-plan` declares, and lists them in `PERSONA_NAMES` order so the assembled section is byte-identical across filesystems.

`plotter` and `deliverer` carry exclusive charters — only `plotter` runs the sciplot render path, only `deliverer` copies into the delivery workspace — and the other four say so from the other side. Those are instructions, not enforcement: the enforcement is `sci-workspace` refusing a write to a platform-owned manifest field and `sci-deliver` re-validating every delivery whatever submitted it.

## Model Experience

### Prompt section `Research personas`

#### What the model sees

One section at assembly order 155, between `Agent-cluster orchestration` (150) and `Irreversible actions` (165). It opens with the instruction to copy a charter verbatim into each child prompt, then lists all six personas as `### <name> (selected by the \`<icon>\` icon)` or `(no icon selects it)`, each followed by its one-sentence summary and its full charter. The section is registered only by the `sci-cluster` preset: at the balanced tier the model never sees it, because it cannot start the agents it would describe.

#### Token effect

Roughly 700 tokens, once per request, for the whole six-persona roster. It is fixed for a deployment: the charters are files, not a function of session state, so the cost does not grow with the conversation.

#### KV Cache effect

Prefix-stable. The listing order is `PERSONA_NAMES`, not the directory's, so the same six documents assemble the same bytes on every machine and every boot; editing a charter or repointing `agentsRoot` invalidates the prefix once, at the next request.

## Known Limitations and Deferred Work

- **A hand-seeded copy of a shipped preset is dead weight, silently.** `$DSH_HOME/.agent-presets` is scanned after the declared root and discovery is first-root-wins per id, so a `sci-balanced` or `sci-cluster` directory seeded there is shadowed: the picker lists one entry, from this package, and edits to the seeded copy do nothing. Nothing reports the shadowing — a deployment that seeded such copies before the roster declared its own root should delete them.
- **A persona is a prompt, not a composition.** Nothing verifies that a child actually ran under the charter its plan icon selected: `declare_research_plan` records the persona per step, and the orchestrating thread is trusted to copy the matching text. Reconciling the declared plan against the children that ran is `@deepseek-ai/dsh-sci-audit`'s question, not this package's.
- **The workspace picker can no longer reach a host path at all.** Replacing `directory-picker` with the sandbox backend is deliberate, but it is a swap rather than an addition: a deployment that genuinely wants to open a directory on the container running the harness has no row offering one, and would have to re-insert a host backend under a second id. Nothing in the profile reports the absence.
- **The presets restate their shared rows rather than including them.** `dsh-agent-presets` discovers whole directories, so `sci-cluster` repeats every row `sci-balanced` has. A row changed in one and forgotten in the other is caught only by the composition tests here, not by the loader.
