# Agent Note: camel-runtime — a fork engine beside the workspace, not instead of it

Status: proposed

English | [中文](2026-08-28-camel-runtime-fork-engine.zh.md)

## Problem

The `sci` profile's cluster tier fans work out to subagents, but every subagent shares one Dormice sandbox: one filesystem, one set of running processes. A parameter sweep or a set of competing hypotheses that each want to mutate the workspace cannot run in parallel there without stepping on each other, and a risky transformation cannot be tried without first copying the workspace by hand.

A side-by-side measurement on the production host (`ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md`, 2026-08-28) showed AgentENV's Firecracker microVMs snapshot in ~1.4 s and resume a fork in ~80 ms with memory, processes, and files intact — a capability gVisor does not have — while Dormice remains the better owner of a long-lived workspace: idempotent acquisition by name, 3× lower idle memory, no memory image on disk, and a lifecycle that never deletes. Replacing one with the other would trade the workspace's durability for a compute feature, and require the gateway to rebuild the name→sandbox mapping AgentENV lacks.

## Proposal

Add `@deepseek-ai/dsh-camel-runtime` (`packages/sci/camel-runtime/`), a Consumer of `ctx.e2b` and `ctx.tools` that treats AgentENV strictly as a compute engine:

- The workspace stays in Dormice. The engine exports it once per call (`tar` over the command channel, bounded by `maxWorkspaceBytes`), seeds one microVM from a configured AgentENV template, snapshots it, and resumes one microVM per variant from the snapshot.
- Results flow one way. Each variant's stdout, stderr, exit code, and an optional collected directory are written into the real workspace under `<forksDir>/<forkId>/<variant>/`. Nothing else a variant did survives; every microVM and the snapshot are deleted in `finally`.
- The model sees one tool, `fork_workspace`, mounted only in the `sci-cluster` preset. Denial (variant count, name shape, duplicate names, a `collect` outside the workspace) happens in the executor, and a non-zero exit is a result rather than a failure so a sweep with one broken variant still reports the others.
- One event, `sci/fork-completed`, `ignorable: true`; the package invariant asserts a fork id never repeats within a session, since it names a result directory.
- The AgentENV key is read from `apiKey` or `AENV_API_KEY` in the cluster process and never forwarded into either sandbox, matching the Dormice provider's never-forward rule.

## Alternatives considered

- **Migrate the workspace to AgentENV.** Rejected in A2: 1–2 weeks to rebuild the deployment chain and gateway mapping, a privileged container with `/dev` mounted on the production host, ~600 MiB more resident memory, and a second persistence model — for latency gains a model-driven session cannot perceive.
- **Fork by `docker commit` inside Dormice.** Captures the filesystem layer only, not processes or memory, and Dormice exposes no such operation through its API.
- **A warm per-user snapshot on AgentENV.** Would skip the export and import but is a second durable copy of the workspace; deferred until a measured need.

## Acceptance criteria

- `fork_workspace` in the `sci-cluster` preset runs N variants from one AgentENV snapshot of the Dormice workspace and writes `stdout.txt`, `stderr.txt`, `exit-code`, and the collected directory under `<forksDir>/<forkId>/<variant>/`; the balanced preset has no such tool.
- Every microVM and the snapshot are deleted whether the fork succeeds or fails at export, seeding, snapshotting, or a variant's transport; a failed deletion never masks the fork's own error.
- Denials — no variants, over `maxVariants`, a malformed or duplicate name, a blank command, a budget outside `[1, maxCommandTimeoutSeconds]`, a `collect` outside the workspace — happen in the tool executor and name the rule broken.
- The AgentENV key never appears in any command environment on either sandbox.
- Package tests reach 100 % per-file coverage; one live run against the production AgentENV shows two variants with different collected results and an unchanged workspace.

## Risks

- **Workspace size.** The archive crosses the command channel as base64 and is buffered on both ends; `maxWorkspaceBytes` (64 MiB default) is the guard, and a data-heavy workspace needs `exclude` patterns until a streamed transfer replaces it.
- **Privileged sidecar on the production host.** `aenv-server` runs `--privileged` with `/dev` mounted, bound to loopback only; its API key lives in the cluster process environment. A compromise of the cluster process exposes the engine, not the workspace daemon's token.
- **Template drift.** The AgentENV template must carry the same toolchain as the Dormice image or a variant fails for a reason the model cannot see in the workspace; the deployment pins both to the same `sci-sandbox` tag.
- **Orphaned microVMs on a hard crash.** A killed harness process skips `finally`; AgentENV's own TTL (`sandboxTimeoutSeconds`, default 30 min) is the backstop.

## Consequences

- `fork_workspace` is the cluster tier's only isolated parallel-mutation primitive; subagents remain the primitive for parallel *reading* and *reasoning* over one workspace.
- The deployment gains one sidecar (`aenv-server`, loopback only) and one environment variable per cluster VM. The balanced tier is unchanged.
- Package tests cover the client, transfer, engine lifecycle (including cleanup on each failure path), tool text, Loader composition, and the invariant at 100 %; the live path was exercised once against the production AgentENV with two variants writing different files.
