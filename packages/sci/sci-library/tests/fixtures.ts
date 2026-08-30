/** Entry builders the knowledge-base suites share. */

import type { LibraryEntry, LibraryFile } from '../src/types.ts'

/** Fixed clock the fixtures date from, so `updatedAt` ordering is authored, not observed. */
export const T0 = 1_700_000_000_000

/**
 * One stored entry with every required column filled.
 * @param overrides - the columns this case cares about.
 * @returns the entry.
 */
export function entry(overrides: { [K in keyof LibraryEntry]?: LibraryEntry[K] | undefined } = {}): LibraryEntry {
  return {
    id: 'doi:10.1103/physrevb.91.205201',
    kind: 'paper',
    title: 'Thermoelectric transport in n-type SnSe',
    authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
    sources: ['openalex'],
    tags: [],
    status: 'unread',
    files: [],
    addedAt: T0,
    updatedAt: T0,
    ...overrides,
    // The mapped overrides type admits explicit undefined so a case can blank a
    // default; the widened literal narrows back to the entry shape.
  } as LibraryEntry
}

/**
 * One stored file record.
 * @param overrides - the columns this case cares about.
 * @returns the file record.
 */
export function file(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    path: 'doi-10.1103-physrevb.91.205201/paper.pdf',
    name: 'paper.pdf',
    size: 1024,
    mediaType: 'application/pdf',
    sha256: 'a'.repeat(64),
    addedAt: T0,
    ...overrides,
  }
}
