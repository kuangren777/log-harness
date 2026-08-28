# Agent Note: workspace.listDirectory (entry-capped, workspace-scoped directory listing)

Status: implemented

English | [中文](2026-08-28-workspace-list-directory.zh.md)

## Problem

[`workspace.readFile`](2026-08-28-workspace-read-file.md) gave a client the bytes of a file in the world an agent's tools run in, but nothing told it which files exist. A files panel over a session's project directory therefore had to be told a path out of band, and could never present a tree.

`host.listDirectory` is the wrong seam for this. It serves the native directory picker over `ctx.directoryPicker`'s browse backend, which walks the Host filesystem and carries picker vocabulary (ancestry for a breadcrumb, no per-entry size). In the sci deployment `ctx.fs` is the Dormice sandbox: `/home/user/sci` inside it is not a Host path, so a Host walk would enumerate the wrong world or find nothing. The same seam already owns the containment question, because only the backend can canonicalize its own paths.

## Decision

**`workspace.listDirectory` serves one complete directory level through `ctx.fs.listDir`, fenced by the addressed session's own cwd and bounded by a deployment-configured entry cap.**

- Contract: `listDirectory(request: RpcRequest<{ sessionId, path }>, signal): Promise<RpcResponse<WorkspaceDirectoryListing>>` on `WorkspaceApi`, where `WorkspaceDirectoryListing` is `{ path, entries }` and each entry is `{ name, path, kind: 'directory' | 'file' | 'other', size? }`. Both `path` fields are canonical paths in the backend's execution world.
- Addressing: identical to `readFile`, with one deliberate difference. `path` is absolute or relative to `session.header.cwd`, and an **empty** `path` addresses that cwd itself — the entry point a panel opens with. `workspaceReadFileRequestSchema` keeps `z.string().min(1)` while `workspaceListDirectoryRequestSchema` uses `z.string()`, because a file has no empty-path meaning and a directory does.
- Shared prologue and fence: `workspaceFsScope(ctx, sessionId)` resolves the session, its cwd, and the `fs` seam or returns the refusal; `resolveWorkspaceTarget(fs, cwd, path, signal)` resolves the target and tests `fs.contains(root, target)`. `readFile` was refactored onto both, so the two methods cannot drift on the fence. `resolveWorkspaceTarget` answers the root target directly for an empty path, because the seam rejects an empty string as a non-path.
- No Agent, no pre-stat: the `skill.list` stance as in `readFile`. The listing is not preceded by a `stat`, because `listDir` already refuses an absent target with `FS_NOT_FOUND` and a non-directory with `FS_NOT_DIRECTORY`; the gateway narrows those two codes and folds the rest into `internal`.
- Symlinks: `kind` is what the entry resolves to, so a link to a directory is a `directory` row and a dangling link is `other`. The row `path` stays the entry's own path, not its target's, so the browser keeps showing the tree the user sees. The local backend already produces exactly this from `FsDirEntry` (`target.displayPath` is `join(parent, name)`, `type` comes from a following `probe`).
- Ordering and dotfiles: the gateway sorts every directory ahead of everything else and each group by `localeCompare`, the comparator the seam itself uses. Dotfiles are included; hiding them is a client decision, and a `.env` or `.gitignore` is often exactly what a user opens the panel for.
- Bound: `ApiProxyService.Config.listDirectoryMaxEntries` (`z.natural().default(5000)`) is applied to the complete level after `listDir` returns. A larger directory answers `too-many-entries {path, maxEntries}` rather than a prefix.
- Error vocabulary: two new `RpcErrorDetailsMap` rows — `not-a-directory {path}` and `too-many-entries {path, maxEntries}` — reusing `path-out-of-scope`, `file-not-found`, `session-not-found`, `cancelled`, and `internal` from `readFile`.

## Alternatives considered

**Extend `host.listDirectory` with a session address.** Rejected: it is the directory picker's method over `ctx.directoryPicker`, a different seam with a different world and a browse-shaped value (`ancestors`, no sizes). Overloading it would make one method answer from two filesystems depending on its payload.

**Add a `listDir`-shaped method to the fs seam.** Unnecessary — `FileSystem.listDir` already exists with `FsDirEntry` carrying `name`, `type`, `target`, and `size`, and both the local and e2b providers implement it. No seam package was touched.

**`stat` the target before listing to raise `not-a-directory` from a known type.** Rejected for the same reason `readFile` rejected a pre-read size check: the operation that owns the question already answers it, and the extra round-trip would add a branch reachable only through a backend whose `stat` and `listDir` disagree.

**Recursive listing, or a depth parameter.** Rejected: a lazily expanded tree issues one call per opened node, which is the traffic the consumer actually generates, and a recursive walk would make the entry cap meaningless against a deep tree.

**A continuation cursor instead of `too-many-entries`.** Rejected for now: paging a directory needs a stable order under concurrent mutation, which the seam does not promise, and no consumer browses a 5000-entry directory. Refusing loudly is honest; a silently truncated level is not.

**Sort with a plain codepoint comparison.** Rejected for symmetry: `listDirectory` in the local backend already orders by `localeCompare`, and a second comparator would reorder rows within a group for no stated reason.

**Report `symlink` as a fourth `kind`.** Rejected: the panel's question is what happens when a row is opened, which is what the target is. `FsInfo` deliberately resolves, and `FsPathInfo`/`lstat` exists for the trust-boundary consumers that need the distinction.

## Consequences

The panel browses one level at a time and cannot open a directory past `listDirectoryMaxEntries` at all — not even partially. Both are recorded as apiproxy README Known Limitations. A deployment with genuinely huge output directories tunes the cap rather than getting a truncated view.

`readFile` now shares `workspaceFsScope` and `resolveWorkspaceTarget` with `listDirectory`. Its observable behavior is unchanged, and its own suite still passes unmodified, but the two methods now fail identically on session, cwd, backend, and containment because there is one implementation of each.

Adding one `RpcMethodMap` row is again compiler-locked to three implementations outside this package — the connection fixture's in-memory `ApiProxy` and its exhaustive `dispatch()`, and the connection and runtime `IApiClient` fakes.

`tests/api-proxy-list-directory.spec.ts` composes the gateway over a real `SessionStore` and `@deepseek-ai/dsh-fs-local` rooted at a temporary directory, so the listings are real listings: the cwd via an empty path with dotfiles and directory-first ordering, an empty directory, a nested relative path equal to the same absolute one, symlinks to a directory and to a file plus a dangling one, a FIFO as `other` and as a `not-a-directory` refusal, a `../` escape and an unrelated absolute path and a symlink out of the project all refused, a regular file as `not-a-directory`, a missing target and a path through a regular file, an exact-cap listing beside a one-entry-over refusal, an unattached session, a cwd-less header, an absent backend, a pre-aborted signal, and both an `Error` and a non-`Error` backend failure folded into `internal`.
