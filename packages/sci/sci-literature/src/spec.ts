/**
 * Durable storage-domain declaration for the search-history table.
 *
 * Unlike the other `sci_*` tables, `sci_literature_history` is NOT a projection
 * of a session log: a search run from the browser view has no agent session to
 * fold, so the row written at the end of `search()` is the only record that the
 * query happened. Dropping the medium therefore loses the history rather than
 * rebuilding it, which is why the table holds nothing but what the "recent
 * queries" strip shows and nothing any other layer reads.
 * @module @deepseek-ai/dsh-sci-literature/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { LiteratureHistoryEntry } from './types.ts'

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one `sci_literature_history` row. */
export const literatureHistoryEntrySchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  at: epochMillis,
  hits: z.number().int().nonnegative(),
  sourceErrors: z.string().min(1).optional(),
}) as unknown as z.ZodType<LiteratureHistoryEntry>

/** Table name of the search history, matching the persistence model. */
export const HISTORY_TABLE = 'sci_literature_history'

/** The search history, one row per distinct query. */
export const sciLiteratureDomainSpec = defineDomain({
  name: 'sci_literature',
  version: 0,
  tables: {
    [HISTORY_TABLE]: domainTable<string, LiteratureHistoryEntry>(literatureHistoryEntrySchema),
  },
})
