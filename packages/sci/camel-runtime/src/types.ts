/**
 * Wire records and event payloads of the CaMeL runtime.
 * @module @deepseek-ai/dsh-camel-runtime/types
 */

/** One AgentENV sandbox as `POST /sandboxes` answers it. */
export interface AgentEnvSandbox {
  /** Identifier of the microVM this call started. */
  readonly sandboxID: string
  /** Template or snapshot the microVM resumed from. */
  readonly templateID: string
  /** Present when the sandbox was created `secure`; envd control traffic then carries it. */
  readonly envdAccessToken?: string
}

/** One AgentENV snapshot as `POST /sandboxes/{id}/snapshots` answers it. */
export interface AgentEnvSnapshot {
  /** Stable identifier; AgentENV starts new sandboxes from it exactly like from a template. */
  readonly snapshotID: string
  /** Aliases the caller assigned; empty when none. */
  readonly names: readonly string[]
}

/** One requested variant of a fork. */
export interface ForkVariant {
  /** Short identifier naming the variant's result directory: `^[a-z0-9][a-z0-9-]*$`. */
  readonly name: string
  /** Shell command run inside the forked microVM, in the imported workspace directory. */
  readonly command: string
}

/** What one `fork_workspace` call asks for, after schema and value validation. */
export interface ForkRequest {
  /** Variants to run; names are unique within one request. */
  readonly variants: readonly ForkVariant[]
  /** Directory relative to the workspace whose contents flow back per variant; absent means stdout only. */
  readonly collect?: string
  /** Per-command wall-clock budget in seconds. */
  readonly timeoutSeconds: number
}

/** Outcome of one variant. */
export interface ForkVariantResult {
  readonly name: string
  /** Exit code of the variant's command; a failing command is a result, not a fork failure. */
  readonly exitCode: number
  /** Last bytes of stdout, for the model's result text. */
  readonly stdoutTail: string
  /** Last bytes of stderr. */
  readonly stderrTail: string
  /** Absolute workspace path holding `stdout.txt`, `stderr.txt`, `exit-code`, and the collected files. */
  readonly resultDir: string
}

/** Outcome of one whole fork. */
export interface ForkOutcome {
  /** Identity of this fork, naming its result directory. */
  readonly forkId: string
  /** Snapshot every variant resumed from. */
  readonly snapshotID: string
  readonly variants: readonly ForkVariantResult[]
  readonly durationMs: number
}

/** Payload of {@link SessionEventMap['sci/fork-completed']}. */
export interface SciForkCompletedData {
  readonly forkId: string
  readonly snapshotID: string
  readonly variants: readonly { readonly name: string; readonly exitCode: number }[]
  readonly durationMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One fork finished: every variant ran and its results are in the
     * workspace. Log-only and non-surface; the tool result already told the
     * model, and nothing later in the log depends on this record.
     * @param forkId - identity of the fork, naming `<forksDir>/<forkId>/`.
     * @param snapshotID - the AgentENV snapshot the variants resumed from.
     * @param variants - name and exit code per variant, in request order.
     * @param durationMs - wall-clock time of the whole fork.
     */
    'sci/fork-completed': SciForkCompletedData
  }
}
