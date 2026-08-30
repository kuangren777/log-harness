/** Citation and BibTeX builders the citation-pool suites share. */

import type { BibEntry, Citation } from '../src/types.ts'

/** Fixed clock the fixtures date from, so ordering is authored rather than observed. */
export const T0 = 1_700_000_000_000

/** The project slug every fixture belongs to. */
export const PROJECT = 'snse'

/**
 * One stored citation with every required column filled.
 * @param overrides - the columns this case cares about.
 * @returns the citation.
 */
export function citation(overrides: { [K in keyof Citation]?: Citation[K] | undefined } = {}): Citation {
  return {
    id: `${PROJECT}:zhao2015`,
    project: PROJECT,
    citekey: 'zhao2015',
    title: 'Ultralow thermal conductivity in SnSe crystals',
    authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
    year: 2015,
    venue: 'Nature',
    doi: '10.1038/nature13184',
    sources: ['openalex', 'crossref'],
    group: 'ungrouped',
    confidence: 90,
    quarantined: false,
    uses: 0,
    addedAt: T0,
    updatedAt: T0,
    ...overrides,
    // The mapped overrides type admits explicit undefined so a case can blank a
    // default; the widened literal narrows back to the row shape.
  } as Citation
}

/**
 * One parsed BibTeX entry.
 * @param overrides - the fields this case cares about.
 * @returns the entry.
 */
export function bibEntry(overrides: Partial<BibEntry> = {}): BibEntry {
  return {
    type: 'article',
    key: 'zhao2015',
    fields: { title: 'Ultralow thermal conductivity in SnSe crystals', year: '2015', journal: 'Nature' },
    authors: ['Zhao, Li-Dong'],
    ...overrides,
  }
}
