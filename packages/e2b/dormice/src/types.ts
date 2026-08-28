/**
 * Wire records of the Dormice native API this provider reads.
 * @module @deepseek-ai/dsh-dormice/types
 */

/**
 * Per-sandbox lifecycle override sent at acquire time. Every threshold is
 * optional and an omitted one falls back to the daemon's own default, which
 * is the daemon's single arbiter of the merged result; `null` means never.
 */
export interface DormiceLifecyclePolicy {
  /** Idle seconds until an active sandbox freezes. */
  freezeAfterSeconds?: number
  /** Idle seconds until a frozen sandbox stops; `null` parks it frozen forever. */
  stopAfterSeconds?: number | null
  /** Idle seconds until a stopped sandbox archives; `null` never archives. A number requires a non-null `stopAfterSeconds`. */
  archiveAfterSeconds?: number | null
}

/** The identity fields of an acquired sandbox this provider uses. */
export interface DormiceSandboxRecord {
  /** Platform-assigned id of this incarnation; the same value the E2B compatibility surface reports as `sandboxID`. */
  id: string
  /** Caller-chosen address the sandbox was acquired under. */
  name: string
}

/**
 * `POST /acquireSandbox` answer. `restoring` means an archived sandbox is
 * being pulled back and the caller polls acquire again until `ready`.
 */
export interface DormiceAcquireResponse {
  status: 'ready' | 'restoring'
  /** True only when this acquire minted the sandbox. */
  created: boolean
  sandbox: DormiceSandboxRecord
}
