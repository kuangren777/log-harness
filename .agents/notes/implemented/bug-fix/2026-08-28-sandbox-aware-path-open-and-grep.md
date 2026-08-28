# Agent Note: Path open and ripgrep respect where the deployment actually runs

Status: implemented

English | [中文](2026-08-28-sandbox-aware-path-open-and-grep.zh.md)

## Problem

The sci deployment runs `dsh` in a container with no desktop and executes every tool call in a separate Dormice sandbox through the subprocess seam. Two surfaces still assumed the single-machine deployment they were written for, and one production session hit both.

A path click in the conversation answered `path open failed: spawn xdg-open ENOENT`. `packages/client/ui-conversation/src/client/apply.ts` handed the resolved path to `workspaces.openPath` unconditionally, so the click's only possible outcome was an RPC that cannot succeed where no desktop exists. `host.describe` already publishes `canOpenPath` and the connection already knows whether the page authority is loopback; `ui-deliverables/src/client/ProducedFiles.tsx` reads both for its show-in-folder control, but the opener every path click funnels through read neither.

The `grep` tool failed with `grep search failed (exit 127): /usr/bin/env: '/opt/dsh/node_modules/@vscode/ripgrep/bin/rg' …`. `search-core.ts` resolved the argv leader from the harness-side `@vscode/ripgrep` package and handed that absolute path to the subprocess seam, which executes it inside the sandbox — where that path does not exist. The packaged binary is correct exactly when `ctx.subprocess` runs commands in this process's own filesystem, and nothing let a deployment say otherwise. The module even documented exit 127 as impossible, on the reasoning that the tools interpose no shell; a remote provider's exec wrapper is the case that reasoning missed.

The [file-open-in-OS decision](../feature/2026-07-28-tool-call-file-open-in-os.md) owns the link gesture and the Host handoff, and the [tool-row file-open-failure decision](2026-08-18-tool-row-file-open-failure.md) owns the refusal dialog. This note owns only the capability gate in front of both, plus the ripgrep command.

## Decision

**Path open is gated on the pair that decides whether a native opener exists.** The chat view's injected `openFile` calls `workspaces.openPath` only when the Host published `canOpenPath` and `connection.isLoopback` — the same pair `ProducedFiles` gates its folder control with, because over a remote page an "open" would act on the operator's desktop rather than the reader's. Otherwise the resolved path goes to the clipboard through `writeClipboard` and one composer notice reports that, routed to the clicked session through `inputHub.shell(sessionId).notify()`. The promise fulfills in that branch: there is no Host failure for the chat view to offer a retry on, so the refusal dialog stays reserved for a Host that tried and refused.

The gate lives on the one inject rather than on each clickable surface. `apply.ts:402` is the only caller of `workspaces.openPath` in any client package — tool-row path clicks, produced-file chips, and closing-message mentions all reach the Host through it (`packages/client/ui-tool/tests/toolview-slot.client.spec.tsx` pins that route) — so gating it covers every path click at one place and keeps the capability question out of presentation components.

**The ripgrep command is a validated config field.** `tool-fs-search` gains `rgPath`, used verbatim as the argv leader; omitted, behaviour is unchanged and the packaged binary is resolved as before. It is passed through with no host-side existence probe, because the deployment that needs it is exactly the one whose ripgrep this process cannot stat. Both sci presets set `rgPath: rg` and the sci sandbox image installs Ubuntu's `ripgrep`, so the seam resolves it on the sandbox PATH.

`runRipgrep`'s four trailing scalars became one `RipgrepRunLimits` object that both tools' `*ToolCaps` extend, so a cap reaches the spawn by being a cap, not by being copied into a positional argument.

Every launch failure now names the command tried and the remedy: a spawn-creation throw, a rejected `handle.done`, an unresolvable packaged binary, and exit 127. The code stays `SEARCH_FAILED` in all four — the failure is machine-routable as one kind, and only the message needs to distinguish them.

## Alternatives considered

- **Render the path as plain text where it cannot be opened.** It hides a real affordance instead of degrading it, and every clickable surface would need the capability fact to decide how to render. The copy keeps the reader's gesture useful and keeps the decision in one inject.
- **Let `openPath` fail and lean on the existing refusal dialog.** The dialog is the right surface for a Host that tried and refused; a deployment with no desktop refuses every path click by construction, so the dialog would be a permanent modal reporting an unfixable condition.
- **Probe `rgPath` at load, or absolutize it.** Both assume the harness can see the file. In the sandbox deployment it cannot, and a probe would reject the only correct configuration. Load-time validation therefore checks the field is non-blank and nothing more.
- **Detect the sandbox seam and switch the argv leader automatically.** The tools would have to know which subprocess provider is mounted and what is installed on its far side. `rgPath` states the fact where the deployment already states its other deployment-varying choices.
- **Ship `rg` in the sandbox image without the config field.** The argv leader would still be the harness path. The image change and the config field are both required, and the image comment says so.

## Consequences

A deployment without a desktop opener no longer produces a dead click; readers on remote pages get the path instead of an open that would land on the wrong machine. Loopback deployments with a real opener are unchanged.

The two `SEARCH_FAILED` launch messages grew a remedy sentence, so a `grep` failure in a sandbox deployment says what to configure instead of exposing a path that does not exist on the machine the search ran on.

`runRipgrep`'s signature changed. Being pre-release, both call sites and the two direct unit callers moved with it rather than gaining an overload.

The sci sandbox image must be rebuilt for `rgPath: rg` to resolve; the preset row and the image install are one change, and a preset that sets `rgPath` against an image without ripgrep fails with the exit-127 message naming `rg`.

## Testing

`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` covers the gate from both sides: `canOpenPath: true` plus loopback still issues the `openPath` RPC and still rejects on a Host refusal, while all three non-openable postures (Host publishes no opener, description not yet arrived, page not loopback) issue no RPC, write the resolved path to a stubbed `navigator.clipboard`, and leave one composer notice carrying that path — `level: 'error'` when the clipboard write is refused.

The two `packages/client/ui-tool` specs that mount the real conversation apply to assert the click route (`toolview-slot.client.spec.tsx`, `chat-code-subcalls.client.spec.tsx`) now stub the openable-Host posture, because the RPC they assert is what the gate admits; their bash-summary cases still prove those clicks open nothing.

`packages/fs/tool-fs-search/tests/tools.spec.ts` pins the configured `rgPath` as argv[0] for both tools (bare and absolute), the packaged binary as argv[0] when the field is absent, a blank value rejected at load, and the message content for exit 127 with and without a configured command and for a spawn rejection. `packages/fs/tool-fs-search/tests/rg-path.spec.ts` adds the packaged-resolution-failure message and proves `resolveRgCommand` never touches `@vscode/ripgrep` once a command is configured.
