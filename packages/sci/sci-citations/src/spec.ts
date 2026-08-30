/**
 * Durable storage-domain declaration for the citation pool.
 *
 * The two tables are a convenience store, not a log projection, and they say
 * so honestly. Most of a citation IS re-derivable — every bibliographic field
 * comes back from `refs.bib`, and `uses` comes back from a scan of the files —
 * which is exactly what `rescan` does. What does NOT come back is the part a
 * person decided: which group a citation was filed under, whether it was
 * quarantined by hand, and the note attached to it. Those have no other origin,
 * so the table is where they live, and `rescan` is written to update the
 * derivable half without touching the decided half.
 * @module @deepseek-ai/dsh-sci-citations/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Citation, CitationGroup } from './types.ts'

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one `sci_citation_group` row. */
export const citationGroupSchema = z.object({
  project: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  order: z.number().int().nonnegative(),
}).strict() as unknown as z.ZodType<CitationGroup>

/** Runtime schema for one `sci_citation` row. */
export const citationSchema = z.object({
  id: z.string().min(1),
  project: z.string().min(1),
  citekey: z.string().min(1),
  libraryId: z.string().min(1).optional(),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  year: z.number().int().optional(),
  venue: z.string().min(1).optional(),
  doi: z.string().min(1).optional(),
  arxivId: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  sources: z.array(z.string().min(1)),
  group: z.string().min(1),
  confidence: z.number().int().min(0).max(100),
  quarantined: z.boolean(),
  uses: z.number().int().nonnegative(),
  lastScanAt: epochMillis.optional(),
  note: z.string().min(1).optional(),
  addedAt: epochMillis,
  updatedAt: epochMillis,
}).strict().refine(row => row.id === `${row.project}:${row.citekey}`, {
  path: ['id'],
  message: 'sci citation id must be `${project}:${citekey}`',
}) as unknown as z.ZodType<Citation>

/** Table name of the citations themselves. */
export const CITATION_TABLE = 'sci_citation'

/** Table name of the user-defined groups. */
export const CITATION_GROUP_TABLE = 'sci_citation_group'

/** The citation pool: one row per `<project>:<citekey>`, one per `<project>:<group>`. */
export const sciCitationsDomainSpec = defineDomain({
  name: 'sci_citations',
  version: 0,
  tables: {
    [CITATION_TABLE]: domainTable<string, Citation>(citationSchema),
    [CITATION_GROUP_TABLE]: domainTable<string, CitationGroup>(citationGroupSchema),
  },
})
