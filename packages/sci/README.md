# sci/ — science-research agent profile

English | [中文](README.zh.md)

The `sci` product layer: a research-agent profile that reproduces the behaviour of a studied prompt-only platform (archived under `ClawsGO-System/`, outside this repository) on typed dsh extension points. Every rule the original enforced through server-side prompt assembly lands here as a prompt section, a `tools/pre-execute` gate, a session event, or a sandbox permission. Design and package contracts: `ClawsGO-System/09-Target-Architecture/`.

| Package | Role | ctx key / surface |
|---|---|---|
| [`sci-prompt/`](sci-prompt/README.md) | Eight prompt chapters and four standing reminders, with a reminder→chapter invariant. | `ctx.systemPrompt` |
| [`sci-manifest/`](sci-manifest/README.md) | Pure validators for `.paper` / `.sciplot` / `.canvas` manifests and their owned-field diff. | library |
| [`sci-skills/`](sci-skills/README.md) | Bundled skill tree, content-hash sync into the sandbox, lifecycle curation, listing provider. | `ctx.skills` provider |
| [`sci-workspace/`](sci-workspace/README.md) | Path policy and shell pre-screen on `tools/pre-execute`: delivery workspace, append-only `versions/`, manifest ownership. | `tools/pre-execute` |
| [`sci-deliver/`](sci-deliver/README.md) | `deliver_files` tool and the in-sandbox `sci deliver` spool, one validation chain. | `ctx.tools` |
| [`camel-runtime/`](camel-runtime/README.md) | Persistent project variants: `create_variant` / `run_in_variant` / `collect_variant` / `delete_variant` / `list_variants` over AgentENV microVMs, capped per workspace, registry in `.sci/variants/`. | `ctx.tools`, `ctx.e2b` consumer |
| [`sci-memory/`](sci-memory/README.md) | Memory nodes with `originSessionId`, write-timing projection, recall RPC. | `tools/post-execute`, RPC |
| [`sci-plan/`](sci-plan/README.md) | `declare_research_plan` tool and the `sci/plan-declared` event. | `ctx.tools` |
| [`sci-guard/`](sci-guard/README.md) | Irreversible-action classifier: unsigned binaries, egress, credentials, destructive deletes → approval. | `tools/pre-execute` |
| [`sci-audit/`](sci-audit/README.md) | Session-log projection into six audit tables; rebuildable. | `ctx.storageDomain` |
| [`sci-tier/`](sci-tier/README.md) | The two tiers, shown as `单体 / Solo` and `蜂群 / Swarm`, plus the task-resolved `自动 / Auto` composition: tier section, fan-out guard, resolution lock, declare-before-fan-out latch, upgrade suggestion, fork RPC. | `ctx.tools.guard`, `tools/pre-execute`, RPC |
| [`sci-remote-hosts/`](sci-remote-hosts/README.md) | User SSH hosts as a managed block in the sandbox `~/.ssh/config`. | RPC |
| [`sci-profile/`](sci-profile/README.md) | The `dsh-sci` bundle: profile patch layer, two tier presets, six personas, runnable example, snapshots. | profile |

The Dormice sandbox provider lives beside the other remote-runtime providers at [`../e2b/dormice/`](../e2b/dormice/README.md).
