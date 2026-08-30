/**
 * Entry fixtures shared by the view, detail, hits, and bibtex suites: one
 * fully populated paper with both a stored PDF and a stored data file, one
 * dataset carrying only the fields every entry must have, and a page builder
 * over them — so the complete card and its every-field-absent form come from
 * the same shape rather than from per-suite literals.
 */
import type { LibraryEntry, LibraryFile, LibraryPage } from '../src/client/contract.ts'

/** The stored PDF of the fully populated entry. */
export const PDF_FILE: LibraryFile = {
  path: 'doi-10.1038-s41586-024-07001-2/snse.pdf',
  name: 'snse.pdf',
  size: 2_400_000,
  mediaType: 'application/pdf',
  sha256: 'a'.repeat(64),
  addedAt: 1_724_000_000_000,
}

/** The stored data file of the fully populated entry. */
export const CSV_FILE: LibraryFile = {
  path: 'doi-10.1038-s41586-024-07001-2/zt.csv',
  name: 'zt.csv',
  size: 4_096,
  mediaType: 'text/csv',
  sha256: 'b'.repeat(64),
  addedAt: 1_724_000_100_000,
}

/** A stored file too large for the inline preview. */
export const HUGE_FILE: LibraryFile = {
  path: 'doi-10.1038-s41586-024-07001-2/raw.parquet',
  name: 'raw.parquet',
  size: 40_000_000,
  mediaType: 'application/octet-stream',
  sha256: 'c'.repeat(64),
  addedAt: 1_724_000_200_000,
}

/** An entry with every optional field present. */
export const FULL: LibraryEntry = {
  id: 'doi:10.1038/s41586-024-07001-2',
  kind: 'paper',
  title: 'Halide doping raises the zT of n-type SnSe above 2.4',
  authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
  year: 2024,
  venue: 'Nature',
  abstract: 'A'.repeat(160),
  doi: '10.1038/s41586-024-07001-2',
  arxivId: '2607.09182',
  url: 'https://doi.org/10.1038/s41586-024-07001-2',
  pdfUrl: 'https://example.org/snse.pdf',
  citedBy: 187,
  sources: ['openalex', 'crossref'],
  tags: ['thermoelectric', 'snse', 'doping'],
  status: 'reading',
  note: '和 3.2 节的对照实验相关。',
  files: [PDF_FILE, CSV_FILE],
  addedAt: 1_723_900_000_000,
  updatedAt: 1_724_000_100_000,
}

/** An entry carrying only the fields every entry must have. */
export const BARE: LibraryEntry = {
  id: 'file:9e1c',
  kind: 'dataset',
  title: 'grain-boundary-scan.csv',
  authors: [],
  sources: ['upload'],
  tags: [],
  status: 'unread',
  files: [],
  addedAt: 1_723_800_000_000,
  updatedAt: 1_723_800_000_000,
}

/**
 * Build one settled page around the given entries.
 * @param entries - the entries the host returned.
 * @param overrides - page members this case states itself.
 * @returns the page as the view consumes it.
 */
export function pageOf(
  entries: readonly LibraryEntry[],
  overrides: Partial<LibraryPage> = {},
): LibraryPage {
  return {
    entries,
    total: entries.length,
    tags: [{ tag: 'thermoelectric', count: 4 }, { tag: 'snse', count: 2 }],
    counts: { all: 6, paper: 4, dataset: 2, note: 0, lowConfidence: 1 },
    ...overrides,
  }
}
