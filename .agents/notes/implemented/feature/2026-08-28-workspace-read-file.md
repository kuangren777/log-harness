# Agent Note: workspace.readFile (byte-capped, workspace-scoped file read)

Status: implemented

English | [中文](2026-08-28-workspace-read-file.zh.md)

## Problem

A browser had no way to obtain a file's bytes from the world an agent's tools run in. `host.listDirectory` returns directory metadata only, `host.openPath` hands a path to the operating system's default application (nothing a remote browser can render), and `session.attachment` addresses images the user uploaded, not the markdown, code, figures, and PDFs the agent produced. A right-hand files panel over a session's project directory therefore had no read at all.

The read cannot go through the Host filesystem. In the sci deployment `ctx.fs` is the Dormice sandbox: `/home/user/sci` inside it is not a Host path, so a Host `readFile` would answer from the wrong world or fail. The same seam already owns the containment question, because only the backend can canonicalize its own paths.

## Decision

**`workspace.readFile` reads one complete file through `ctx.fs`, fenced by the addressed session's own cwd and bounded by a deployment-configured byte cap.**

- Contract: `readFile(request: RpcRequest<{ sessionId, path }>, signal): Promise<RpcResponse<WorkspaceFileContent>>` on `WorkspaceApi`, where `WorkspaceFileContent` is `{ path, size, mediaType, encoding: 'utf8' | 'base64', content }`. `path` is the canonical path in the backend's execution world, not the requested spelling, so a client can key a cache on it.
- Addressing: the session supplies the directory. A request `path` is absolute or relative to `session.header.cwd`; both it and the cwd go through `ctx.fs.resolve`, and `ctx.fs.contains(root, target)` is the fence. Containment is tested on **resolved** targets, so a symlink whose target leaves the project directory is refused as the traversal it is rather than followed because its own path looked contained.
- No Agent: reading resolves the cwd from the host-resident session header and neither creates nor resumes anything — the `skill.list` stance. An unattached session answers `session-not-found`; a cwd-less legacy header and a composition mounting no filesystem backend both answer `internal`, the two refusals `skill.list` already spells that way.
- Bound: `ApiProxyService.Config.readFileMaxBytes` (`z.natural().default(8 * 1024 * 1024)`) is passed straight to `ctx.fs.readBytes(target, signal, maxBytes)`. The seam refuses an oversized target with `FS_TOO_LARGE` instead of returning a short read, so the response is complete or absent, never truncated.
- Presentation: `mediaType` comes from a fixed extension table, `application/octet-stream` for anything unlisted. `encoding` is `utf8` for `text/*` plus `application/json`, `application/x-univer`, and `image/svg+xml`; `base64` for everything else.
- Error vocabulary: four new `RpcErrorDetailsMap` rows — `path-out-of-scope {path, cwd}`, `file-not-found {path}`, `not-a-file {path}`, `file-too-large {path, maxBytes}` — plus the existing `session-not-found`, `cancelled`, and `internal`. `file-too-large` carries the cap; the actual size stays in the backend's own message.

## Alternatives considered

**Read on the Host with `node:fs`, the way `ensureProjectDirectory` falls back.** Rejected: that fallback exists because a directory must be created *somewhere* when no seam is composed, while a read has a correct answer only in the tools' world. It would also force a second containment implementation in Host path terms next to the seam's canonical `contains`.

**A dedicated `session-no-workspace` code for a cwd-less header.** Rejected for symmetry: `skill.list` already treats that header as host breakage and answers `internal`, and two spellings of one fact invite clients to branch on both.

**Text-only reads with an `unsupported-binary` refusal.** Rejected once `FileSystem.readBytes` turned out to exist with its own byte bound: base64 is real for every backend, so a figures-and-PDF panel needs no capability negotiation.

**Re-check `FsInfo.size` against the cap before reading.** Rejected: the seam enforces the bound at the read that owns it. A second check adds a branch reachable only through a backend that reports no size, which is exactly the case the seam's own failure already covers.

**A no-envelope streaming GET, the `session.export` shape.** Rejected for this consumer: a preview panel wants one validated value, and the existing carrier already gives it schema parsing on both sides. Range requests remain available later without changing this method.

**Cold sessions via `historySourceFor`.** Rejected: reading a whole cold log to recover one cwd is disproportionate to a file read, and `skill.list` already draws the attached-session line.

**Content sniffing for `mediaType`.** Rejected: the client renders from the label the same file carries everywhere else in the product; a sniffed type would disagree with its own name.

## Consequences

Base64 inflates a binary body by about a third, so the 8 MiB default arrives as roughly 11 MB of JSON — the cap bounds the file, not the response, and a deployment that cares tunes `readFileMaxBytes`. The panel gets whole files only: no paging, no range, and a cold session must be opened before its outputs are previewable. Both are recorded as apiproxy README Known Limitations.

Adding one `RpcMethodMap` row is compiler-locked to three implementations outside this package — the connection fixture's in-memory `ApiProxy` and its exhaustive `dispatch()`, and the connection and runtime `IApiClient` fakes — so a new method is never a single-package change. `@deepseek-ai/dsh-fs` moved from a type-only to a value import in `api-proxy.ts` for `FsError`, which narrows the seam's refusals to their stable codes at the wire boundary the way `GoalError` does for the goal domain.

`tests/api-proxy-read-file.spec.ts` composes the gateway over a real `SessionStore` and `@deepseek-ai/dsh-fs-local` rooted at a temporary directory, so the reads are real reads: UTF-8 with a multibyte body, JSON as text, PNG bytes round-tripping through base64, an unlisted extension, absolute and nested-relative paths, a `../` escape and an unrelated absolute path and a symlink out of the project all refused, the cwd itself as `not-a-file`, a missing file and a path through a regular file, an exact-cap read beside a one-byte-over refusal, an unattached session, a cwd-less header, an absent backend, a pre-aborted signal, and an unclassified backend throw.
