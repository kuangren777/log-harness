/**
 * Record fixtures shared by the view, hits, and bibtex suites: one fully
 * populated record and one carrying only the fields every record must have,
 * so both the complete card and its every-field-absent form come from the
 * same shape rather than from per-suite literals.
 */
import type { LiteratureRecord, LiteratureSearchResult } from '../src/client/contract.ts'

/** A record with every optional field present. */
export const FULL: LiteratureRecord = {
  id: 'doi:10.1038/s41586-024-07001-2',
  title: 'Halide doping raises the zT of n-type SnSe above 2.4',
  authors: ['Zhao, Li-Dong', 'Chang, Cheng', 'Wang, Dongyang', 'Qin, Bingchao'],
  year: 2024,
  venue: 'Nature',
  abstract: 'A'.repeat(320),
  doi: '10.1038/s41586-024-07001-2',
  arxivId: '2607.09182',
  url: 'https://doi.org/10.1038/s41586-024-07001-2',
  pdfUrl: 'https://example.org/snse.pdf',
  citedBy: 187,
  source: 'openalex',
  sources: ['openalex', 'crossref'],
}

/** A record carrying only the required fields. */
export const BARE: LiteratureRecord = {
  id: 'title:9e1c',
  title: 'Grain-boundary engineering of selenide thermoelectrics',
  authors: [],
  url: 'https://arxiv.org/abs/2608.00011',
  source: 'arxiv',
  sources: ['arxiv'],
}

/**
 * Build one settled search result around the given records.
 * @param records - the records the host returned.
 * @param sourceErrors - the sources that failed, if any.
 * @returns the result as the view consumes it.
 */
export function resultOf(
  records: readonly LiteratureRecord[],
  sourceErrors: LiteratureSearchResult['sourceErrors'] = [],
): LiteratureSearchResult {
  return { records, total: records.length, sourceErrors, elapsedMs: 1840 }
}
