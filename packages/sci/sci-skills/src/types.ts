/**
 * Durable and in-memory vocabulary of the science-research skill layer: the
 * content-hash manifest written into the sandbox, the two projection records,
 * and the one session event this package appends.
 * @module @deepseek-ai/dsh-sci-skills/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Curation state of one skill. `active` is listed with its full description,
 * `stale` with its first sentence only, `archived` is not listed at all.
 */
export type SkillLifecycleState = 'active' | 'stale' | 'archived'

/** Content hash of one skill directory plus the per-file digests it folds. */
export interface SkillTreeHash {
  /** Merkle digest over the sorted `<relative path, sha256>` pairs below. */
  readonly hash: string
  /** sha256 of each file's UTF-8 content, keyed by slash-separated path relative to the skill directory. */
  readonly files: Readonly<Record<string, string>>
}

/** The whole synced tree, keyed by skill name. */
export type SkillTreeManifest = Readonly<Record<string, SkillTreeHash>>

/** Files one sync round must publish and retract, as `<skill>/<relative path>`. */
export interface SkillSyncPlan {
  /** Paths whose sandbox copy is absent or stale, in stable order. */
  readonly write: readonly string[]
  /** Paths present in the sandbox that the local tree no longer contains, in stable order. */
  readonly remove: readonly string[]
}

/** Projected `sci_skill_usage` row: how often and how recently a skill was loaded. */
export interface SkillUsageRecord {
  /** Skill name exactly as the skill tool received it. */
  readonly skillName: string
  /** Epoch milliseconds of the first recorded load. */
  readonly firstUsedAt: number
  /** Epoch milliseconds of the most recent load. */
  readonly lastUsedAt: number
  /** Total recorded loads. */
  readonly count: number
  /** Session that produced the most recent load. */
  readonly lastSessionId: SessionId
}

/** Projected `sci_skill_lifecycle` row: the curated state that filters the listing. */
export interface SkillLifecycleRecord {
  /** Skill name, matching its directory under the skill root. */
  readonly skillName: string
  /** Curated state driving the listing filter. */
  readonly state: SkillLifecycleState
  /** Whether configuration exempts this skill from ageing out. */
  readonly pinned: boolean
  /** Epoch milliseconds when this skill first appeared in the tree; the ageing basis until it is used. */
  readonly firstSeenAt: number
  /** Why the skill was archived; absent while it is not archived. */
  readonly archivedReason?: string
  /** Epoch milliseconds of the last state change. */
  readonly updatedAt: number
}

/** Payload of {@link SessionEventMap['sci/skills-synced']}. */
export interface SciSkillsSyncedData {
  /** Sandbox-relative paths written in this round, in stable order. */
  readonly changed: readonly string[]
  /** Sandbox-relative paths removed in this round, in stable order. */
  readonly removed: readonly string[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The bundled skill tree was reconciled into the sandbox before this
     * session could load a skill: log-only, non-surface, one record per sync
     * round replayed into every session opened after it. Purely informational
     * — nothing later in the log is interpreted differently by its presence —
     * so the producer appends it with the envelope's `ignorable` marker and a
     * reader that does not know the type skips it instead of refusing the log.
     */
    'sci/skills-synced': SciSkillsSyncedData
  }
}
