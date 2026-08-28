/**
 * Vocabulary of the science-research workspace gate: the path taxonomy, the
 * filesystem operations it decides, the decision union, the per-tool argument
 * bindings, and the one session event this package appends.
 * @module @deepseek-ai/dsh-sci-workspace/types
 */

/**
 * One class of the sandbox path taxonomy. The twelve classes of the workspace
 * contract plus `spool-pending`, which the contract's path table separates from
 * the rest of `.sci/` because it is the only harness-private location the model
 * may create files in.
 */
export type PathClass =
  | 'workspace'
  | 'tmp'
  | 'paper-src'
  | 'paper-manifest'
  | 'paper-versions'
  | 'sciplot-code'
  | 'sciplot-manifest'
  | 'sciplot-versions'
  | 'references'
  | 'skills'
  | 'spool-pending'
  | 'private'
  | 'other'

/**
 * A filesystem operation the gate decides. Deletion is absent on purpose: the
 * `ctx.fs` seam has no unlink, so removal reaches the sandbox only through a
 * shell command and is governed by {@link ShellDenial} plus the sandbox's own
 * directory ownership.
 */
export type FsOp = 'read' | 'write' | 'edit'

/**
 * The operation label carried by a denial event. `shell` marks a denial raised
 * by the recursive-delete pre-screen rather than by a path decision.
 */
export type DeniedOp = FsOp | 'shell'

/**
 * Outcome of applying the path table to one operation.
 *
 * `allow-if-absent` is the append-only rule: the class accepts creation of a
 * path that does not exist yet and refuses to replace one that does, so the
 * caller must probe the target before dispatching.
 */
export type FsDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'allow-if-absent' }
  | { readonly kind: 'deny'; readonly rule: string; readonly reason: string }

/** A refused shell command, naming the resolved path that triggered the refusal. */
export interface ShellDenial {
  /** Absolute path the offending operand resolved to. */
  readonly path: string
  /** Stable rule id, matching the vocabulary the denial event is validated against. */
  readonly rule: string
  /** One model-facing sentence stating the refusal and the way forward. */
  readonly reason: string
}

/**
 * Where one filesystem tool keeps the arguments this gate reads.
 *
 * Tool names and argument names are deployment-varying because a deployment may
 * mount a renamed or alternative filesystem tool set; the defaults describe the
 * tools this repository ships.
 */
export interface FsToolBinding {
  /** Registered tool name, as `ctx.tools` knows it. */
  name: string
  /** Argument holding the path the call acts on. */
  path: string
  /** Argument holding the complete new file content, when the tool has one. */
  content?: string
  /** Argument holding the literal text an edit replaces. */
  oldText?: string
  /** Argument holding the literal replacement text. */
  newText?: string
  /** Argument selecting whether every occurrence is replaced. */
  replaceAll?: string
  /** Argument selecting the sub-operation of a multi-command tool. */
  commandArg?: string
  /**
   * Filesystem operation of each sub-operation of a multi-command tool. A value
   * absent from this map leaves the call on the operation of the list the
   * binding is declared in, which is the stricter reading.
   */
  commands?: Record<string, FsOp>
}

/** Where one shell-class tool keeps the command text the pre-screen reads. */
export interface ShellToolBinding {
  /** Registered tool name, as `ctx.tools` knows it. */
  name: string
  /** Argument holding the command line to screen. */
  command: string
}

/** Payload of {@link SessionEventMap['sci/fs-denied']}. */
export interface SciFsDeniedData {
  /** Operation the gate refused. */
  readonly op: DeniedOp
  /** Absolute sandbox path the refusal is about. */
  readonly path: string
  /** Stable rule id, for projection and counting. */
  readonly rule: string
  /** The sentence the model received as the tool's denial reason. */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The workspace gate refused one tool call before dispatch: log-only,
     * non-surface, one record per refusal. The model already learned of the
     * refusal from the tool result, and nothing later in the log is interpreted
     * differently by this event's presence — it exists so an audit projection
     * can count refusals per session — so the producer appends it with the
     * envelope's `ignorable` marker and a reader that does not know the type
     * skips it instead of refusing the log.
     */
    'sci/fs-denied': SciFsDeniedData
  }
}
