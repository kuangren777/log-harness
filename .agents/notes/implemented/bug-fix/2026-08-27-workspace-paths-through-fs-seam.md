# Agent Note: Canonicalize workspace paths in the filesystem the tools execute in

Status: implemented

English | [中文](2026-08-27-workspace-paths-through-fs-seam.zh.md)

## Problem

`dsh-workspace` canonicalized and checked every path on the Host process filesystem: `realpath` for the uniqueness canon plus `stat` for the directory fact, in `create`, `resolveByPath`, startup header indexing, attach validation, and `status`. That is the right filesystem only when the harness process also runs the session's tools. A deployment that composes a sandboxed filesystem backend runs them in the sandbox instead — the sci deployment mounts `@deepseek-ai/dsh-fs-e2b` over a Dormice sandbox whose `ctx.e2b.cwd` is `/home/user/sci` — while the process itself lives in a different container, and the [sandbox-backed workspace picker](../feature/2026-08-27-directory-picker-e2b.md) hands the client exactly such a path. The picker's own flow therefore could not complete: `workspace.create` on a freshly picked directory failed with `workspace-invalid-path: cannot create a workspace at "/home/user/sci/projects/qa-ws-28d01e": ENOENT: no such file or directory, realpath '/home/user/sci/projects/qa-ws-28d01e'`, the deferred half of [ensuring a session's project directory through the seam](2026-08-27-session-cwd-ensured-through-fs-seam.md).

## Decision

`pathWorld(ctx)` (`packages/workspace/workspace/src/paths.ts:82`) names the filesystem a workspace path belongs to, and every canonicalization in the package goes through it. Its one method, `canonicalize(path)`, returns the canonical path together with whether that path is a directory right now, and rejects when the path does not exist in that world — the two facts each call site already needed, in one round-trip.

With a filesystem service composed, the world is the backend's (`packages/workspace/workspace/src/paths.ts:64`): `resolve(path)` produces the stable target, `stat(target)` decides existence and type, and `processPath(target)` is the canonical absolute path recorded. The seam has no `realpath`, and `resolve` deliberately succeeds for a path that does not exist yet, so `stat` is what makes an absent target this world's `ENOENT`: `the filesystem backend has no such path '<path>'`. Without the service the Host process filesystem is that world and the previous `realpath` plus `stat` runs unchanged (`packages/workspace/workspace/src/paths.ts:51`).

The service is read per call and never held, so a composition that mounts or disposes its filesystem is observed at the next check. `WorkspaceRegistry` reads it directly at `create`, `resolveByPath`, and header indexing; `WorkspaceEntity` receives it as `WorkspaceEntityHost.paths()` (`packages/workspace/workspace/src/entity.ts:69`, supplied at `packages/workspace/workspace/src/index.ts:108`) for attach validation and `status`, so the entity keeps seeing only the registry-owned host and never a `Context`.

Applying the world to rehydration and attach as well as `create` is what keeps records usable: a path stamped at create, a session header's `cwd` canonicalized at startup, and the same `cwd` re-checked at attach all pass through one canon, so membership stays string equality of canonical paths. `WorkspaceRecord.path` accordingly means the canonical path in the filesystem the tools execute in — the seam's canon when one is mounted, the Host `realpath` otherwise (`packages/workspace/workspace/src/types.ts:36`, `packages/workspace/workspace/src/spec.ts:24`) — and a record only validates under the world that stamped it. Recomposing a deployment onto a different backend leaves the stored paths unresolvable there, which `status()` reports as `missing-dir` without mutating any record; the README's Known Limitations owns that gap.

Error codes and message shapes are unchanged. A non-directory still rejects with `cannot create a workspace at '<canonical>': path is not a directory`, an absent path still rejects with its world's own error, and `workspace.create` in the gateway still maps both to `workspace-invalid-path` carrying `cannot create a workspace at "<path>": <cause>`.

## Alternatives considered

**Keep the Host `realpath` canon and pre-create mirror directories in the dsh container.** This is what production was hot-patched to do. Rejected because the picker creates directories in the sandbox on demand: every directory a user makes through the picker would need a second, empty Host directory created at the same instant to keep `workspace.create` working, and the mirror would then satisfy `status()` for a directory the agent cannot reach.

**Add `realpath` to the `FileSystem` Service Definition.** Rejected as redundant: `resolve` already returns the canonical identity and `processPath` its absolute path in the backend's world, which is exactly the canon this package needs. A new abstract method would be owed by `dsh-fs-local`, `dsh-fs-sandbox`, and `dsh-fs-e2b` for no fact they do not already expose.

**Record the world alongside the path so a record can be validated or migrated across backends.** Rejected for want of a current consumer: no deployment switches its filesystem backend under a live registry, the durable format would grow a field every reader must then interpret, and `status()` already reports the honest answer (`missing-dir`) if one ever does.

**Inject `fs` as a required dependency of `WorkspaceRegistry`.** Rejected because it would strand every Host-only composition: the registry would stay pending until some filesystem service appeared, and the Host filesystem is a legitimate execution world, not a missing dependency. `ctx.get('fs')` keeps the service optional, as the gateway's session-cwd check does.

**Give `WorkspaceEntity` its own `Context` instead of a host method.** Rejected because entities exist behind `WorkspaceEntityHost` precisely so the registry owns table access, the session-path index, and header reads; widening a leaf entity to a `Context` to hide one lookup would give it reach over every service in the composition.

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` gains a structural filesystem fake — `resolve`, `stat`, `processPath` are the three methods the package calls — whose world is a `Map` keyed by canonical path plus an alias map standing in for symlinks and `..` segments, provided to the existing harness as an optional `fs` service. The seam cases create a workspace at `/home/user/sci/projects/qa-ws`, assert the record stores that path and that nothing was created on the Host filesystem, and resolve an alias back to the same workspace; refusal cases cover a path absent from the backend, an existing Host directory the backend does not have, a file, and a non-directory of another type. Membership cases attach a session whose header `cwd` is a backend directory, refuse a mismatch, an unresolvable `cwd`, and a `cwd` the backend reports as a file; `status` follows a backend directory as it becomes a file and then disappears, and startup bootstrap groups two headers whose `cwd` spellings resolve to one backend canon. The Host-filesystem cases in the same file are untouched and still cover the no-service world.

## Consequences

The sandbox-backed picker's flow completes end to end: a directory created in the sandbox can be made a workspace and carry sessions, and the Host-only deployments keep the `realpath` behavior they always had. `dsh-workspace` gains a type-only dependency on `@deepseek-ai/dsh-fs` (peer plus dev, with the matching project reference) for the `FileSystem` type and the `ctx.get('fs')` declaration merge; the service stays optional, so a composition without any filesystem runs the registry unchanged. The package's public surface trades the Host-specific `realpathNormalize` export for `pathWorld` and its `PathWorld` / `CanonicalPath` types, which is also the honest name for what callers were reaching for.
