/**
 * Durable storage-domain declaration for the memory-node index.
 *
 * `sci_memory_index` is a projection of the session log and the nodes it
 * describes, never a second source of truth: every row is folded from a
 * `sci/memory-written` event plus the frontmatter of the file that event names,
 * so dropping the medium and replaying rebuilds it exactly.
 * @module @deepseek-ai/dsh-sci-memory/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MemoryIndexRecord, MemoryNodeType } from './types.ts'

const turnNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for the closed node-classification vocabulary. */
export const memoryNodeTypeSchema = z.union([
  z.literal('user'),
  z.literal('feedback'),
  z.literal('project'),
  z.literal('reference'),
]) satisfies z.ZodType<MemoryNodeType>

/** Runtime schema for one `sci_memory_index` row. */
// Zod infers the branded session id structurally, so it cannot name the public
// interface even though every branded output is created below.
export const memoryIndexRecordSchema = z.object({
  slug: z.string().min(1),
  originSessionId: z.string().min(1).transform(value => value as SessionId),
  type: memoryNodeTypeSchema.optional(),
  description: z.string().min(1).optional(),
  writtenAtTurn: turnNumber,
  turnsTotal: turnNumber,
}).refine(record => record.turnsTotal >= record.writtenAtTurn, {
  path: ['turnsTotal'],
  message: 'sci memory turnsTotal must not precede writtenAtTurn',
}) as unknown as z.ZodType<MemoryIndexRecord>

/** Table name of the memory index, matching the persistence model. */
export const MEMORY_INDEX_TABLE = 'sci_memory_index'

/** The memory projection, one row per memory-node slug. */
export const sciMemoryDomainSpec = defineDomain({
  name: 'sci_memory',
  version: 0,
  tables: {
    [MEMORY_INDEX_TABLE]: domainTable<string, MemoryIndexRecord>(memoryIndexRecordSchema),
  },
})
