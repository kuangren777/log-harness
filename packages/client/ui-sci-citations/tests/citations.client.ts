/**
 * Pool fixtures shared by the view, derivation, and plugin suites: three
 * citations that between them carry every optional field and every confidence
 * tone, so both the complete row and its every-field-absent form come from
 * the same shape rather than from per-suite literals.
 */
import type { Citation, CitationGroup, CitationPool, CitationProject } from '../src/client/contract.ts'

/** The fixture project every pool below belongs to. */
export const PROJECT = 'thermo-2026'

/** The projects the fake host offers. */
export const PROJECTS: readonly CitationProject[] = [
  { slug: PROJECT, papers: ['review'] },
  { slug: 'perovskite-2025', papers: [] },
]

/** Two groups: one with a host-chosen color, one the host left uncolored. */
export const GROUPS: readonly CitationGroup[] = [
  { project: PROJECT, key: 'halogen', label: '卤素掺杂', color: '#5ea2ff', order: 10 },
  { project: PROJECT, key: 'defect', label: '缺陷工程', color: '', order: 20 },
]

/** A citation with every optional field present, at the high tone. */
export const ZHAO: Citation = {
  id: `${PROJECT}:zhao2024`,
  project: PROJECT,
  citekey: 'zhao2024',
  libraryId: 'lib-1',
  title: 'Halide doping raises the zT of n-type SnSe above 2.4',
  authors: ['Zhao, Li-Dong', 'Chang, Cheng'],
  year: 2024,
  venue: 'Nature',
  doi: '10.1038/s41586-024-07001-2',
  arxivId: '2607.09182',
  url: 'https://doi.org/10.1038/s41586-024-07001-2',
  sources: ['openalex', 'crossref'],
  group: 'halogen',
  confidence: 96,
  quarantined: false,
  uses: 7,
  lastScanAt: 1_700_000_000_000,
  note: '主线证据',
  addedAt: 1,
  updatedAt: 2,
}

/** A citation with no venue and no DOI, at the middle tone. */
export const QIN: Citation = {
  id: `${PROJECT}:qin2025`,
  project: PROJECT,
  citekey: 'qin2025',
  title: 'Grain-boundary engineering of selenide thermoelectrics',
  authors: ['Qin, Bingchao'],
  year: 2025,
  sources: ['arxiv'],
  group: 'defect',
  confidence: 78,
  quarantined: false,
  uses: 2,
  addedAt: 3,
  updatedAt: 4,
}

/** A bib-only citation carrying no year and no author, quarantined. */
export const BARE: Citation = {
  id: `${PROJECT}:wang`,
  project: PROJECT,
  citekey: 'wang',
  title: 'Unreviewed preprint on SnSe single crystals',
  authors: [],
  sources: [],
  group: 'ungrouped',
  confidence: 42,
  quarantined: true,
  uses: 0,
  addedAt: 5,
  updatedAt: 6,
}

/**
 * One pool around the given citations, with the stats a host would report.
 * @param citations - the pool's citations.
 * @param groups - the project's groups.
 * @param scannedFiles - files the last scan read.
 * @returns the pool as the view consumes it.
 */
export function poolOf(
  citations: readonly Citation[] = [ZHAO, QIN, BARE],
  groups: readonly CitationGroup[] = GROUPS,
  scannedFiles = 12,
): CitationPool {
  const total = citations.length
  const sum = citations.reduce((carry, row) => carry + row.confidence, 0)
  return {
    project: PROJECT,
    groups,
    citations,
    stats: {
      total,
      avgConfidence: total === 0 ? 0 : Math.round(sum / total),
      quarantined: citations.filter(row => row.quarantined).length,
      scannedFiles,
      lastScanAt: 1_700_000_000_000,
    },
  }
}
