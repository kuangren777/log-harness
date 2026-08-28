# Agent Note: the directory picker browses the sandbox the tools run in

Status: implemented

English | [中文](2026-08-27-directory-picker-e2b.zh.md)

## Problem

A sci deployment runs dsh in a container while every tool executes inside a Dormice sandbox whose filesystem is separate: `ctx.e2b.cwd` is `/home/user/sci` there, and the container's own `HOME` is `/home/node`. The workspace directory picker mounted by `directory-picker-auto` is `dsh-host-directory-picker-browse`, which lists the **host process** filesystem — `homedir()` plus `node:fs` `opendir`. The operator therefore browsed the container, picked `/home/node`, and the session cwd became a path the sandbox does not have.

Every Bash call in that session then died with `subprocess-e2b: remote command exited before publishing its process-group id`, because E2B reports a nonexistent working directory as nothing but the wrapper's own immediate exit. The message named neither the working directory nor the reason, so the failure read as a sandbox transport fault rather than as a directory that does not exist.

## Decision

`@deepseek-ai/dsh-host-directory-picker-e2b` (`packages/e2b/directory-picker-e2b`) serves the seam's existing `browse` capability against the sandbox instead of the host: `home` is `ctx.e2b.cwd`, listing is one `files.list` per level, and creation is `files.makeDir` behind a parent probe that keeps the seam's non-recursive contract over E2B's recursive primitive. The capability kind is unchanged, so `dsh-client-ui-directory-picker-browse`, the apiproxy consumer, and the wire vocabulary are untouched — only the world being listed differs. The package lives in the `e2b` group because it injects `e2b`, and keeps the picker family's npm name.

Three differences from the host backend follow from the remote world being Linux whatever the host runs: qualification is POSIX-only (a Windows-shaped path is a relative name in the sandbox), `\` is accepted in a created name because only `/` and NUL are separators there, and symbolic links are resolved by walking each target against the link's own parent for at most 8 hops, because envd reports a link's own metadata rather than its target's. The `maxEntries` bound (default 1000) governs what crosses to the client; the level itself arrives whole from the file API, so only windowed candidates cost a link probe.

`subprocess-e2b` now names the working directory when the wrapper exits before publishing its process-group id, and probes that directory on the failure path only: `FileNotFoundError` produces `subprocess-e2b: cwd does not exist in the sandbox: <path>`, a probe that cannot answer leaves the question in the message (`… (cwd <path>; does it exist in the sandbox?)`), and a directory the sandbox confirms leaves the early exit as the whole diagnosis (`… (cwd <path>)`). The probe is on the failure path rather than before every spawn because a per-spawn metadata request would tax the sci workload's hundreds of spawns to diagnose a misconfiguration that fails on the first one.

## Alternatives considered

**Symlink `/home/node` inside the sandbox image.** This is the hot fix applied in production today, and it is rejected as the design: it makes one host path work by accident of the image, leaves every other host path (a real `/Users/...` or `C:\...` pick) broken, and puts the fix in an image layer where nothing in the repository states or tests it. A picker that lists the wrong filesystem still offers directories that do not exist in the sandbox.

**Make the browse backend's home configurable.** Rejected because `homedir()` is not the defect. The backend would still enumerate the host process filesystem, so the browser would still show host directories and the operator could still walk out of any configured home into one; only the initial landing level would change.

**Canonicalize every navigated path through a remote `realpath`.** Rejected for now: it costs one sandbox process spawn per navigation, which is exactly what `fs-e2b`'s four-slot command cap exists to bound. Listing through the file API keeps navigation spawn-free, at the cost of reporting the path the client sent rather than its canonical target.

## Consequences

A sandbox deployment mounts this backend in place of the `-auto` row and pairs it with the browse client surface; the picker then offers only directories the sandbox can enter, and a picked workspace is a working session cwd. The `sci` profile ships this swap (`packages/sci/sci-profile/cordis.patch.yml`); every other profile is unaffected — `-auto` still resolves between the native and host-browse backends.

The pgid failure now carries its working directory, so the same misconfiguration reached through any other path (a hand-edited session cwd, a preset with a stale root) reports the directory instead of a transport-shaped message. The probe adds one metadata request to a spawn that has already failed.

The listing level is materialized whole on the host, so `maxEntries` bounds the wire rows but not the response held while cutting them; a server-side window needs an envd listing bound the SDK does not expose.

## Testing

The package suite runs against a fake E2B remote at the group's per-file 100% coverage: home resolving to `ctx.e2b.cwd`, directories-only listings with hidden flags and name ordering, absolute/relative/chained/file/broken links, a link cycle stopping at the hop bound, the truncation window at, below, and past the bound, POSIX-only qualification rejecting relative and Windows-shaped paths, error mapping for a missing level, a permission denial and an unreachable sandbox, aborts before and inside a link probe, creation under a real and a symlinked parent, `directory-exists`, non-segment names, a missing and a non-directory parent, and disposal removing the seam registration. `subprocess-e2b`'s suite pins all three publication-failure messages.
