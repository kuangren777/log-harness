/**
 * workspace domain contract. Wire projection of the host-side workspace
 * entity (@deepseek-ai/dsh-workspace): a stable id over a directory path,
 * a display title, and the ordered session account. Method signatures are the
 * source of truth, same as the sessions domain.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Wire-side workspace id brand. Deliberately re-declared here rather than
 * imported from dsh-workspace: api/ must stay browser-importable with zero
 * host-package dependencies, and the brand string matches, so both sides
 * agree structurally.
 */
export type WorkspaceId = Branded<'WorkspaceId'>

/** One workspace row: the record projection every workspace.* value carries. */
export interface WorkspaceView {
  workspaceId: WorkspaceId
  /** Canonical directory path (host-side realpath canon). */
  path: string
  /** Display title (defaults to the path basename at create). */
  title: string
  /**
   * Sessions accounted under this workspace, in manually owned order
   * (attach prepends, insertSessionBefore reorders; activity never does).
   */
  sessionIds: SessionId[]
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/**
 * One file's complete content, read through the session's filesystem seam for a
 * client preview surface. Never a partial read: a file past the deployment's
 * `readFileMaxBytes` cap fails with `file-too-large` instead of truncating.
 */
export interface WorkspaceFileContent {
  /** Canonical absolute path in the filesystem backend's execution world (not the requested spelling). */
  path: string
  /** Byte length of the file content before `encoding` is applied. */
  size: number
  /** Media type derived from the path extension; `application/octet-stream` for an unlisted one. */
  mediaType: string
  /** How `content` carries the bytes: UTF-8 decoded text, or base64 of the raw bytes. */
  encoding: 'utf8' | 'base64'
  /** The complete file content in `encoding`. */
  content: string
}

/**
 * One direct child of a listed directory. Metadata only — listing never reads
 * file content, so a client picks its per-row affordance from `kind` and asks
 * for bytes with a separate `workspace.readFile`.
 */
export interface WorkspaceDirectoryEntry {
  /** Basename inside the listed directory, including a leading dot. */
  name: string
  /** Canonical path of the entry itself; a symlink keeps its own path, not its target's. */
  path: string
  /** What the entry resolves to: a directory, a regular file, or anything else (socket, device, dangling symlink). */
  kind: 'directory' | 'file' | 'other'
  /** Byte size of a regular file, when the backend reports one. */
  size?: number
}

/**
 * One directory level, listed through the session's filesystem seam for a
 * client file browser. Dotfiles are included — hiding them is a client
 * decision, not a gateway one.
 */
export interface WorkspaceDirectoryListing {
  /** Canonical absolute path of the listed directory in the backend's execution world. */
  path: string
  /** Direct children: every directory first, then everything else, each group by name. */
  entries: WorkspaceDirectoryEntry[]
}

/** Workspace-domain unary methods (the map keys workspace.* of RpcMethodMap). */
export interface WorkspaceApi {
  /**
   * Lists all workspaces in the registry's durable display order, plus the
   * registry-global archive set (the reconnect baseline of
   * `host/archived-sessions-changed`). Archived sessions stay in their
   * workspace's `sessionIds` account; grouping surfaces hide them.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>>

  /**
   * Creates (or idempotently resolves) a workspace over an EXISTING directory
   * (no mkdir — a missing or non-directory path fails with
   * `workspace-invalid-path`). A path resolving to a directory already owned
   * by a workspace returns that workspace (`created: false`). Adoption allows
   * distinct canonical paths whose basenames produce the same display title;
   * the registry's basename title default names the new workspace.
   */
  create(request: RpcRequest<{ path: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>

  /**
   * Renames a workspace. `title` is trimmed and must be non-empty
   * (schema-enforced). An unknown id fails with `workspace-not-found`; a
   * title equal to another workspace's fails with `workspace-name-conflict`.
   * Renaming to the current title is a no-op success (no durable write).
   */
  rename(request: RpcRequest<{ workspaceId: WorkspaceId; title: string }>):
  Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Removes one Workspace registration. The directory, every user file, and
   * every session log remain untouched; those Sessions consequently become
   * ungrouped. An unknown id fails with `workspace-not-found`.
   */
  delete(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ deleted: true }>>

  /**
   * Moves one Workspace within the registry display order,
   * DOM-insertBefore-like. An omitted anchor appends to the end.
   */
  insertBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    beforeWorkspaceId?: WorkspaceId
  }>): Promise<RpcResponse<{ workspaceIds: WorkspaceId[] }>>

  /**
   * Moves an accounted session within its workspace's manual order,
   * DOM-insertBefore-like: with `beforeSessionId` the session is inserted
   * before that anchor; omitted appends to the end. An unknown workspace
   * fails with `workspace-not-found`; a session or anchor not accounted by
   * the workspace fails with `workspace-move-invalid`. A move to the current
   * position is a no-op success.
   */
  insertSessionBefore(request: RpcRequest<{
    workspaceId: WorkspaceId
    sessionId: SessionId
    beforeSessionId?: SessionId
  }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>

  /**
   * Adds one session to the registry-global archive set: the session
   * disappears from every grouping surface but keeps its session log and its
   * workspace accounting slot (a future unarchive restores its position).
   * Idempotent for an already archived id. A session neither live nor in
   * session persistence fails with `session-not-found`. Returns the full
   * updated set (same snapshot the changed frame carries).
   */
  archiveSession(request: RpcRequest<{ sessionId: SessionId }>):
  Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>

  /**
   * Read one file under a session's project directory through the filesystem
   * seam that session's tools run in, for a client preview surface.
   *
   * The session addresses the directory: `path` is absolute or relative to
   * that cwd, and a target the backend does not canonically contain fails with
   * `path-out-of-scope` — a symlink out of the directory is refused with it,
   * because containment is tested on resolved targets. An attached session is
   * required (`session-not-found` otherwise, as in `skill.list`); a session
   * whose header records no project, and a composition mounting no filesystem
   * backend, both answer `internal`.
   *
   * The complete content is read or nothing is: an absent target answers
   * `file-not-found`, a directory or special file `not-a-file`, and a file
   * past the deployment's `readFileMaxBytes` cap `file-too-large` rather than
   * a truncated body. Cancellation through the carrier's request signal
   * answers `cancelled`.
   */
  readFile(
    request: RpcRequest<{ sessionId: SessionId; path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<WorkspaceFileContent>>

  /**
   * List one directory level under a session's project directory through the
   * filesystem seam that session's tools run in, for a client file browser.
   *
   * Addressing and the containment fence match {@link readFile}: `path` is
   * absolute or relative to the session's cwd, an empty `path` is that cwd
   * itself, and a target the backend does not canonically contain fails with
   * `path-out-of-scope`. An attached session is required
   * (`session-not-found` otherwise); a session whose header records no
   * project, and a composition mounting no filesystem backend, both answer
   * `internal`.
   *
   * The complete level is listed or nothing is: an absent target answers
   * `file-not-found`, a regular or special file `not-a-directory`, and a
   * directory with more children than the deployment's `listDirectoryMaxEntries`
   * cap `too-many-entries` rather than a partial level. Entries carry metadata
   * only, dotfiles included, with every directory before everything else and
   * each group in name order. Cancellation through the carrier's request signal
   * answers `cancelled`.
   */
  listDirectory(
    request: RpcRequest<{ sessionId: SessionId; path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<WorkspaceDirectoryListing>>
}
