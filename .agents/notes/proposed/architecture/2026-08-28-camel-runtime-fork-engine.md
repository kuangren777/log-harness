# Agent Note: camel-runtime — persistent project variants beside the workspace, not instead of it

Status: proposed

English | [中文](2026-08-28-camel-runtime-fork-engine.zh.md)

## Problem

The `sci` profile's cluster tier fans work out to subagents, but every subagent shares one Dormice sandbox: one filesystem, one set of running processes. A parameter sweep or a set of competing hypotheses that each want to mutate the workspace cannot run in parallel there without stepping on each other, and a risky transformation cannot be tried without first copying the workspace by hand.

A side-by-side measurement on the production host (`ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md`, 2026-08-28) showed AgentENV's Firecracker microVMs snapshot in ~1.4 s and resume a fork in ~80 ms with memory, processes, and files intact — a capability gVisor does not have — while Dormice remains the better owner of a long-lived workspace: idempotent acquisition by name, 3× lower idle memory, no memory image on disk, and a lifecycle that never deletes. Replacing one with the other would trade the workspace's durability for a compute feature, and require the gateway to rebuild the name→sandbox mapping AgentENV lacks.

## Proposal

Add `@deepseek-ai/dsh-camel-runtime` (`packages/sci/camel-runtime/`), a Consumer of `ctx.e2b` and `ctx.tools` that treats AgentENV strictly as a compute engine for **persistent variants**:

- A variant is a named slot holding one AgentENV microVM with a copy of **one project directory** of the Dormice workspace, not the whole workspace. `create_variant` archives the project (`tar` over the command channel, bounded by `maxProjectBytes`) into a microVM started from the configured template, or — with `from` — snapshots a sibling variant and resumes from that (files, processes, memory).
- Slots are bounded per workspace by `maxVariants`, a plan-dependent number the deployment sets per VM through `AENV_MAX_VARIANTS`; a full workspace is told to `delete_variant` before creating another. The slot table is `<variantsDir>/registry.json` in the workspace, so a new harness process finds the variants the last one left, and a corrupt table is refused rather than read as empty.
- Variants pause when idle (AgentENV's own TTL with `autoPause`) and resume on the next `run_in_variant` or `collect_variant` through `POST /sandboxes/{id}/connect`; `list_variants` reports `running`, `paused`, or `missing`.
- Results flow one way: `collect_variant` copies a project-relative directory into `<variantsDir>/<name>/collect/`; the real project files are never written by a variant. `delete_variant` kills the microVM, drops a fork's snapshot, and frees the slot.
- Five tools, mounted only in the `sci-cluster` preset; every denial (name shape, taken name, cap, missing project, a path outside the project, a gone sandbox) happens in the executor and names the rule and the remedy. Three ignorable events, `sci/variant-created` / `sci/variant-run` / `sci/variant-deleted`; the package invariant asserts a slot name is never created twice without a deletion in between.
- The AgentENV key is read from `apiKey` or `AENV_API_KEY` in the cluster process and never forwarded into either sandbox, matching the Dormice provider's never-forward rule.

## Alternatives considered

- **Migrate the workspace to AgentENV.** Rejected in A2: 1–2 weeks to rebuild the deployment chain and gateway mapping, a privileged container with `/dev` mounted on the production host, ~600 MiB more resident memory, and a second persistence model — for latency gains a model-driven session cannot perceive.
- **Fork by `docker commit` inside Dormice.** Captures the filesystem layer only, not processes or memory, and Dormice exposes no such operation through its API.
- **A warm per-user snapshot on AgentENV.** Would skip the export and import but is a second durable copy of the workspace; deferred until a measured need.
- **One-shot forks (`fork_workspace`: export, snapshot, N variants, collect, delete everything).** Built and verified first, then replaced: a one-shot cannot be inspected, extended, or forked again by the model, and it copied the whole workspace, so a user with several projects paid for all of them on every call. Persistent slots with an explicit cap are what the product asked for: "if a user has too many, they delete one and create another".

## Acceptance criteria

- In the `sci-cluster` preset, `create_variant` copies one project directory into a fresh AgentENV microVM (or forks a sibling with `from`), `run_in_variant` resumes it and runs from the project directory, `collect_variant` copies a project-relative directory into `<variantsDir>/<name>/collect/`, `delete_variant` kills the microVM and frees the slot, and `list_variants` reports `running` / `paused` / `missing`; the balanced preset has none of these.
- The `maxVariants` cap is enforced in the engine under the registry lock: the (N+1)th `create_variant` is refused naming the slots in use and `delete_variant`; after a deletion the same call succeeds.
- A failed seed (import error) kills the fresh microVM and records nothing; a failed fork drops its snapshot; a registry file that is not a version-1 table is refused, never read as empty.
- Denials — a malformed or taken name, the workspace itself as `project`, a project outside the workspace or missing, a blank command, a budget outside `[1, maxCommandTimeoutSeconds]`, a collect path outside the project, an unknown slot, a slot whose sandbox AgentENV forgot — happen in the tool executor and name the rule and the remedy.
- The AgentENV key never appears in any command environment on either sandbox.
- Package tests reach 100 % per-file coverage, the Loader composition test drives create → cap refusal → delete → create → run → collect → list against a local AgentENV, and one live run on the production AgentENV exercises the same path with a real project.

## Risks

- **Workspace size.** The archive crosses the command channel as base64 and is buffered on both ends; `maxWorkspaceBytes` (64 MiB default) is the guard, and a data-heavy workspace needs `exclude` patterns until a streamed transfer replaces it.
- **Privileged sidecar on the production host.** `aenv-server` runs `--privileged` with `/dev` mounted, bound to loopback only; its API key lives in the cluster process environment. A compromise of the cluster process exposes the engine, not the workspace daemon's token.
- **Template drift.** The AgentENV template must carry the same toolchain as the Dormice image or a variant fails for a reason the model cannot see in the workspace; the deployment pins both to the same `sci-sandbox` tag.
- **Orphaned microVMs.** A slot whose registry entry is lost (workspace restored from an older copy) leaves a paused microVM AgentENV keeps indefinitely; `aenv list` on the host is the audit until a reconciliation pass exists.
- **Slots are cheap to hold and easy to forget.** A paused variant costs disk (its memory image) rather than RAM, but the cap counts it; the model is told the slot count on every mutation so a full workspace is visible before it blocks.

## Consequences

- The variant tools are the cluster tier's only isolated mutation primitive; subagents remain the primitive for parallel *reading* and *reasoning* over one workspace.
- The deployment gains one sidecar (`aenv-server`, loopback only) and three environment variables per cluster VM (`AENV_API_KEY`, `AENV_ENDPOINT`, `AENV_MAX_VARIANTS`); the gate sets the cap per plan. The balanced tier is unchanged.
- Package tests cover the client, registry, transfer, engine lifecycle (cap, fork, cleanup on each failure path, missing sandboxes), tool text, Loader composition, and the invariant at 100 % per file; the live path is exercised against the production AgentENV.
