# Agent Note: Ensure a session's project directory through the filesystem seam

Status: implemented

English | [中文](2026-08-27-session-cwd-ensured-through-fs-seam.zh.md)

## Problem

`sessions.create` created the requested project directory with `node:fs` `mkdir(cwd, { recursive: true })` on the Host process filesystem. That is only the directory a session's tools will use when the Host process is also their execution world. A deployment that composes a sandboxed filesystem backend runs every tool inside the sandbox, where `/home/user/sci` is a sandbox path and not a Host path, and the [sandbox-backed workspace picker](../feature/2026-08-27-directory-picker-e2b.md) hands exactly such a path back to the client. Creating it on the Host then has two failure modes and no success: the Host `mkdir` is refused (`EACCES: permission denied, mkdir '/home/user'`, which is how the defect surfaced), or it succeeds and leaves a Host directory no tool in the sandbox can reach while the session's real cwd is still absent.

## Decision

`ensureProjectDirectory` in `packages/host/apiproxy/src/api-proxy.ts` reads the optional filesystem service with `ctx.get('fs')` and branches on the execution world it names.

With a filesystem service composed, the check goes through the seam: `resolve(cwd)` then `stat(target)`. An existing directory is the success case; an absent target and a target of any other type both fail. The seam has no directory-creation method, so a service-backed composition verifies rather than creates — the party that supplies a cwd is the party that creates it in that world (the picker's `createDirectory`, or a sandbox provider's own bootstrap such as `dsh-dormice` making `ctx.e2b.cwd`). `resolve` follows symlinks, so a symlinked project directory reports as a directory without a second probe.

Without a filesystem service the Host filesystem is that world, and the previous recursive `mkdir` runs unchanged.

Both branches keep one failure message, `failed to ensure project directory "<cwd>": <cause>`, wrapping the cause; `sessions.create` still maps it to the `internal` RPC error. The resume path is untouched: a stored session compares its recorded cwd and answers `SessionCwdConflict` before any directory check.

## Alternatives considered

**Add `mkdir`/`ensureDir` to the `FileSystem` Service Definition.** Rejected for this change: it is a new abstract method on the seam with implementations owed by `dsh-fs-local`, `dsh-fs-sandbox`, and `dsh-fs-e2b`, plus a sandbox-policy answer for where recursive creation is allowed to reach. No current consumer needs directory creation through the seam — the picker creates directories through its own capability — so the seam stays as it is until one does.

**Probe with `lstat(cwd)` instead of `resolve` + `stat`.** Rejected because `lstat` deliberately does not follow the final component, so a symlinked project directory would need a second, target-shaped probe and its own failure paths for no gain here.

**Keep the Host `mkdir` and pre-create sandbox paths in the deployment.** This is what production was hot-patched to do. Rejected as the shipped behavior because it makes every sandbox cwd a Host-container path that must exist twice, and it silently reports success for a directory the agent cannot use.

**Create the directory through the shell or subprocess seam instead.** Rejected because it picks a second execution world at the gateway: the filesystem service already names the world the session's file tools use, and a composition may have one seam without the other.

## Testing

`packages/host/apiproxy/tests/api-proxy-session-cwd.spec.ts` composes the gateway with and without a structural filesystem fake. The seam-backed cases assert the probed paths, that creation succeeds for a directory only the fake has, and that the path does not exist on the Host filesystem afterwards; the absent-target and non-directory cases assert the refusal and its message. The Host-fallback cases assert recursive creation under a temporary root and that a Host `mkdir` failure keeps the same message.

## Related

`dsh-workspace` canonicalized and checked its paths on the Host filesystem in the same way, so a sandbox-only path failed `workspace.create` for the same reason. That half shipped separately, as this note deferred it: [workspace paths through the filesystem seam](2026-08-27-workspace-paths-through-fs-seam.md) puts the package's canon on `ctx.get('fs')` and redefines `WorkspaceRecord.path` as the canonical path in the world the tools execute in.

## Consequences

A sandboxed deployment can create a session in a picked sandbox directory, and a Host-only deployment keeps the create-on-demand behavior it always had. A session whose cwd does not exist in the sandbox is now refused with a message naming the directory instead of being served over a Host directory the agent cannot see. `dsh-host-apiproxy` gains a type-only dependency on `@deepseek-ai/dsh-fs` for the `ctx.get('fs')` declaration merge; the service stays optional, so a composition without any filesystem still serves every RPC.
