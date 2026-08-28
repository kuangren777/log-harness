/**
 * Durable storage-domain declaration for the two skill projections.
 *
 * Both tables are projections of the session log, never a second source of
 * truth: `sci_skill_usage` folds recorded skill-tool calls and
 * `sci_skill_lifecycle` folds that usage plus the tree's own membership, so
 * dropping the medium and replaying rebuilds them exactly.
 * @module @deepseek-ai/dsh-sci-skills/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillLifecycleRecord, SkillLifecycleState, SkillUsageRecord } from './types.ts'

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const skillName = z.string().min(1)

/** Runtime schema for the closed curation vocabulary. */
export const skillLifecycleStateSchema = z.union([
  z.literal('active'),
  z.literal('stale'),
  z.literal('archived'),
]) satisfies z.ZodType<SkillLifecycleState>

/** Runtime schema for one `sci_skill_usage` row. */
export const skillUsageRecordSchema = z.object({
  skillName,
  firstUsedAt: epochMillis,
  lastUsedAt: epochMillis,
  count: z.number().int().positive(),
  lastSessionId: z.string().min(1).transform(value => value as SessionId),
}).refine(record => record.lastUsedAt >= record.firstUsedAt, {
  path: ['lastUsedAt'],
  message: 'skill usage lastUsedAt must not precede firstUsedAt',
}) as unknown as z.ZodType<SkillUsageRecord>

/** Runtime schema for one `sci_skill_lifecycle` row. */
export const skillLifecycleRecordSchema = z.object({
  skillName,
  state: skillLifecycleStateSchema,
  pinned: z.boolean(),
  firstSeenAt: epochMillis,
  archivedReason: z.string().min(1).optional(),
  updatedAt: epochMillis,
}) as unknown as z.ZodType<SkillLifecycleRecord>

/** Table name of the usage projection, matching the persistence model. */
export const USAGE_TABLE = 'sci_skill_usage'

/** Table name of the lifecycle projection, matching the persistence model. */
export const LIFECYCLE_TABLE = 'sci_skill_lifecycle'

/** The two skill projections, one row per skill name in each table. */
export const sciSkillsDomainSpec = defineDomain({
  name: 'sci_skills',
  version: 0,
  tables: {
    [USAGE_TABLE]: domainTable<string, SkillUsageRecord>(skillUsageRecordSchema),
    [LIFECYCLE_TABLE]: domainTable<string, SkillLifecycleRecord>(skillLifecycleRecordSchema),
  },
})
