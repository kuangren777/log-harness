# Agent Note: Bootstrap the sandbox home skeleton from dsh-sci-workspace

Status: implemented

English | [中文](2026-08-28-sci-workspace-bootstraps-sandbox-skeleton.zh.md)

## Problem

The sci sandbox image ships `/usr/local/bin/sci-init`, an idempotent script that lays down `/home/user/sci/{projects,memory,references,skills,.sci/spool/{pending,done,failed}}` from a skeleton copy kept outside the home. It exists because the image cannot bake that tree: the sandbox daemon mounts `/home/user` as a persistent volume, and the mount masks everything the image placed under that path. Nothing in the harness ever ran it — `grep -rn sci-init packages/` found no caller — so on a fresh VM the tree existed only after an operator ran the script by hand. Until then every call under it failed as a missing path: `workspace.create` and the picker's `createDirectory` reported `FileNotFoundError: [not_found] no such file: /home/user/sci/projects`, which is how the defect surfaced in production.

## Decision

`@deepseek-ai/dsh-sci-workspace` runs it. The package already owns `projectRoot`, so it owns making that path exist, and `src/bootstrap.ts` holds the run: `parseBootstrapArgv` turns the configured `bootstrapCommand` into argv, and `runSkeletonBootstrap` spawns it through the subprocess seam and reports what happened.

The seam is read with `ctx.inject(['subprocess'], …)` rather than added to the plugin's own `inject`. The path table is complete without a subprocess provider, so a Host-only composition must keep the gate and skip the bootstrap; reading the seam reactively also covers the composition where the sandbox-backed provider mounts after this plugin. A module-scoped flag keeps it to one run per mounted plugin, so a provider that unloads and returns does not repeat a bootstrap this fiber already did.

`apply` does not await the run. The skeleton is missing either way until the command finishes, and a slow or unreachable sandbox must not hold up the profile's boot. Exit zero logs the command's last non-empty stdout line at info (`sci-init: /home/user/sci ready (…)`); a non-zero exit, a signal death, a spawn that throws, a `done` that rejects, and a passed deadline each become one `ctx.logger.warn` naming `projectRoot` and carrying the stderr tail. The deadline is `runSkeletonBootstrap`'s own `AbortController` on the spawn spec, so the seam terminates the process tree instead of the attempt hanging on the sandbox.

Two config fields carry it: `bootstrapCommand` (default `sci-init`, blank disables) and `bootstrapTimeoutMs` (default 30000). Both defaults describe the shipped image, so `packages/sci/sci-profile/cordis.patch.yml` needs no new row. The command runs with cwd `/`: the tree it creates cannot be its own working directory, and `sci-init` reads its target from the sandbox environment.

## Alternatives considered

**Create the skeleton in the sandbox daemon at acquire.** Rejected as the wrong layer. The daemon manages sandboxes for every profile and knows nothing about a science home; the layout is this package's config, and baking it into the daemon would make one profile's directory contract a platform feature.

**Bake the skeleton into the sandbox image.** Impossible, and it is why `sci-init` exists: `/home/user` is a mounted volume, so anything the image writes under it is masked the moment the volume appears.

**Keep having operations run it by hand.** This is the state the defect describes. Rejected because the sandbox is created on demand per tenant, so "run it once after deploy" is not a step anyone can complete — a sandbox created next week needs it too, and the failure it leaves is a `not found` on the tenant's first action.

**Run it through the shell seam instead.** Rejected because it picks a different execution world for one command: `ctx.subprocess` is the seam the package's other cross-world verb already uses, and the shell seam adds command-line quoting the argv spawn does not need.

**Fail the load when the bootstrap fails.** Rejected because it converts a recoverable, already-visible condition into a dead profile. A sandbox whose skeleton cannot be laid down still serves reads, memory, and the credit gate; the picker error remains the user-visible signal.

## Testing

`packages/sci/sci-workspace/tests/bootstrap.spec.ts` mounts the plugin over a scriptable `SubprocessRuntime` fake and asserts through it: the spawn spec (argv, cwd `/`, collect-mode stdio, grace, live signal) and the info line for a zero exit; the run starting only when the seam appears, without the mounting load waiting for it; whitespace-split argv for a command with arguments; no spawn and no log for a blank command; no spawn and no log with no seam composed; one spawn across a provider that unloads and remounts; and one warning each for a non-zero exit with a stderr tail, a signal death, an exit with no collected output, a spawn that throws, a rejected `done`, and a command that outlives `bootstrapTimeoutMs` (whose handle is terminated). `pnpm exec vitest run packages/sci/sci-workspace --coverage` keeps the package at per-file 100%.

## Consequences

A fresh sci VM lays its own home skeleton down at plugin load, so the first `workspace.create` finds `/home/user/sci/projects`. `dsh-sci-workspace` gains a type-only peer dependency on `@deepseek-ai/dsh-subprocess` for the `ctx.inject(['subprocess'], …)` declaration merge; the service stays optional, and a composition without one keeps the whole path table. A deployment that provisions the home elsewhere sets `bootstrapCommand: ''`. The bootstrap is not a substitute for the image's own idempotence: it runs on every mount, and `sci-init` leaving existing directories alone is what makes that safe.
