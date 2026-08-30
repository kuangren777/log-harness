/**
 * Deployment-varying policy of the citation layer, plus the paper-bundle
 * layout constants that are NOT policy.
 *
 * `projectRoot` varies per sandbox image, so it is configuration. The names
 * `papers/`, `src/`, `refs.bib`, and `workspace/` do not: they are the paper
 * bundle contract every `sci-paper` skill run writes, so a deployment that
 * renamed them would already have broken the skill, not just this layer.
 * @module @deepseek-ai/dsh-sci-citations/src/config
 */

import z from '@deepseek-ai/schemastery'

/** Absolute directory holding one subdirectory per project. */
export const DEFAULT_PROJECT_ROOT = '/home/user/sci/projects'

/** Largest `.md`/`.tex` file the in-text scan reads, in bytes. */
export const DEFAULT_SCAN_MAX_BYTES = 2_000_000

/** Citations one project's pool may hold before `add` refuses. */
export const DEFAULT_MAX_CITATIONS = 2000

/** Project-relative directory holding paper bundles, one `<slug>/` per manuscript. */
export const PAPERS_DIR = 'papers'

/** Bundle-relative directory holding the LaTeX tree and its bibliography. */
export const PAPER_SRC_DIR = 'src'

/** Bibliography file name inside a paper bundle's source tree. */
export const REFS_FILE = 'refs.bib'

/** Project-relative delivery directory, also scanned for in-text citations. */
export const DELIVERY_DIR = 'workspace'

/** Directory names the recursive scan never descends into. */
export const SCAN_SKIP_DIRS: readonly string[] = ['node_modules', '.git', 'versions']

/** How many directory levels below a scan root are visited. */
export const SCAN_MAX_DEPTH = 4

/** File extensions the in-text scan reads. */
export const SCAN_EXTENSIONS: readonly string[] = ['.md', '.tex']

/** Group key a citation carries when the user filed it nowhere. */
export const UNGROUPED = 'ungrouped'

/** Reserved group key for entries held back from the manuscript. */
export const QUARANTINE = 'quarantine'

/** Confidence below which a citation is quarantined without anyone saying so. */
export const QUARANTINE_BELOW = 70

/** Deployment-varying policy of the citation layer. */
export interface Config {
  /**
   * Absolute directory holding one subdirectory per project. Required in
   * spirit but defaulted here, because the sci sandbox image fixes the layout
   * and a composition that mounts this layer at all has that image.
   */
  projectRoot: string
  /** Largest `.md`/`.tex` file the in-text scan reads, in bytes. */
  scanMaxBytes: number
  /** Citations one project's pool may hold before `add` refuses. */
  maxCitations: number
}

/** Loader validation for the citation layer's deployment policy. */
export const Config: z<Config> = z.object({
  projectRoot: z.string().default(DEFAULT_PROJECT_ROOT),
  scanMaxBytes: z.number().step(1).min(1).default(DEFAULT_SCAN_MAX_BYTES),
  maxCitations: z.number().step(1).min(1).default(DEFAULT_MAX_CITATIONS),
})
