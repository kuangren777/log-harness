/**
 * Usage and lifecycle projection over the session log.
 *
 * The studied platform injected all fifteen skills forever and never retired
 * one. Here every load recorded in the session log ages the tree: a skill
 * nobody has loaded for long enough shrinks to a one-line listing, a skill that
 * left the tree stops being listed at all, and a pinned skill is exempt from
 * both. Every function here is pure, with the clock passed in.
 * @module @deepseek-ai/dsh-sci-skills/src/lifecycle
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillLifecycleRecord, SkillUsageRecord } from './types.ts'

/** Milliseconds in one day; the unit `staleAfterDays` is expressed in. */
export const MILLISECONDS_PER_DAY = 86_400_000

/** Why a lifecycle row moves to `archived` without an operator decision. */
export const REMOVED_FROM_TREE_REASON = 'no longer present in the skill tree'

// A Latin terminator only ends a sentence before whitespace or the string end,
// so `e.g.` and `0.5` inside a description do not truncate it; the full-width
// terminators need no such guard because they never appear mid-token.
const SENTENCE_END = /[.!?](?=\s|$)|[。！？]/

/**
 * Shorten a description to its first sentence for a stale skill's listing.
 * @param description - the full routing description.
 * @returns the text up to and including the first sentence terminator, or the
 *   whole description when it contains none.
 */
export function firstSentence(description: string): string {
  const match = SENTENCE_END.exec(description)
  return match === null ? description : description.slice(0, match.index + 1)
}

/**
 * Recover the skill name from a recorded skill-tool call.
 *
 * The argument string is raw model output recorded verbatim in the log, so it
 * is parsed defensively: anything that is not an object carrying a non-empty
 * string `name` records no usage.
 * @param rawArguments - the `tool/call` event's unparsed `arguments` JSON.
 * @returns the requested skill name, or `undefined` when the call named none.
 */
export function parseSkillToolArgument(rawArguments: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    // Recorded model output; a malformed call already failed at the tool and
    // nothing else in this package reads it.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const name = (parsed as { name?: unknown }).name
  return typeof name === 'string' && name !== '' ? name : undefined
}

/**
 * Fold one recorded load into a skill's usage row.
 * @param previous - the stored row, or `undefined` for a first load.
 * @param skillName - the loaded skill.
 * @param sessionId - the session that loaded it.
 * @param at - epoch milliseconds of the load.
 * @returns the updated row.
 */
export function foldUsage(
  previous: SkillUsageRecord | undefined,
  skillName: string,
  sessionId: SessionId,
  at: number,
): SkillUsageRecord {
  return {
    skillName,
    firstUsedAt: previous?.firstUsedAt ?? at,
    lastUsedAt: Math.max(previous?.lastUsedAt ?? at, at),
    count: (previous?.count ?? 0) + 1,
    lastSessionId: sessionId,
  }
}

/** Everything {@link curateLifecycle} folds, with the clock supplied by the caller. */
export interface CurationInput {
  /** Skill names currently present in the bundled tree. */
  readonly present: readonly string[]
  /** Usage rows keyed by skill name. */
  readonly usage: ReadonlyMap<string, SkillUsageRecord>
  /** Lifecycle rows already stored, keyed by skill name. */
  readonly stored: ReadonlyMap<string, SkillLifecycleRecord>
  /** Skill names configuration exempts from ageing out. */
  readonly pinned: ReadonlySet<string>
  /** Days of disuse after which an unpinned skill becomes `stale`. */
  readonly staleAfterDays: number
  /** Epoch milliseconds treated as now. */
  readonly now: number
}

/**
 * Project the lifecycle rows for the whole tree.
 *
 * A present skill ages from its last recorded load, or from when it first
 * appeared in the tree while it has never been loaded; crossing
 * `staleAfterDays` makes it `stale`. A pinned skill is always `active`,
 * whatever its age. A stored row whose skill left the tree becomes `archived`,
 * which keeps its usage history addressable without listing it. `updatedAt`
 * only moves when the row's own fields move, so an unchanged tree produces
 * unchanged rows.
 * @param input - present skills, both stored projections, and the clock.
 * @returns the complete lifecycle projection, keyed by skill name.
 */
export function curateLifecycle(input: CurationInput): Map<string, SkillLifecycleRecord> {
  const { present, usage, stored, pinned, staleAfterDays, now } = input
  const staleAfterMs = staleAfterDays * MILLISECONDS_PER_DAY
  const projected = new Map<string, SkillLifecycleRecord>()
  for (const skillName of present) {
    const existing = stored.get(skillName)
    const firstSeenAt = existing?.firstSeenAt ?? now
    const isPinned = pinned.has(skillName)
    const lastActivity = usage.get(skillName)?.lastUsedAt ?? firstSeenAt
    const state = isPinned || now - lastActivity <= staleAfterMs ? 'active' : 'stale'
    projected.set(skillName, settle(existing, { skillName, state, pinned: isPinned, firstSeenAt, updatedAt: now }))
  }
  for (const [skillName, existing] of stored) {
    if (projected.has(skillName)) continue
    projected.set(skillName, settle(existing, {
      skillName,
      state: 'archived',
      pinned: existing.pinned,
      firstSeenAt: existing.firstSeenAt,
      archivedReason: existing.archivedReason ?? REMOVED_FROM_TREE_REASON,
      updatedAt: now,
    }))
  }
  return projected
}

/**
 * Keep the stored row when nothing but `updatedAt` would change.
 * @param existing - the stored row, when there is one.
 * @param candidate - the freshly projected row.
 * @returns the row to store.
 */
function settle(
  existing: SkillLifecycleRecord | undefined,
  candidate: SkillLifecycleRecord,
): SkillLifecycleRecord {
  if (existing === undefined) return candidate
  const unchanged = existing.state === candidate.state
    && existing.pinned === candidate.pinned
    && existing.firstSeenAt === candidate.firstSeenAt
    && existing.archivedReason === candidate.archivedReason
  return unchanged ? existing : candidate
}
