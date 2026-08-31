/**
 * Wire records, registry records, and event payloads of the CaMeL runtime.
 * @module @deepseek-ai/dsh-camel-runtime/types
 */

/** One AgentENV sandbox as `POST /sandboxes` and `POST /sandboxes/{id}/connect` answer it. */
export interface AgentEnvSandbox {
  /** Identifier of the microVM. */
  readonly sandboxID: string
  /** Template or snapshot the microVM resumed from. */
  readonly templateID: string
}

/** Lifecycle state AgentENV reports for a sandbox that still exists. */
export type AgentEnvSandboxState = 'running' | 'paused'

/** One AgentENV sandbox as `GET /sandboxes/{id}` answers it. */
export interface AgentEnvSandboxDetail extends AgentEnvSandbox {
  readonly state: AgentEnvSandboxState
  /** ISO time at which the sandbox pauses or expires. */
  readonly endAt: string
}

/** One AgentENV snapshot as `POST /sandboxes/{id}/snapshots` answers it. */
export interface AgentEnvSnapshot {
  /** Stable identifier; AgentENV starts new sandboxes from it exactly like from a template. */
  readonly snapshotID: string
  /** Aliases the caller assigned; empty when none. */
  readonly names: readonly string[]
}

/** One persistent variant: a named AgentENV sandbox holding a copy of one project directory. */
export interface VariantRecord {
  /** Slot name, unique within the workspace: `^[a-z0-9][a-z0-9-]*$`. */
  readonly name: string
  /** Workspace-relative project directory the variant copied. */
  readonly project: string
  /** The AgentENV sandbox holding the copy. */
  readonly sandboxID: string
  /** Template or snapshot the sandbox started from. */
  readonly templateID: string
  /** When the variant was forked from another variant, the snapshot that fork resumed from; deleted with the variant. */
  readonly snapshotID?: string
  /** The variant this one was forked from, when any. */
  readonly from?: string
  readonly createdAt: string
  readonly lastUsedAt: string
}

/** The durable registry file, kept in the workspace beside the collected results. */
export interface VariantRegistryFile {
  readonly version: 1
  readonly variants: readonly VariantRecord[]
}

/** State a listing reports per variant: the sandbox's state, or `missing` when AgentENV no longer has it. */
export type VariantState = AgentEnvSandboxState | 'missing'

/** One row of `list_variants`. */
export interface VariantListing extends VariantRecord {
  readonly state: VariantState
}

/** Outcome of one `run_in_variant`. */
export interface VariantRunResult {
  readonly name: string
  readonly exitCode: number
  readonly stdoutTail: string
  readonly stderrTail: string
  readonly durationMs: number
}

/** Outcome of one `collect_variant`. */
export interface VariantCollectResult {
  readonly name: string
  /** Project-relative directory that was collected. */
  readonly path: string
  /** Absolute workspace directory the files were written into. */
  readonly destination: string
  readonly files: number
}

/** Payload of {@link SessionEventMap['sci/variant-created']}. */
export interface SciVariantCreatedData {
  readonly name: string
  readonly project: string
  readonly sandboxID: string
  readonly from?: string
}

/** Payload of {@link SessionEventMap['sci/variant-deleted']}. */
export interface SciVariantDeletedData {
  readonly name: string
  readonly sandboxID: string
}

/** Payload of {@link SessionEventMap['sci/variant-run']}. */
export interface SciVariantRunData {
  readonly name: string
  readonly exitCode: number
  readonly durationMs: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One variant slot was created. Log-only and non-surface; the registry
     * file in the workspace is the authoritative slot table, and this record
     * exists so the session log explains where a sandbox came from.
     * @param name - slot name.
     * @param project - workspace-relative project directory copied into it.
     * @param sandboxID - the AgentENV sandbox holding the copy.
     * @param from - the variant it was forked from, when any.
     */
    'sci/variant-created': SciVariantCreatedData
    /**
     * One variant slot was deleted and its sandbox killed. Log-only and non-surface.
     * @param name - slot name.
     * @param sandboxID - the sandbox that was killed.
     */
    'sci/variant-deleted': SciVariantDeletedData
    /**
     * One command ran inside a variant. Log-only and non-surface; the tool
     * result already told the model.
     * @param name - slot name.
     * @param exitCode - the command's exit code.
     * @param durationMs - wall-clock time of the command.
     */
    'sci/variant-run': SciVariantRunData
  }
}
