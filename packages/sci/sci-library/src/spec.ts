/**
 * Durable storage-domain declaration for the knowledge base.
 *
 * `sci_library_entry` is NOT a projection of a session log. Most of what it
 * holds was never model-visible — a PDF the user dragged into the browser, a
 * tag they typed, a status they set — so the row is the only record that any
 * of it happened, and dropping the medium loses the library rather than
 * rebuilding it.
 *
 * The schema is strict: an unknown column is a read-side failure rather than a
 * silently kept field, which is why every write goes through `entryRow` and
 * leaves unfilled optional columns absent instead of storing `undefined`.
 * @module @deepseek-ai/dsh-sci-library/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { LibraryEntry } from './types.ts'

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one file stored under an entry's directory. */
export const libraryFileSchema = z.strictObject({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  addedAt: epochMillis,
})

/** Runtime schema for one `sci_library_entry` row. */
export const libraryEntrySchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['paper', 'dataset', 'note']),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  year: z.number().int().optional(),
  venue: z.string().min(1).optional(),
  abstract: z.string().min(1).optional(),
  doi: z.string().min(1).optional(),
  arxivId: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  pdfUrl: z.string().min(1).optional(),
  citedBy: z.number().int().nonnegative().optional(),
  sources: z.array(z.enum(['openalex', 'semanticscholar', 'arxiv', 'crossref', 'manual', 'upload'])),
  tags: z.array(z.string().min(1)),
  status: z.enum(['unread', 'reading', 'read', 'verified', 'low-confidence']),
  note: z.string().min(1).optional(),
  files: z.array(libraryFileSchema),
  addedAt: epochMillis,
  updatedAt: epochMillis,
}) as unknown as z.ZodType<LibraryEntry>

/** Table name of the knowledge base, matching the persistence model. */
export const ENTRY_TABLE = 'sci_library_entry'

/** The knowledge base, one row per entry. */
export const sciLibraryDomainSpec = defineDomain({
  name: 'sci_library',
  version: 0,
  tables: {
    [ENTRY_TABLE]: domainTable<string, LibraryEntry>(libraryEntrySchema),
  },
})
