/**
 * The citation pool's data vocabulary.
 *
 * Every member here is JSON-compatible: the components see plain records and
 * callbacks, never an RPC envelope, so the whole wire seam is the `apply`
 * body that builds {@link SciCitationsInjected}.
 *
 * The record types below MIRROR `packages/sci/sci-citations/src/types.ts`
 * (spec 16-Workbench/10-spec-citations.md §2.1) verbatim. They live here only
 * until that host package lands in the tree; the assembly step then replaces
 * this block with `import type { … } from '@deepseek-ai/dsh-sci-citations/types'`
 * and switches the namespace face to the generated `ctx.remote['sci.citations']`
 * declaration, which this package cannot pull before the generator has run.
 */

/** One user-defined bucket of a project's pool. */
export interface CitationGroup {
  /** Project slug this group belongs to. */
  project: string
  /** Stable key the citations reference; never the label. */
  key: string
  /** Display name as the user typed it. */
  label: string
  /** Dot color as the host stores it; an empty string draws the neutral dot. */
  color: string
  /** Position in the left column, ascending. */
  order: number
}

/** One citation of one project's pool. */
export interface Citation {
  /** Stable id, `${project}:${citekey}`. */
  id: string
  /** Project slug this citation belongs to. */
  project: string
  /** BibTeX cite key, the handle every gesture takes. */
  citekey: string
  /** `sci_library` entry id, when the host resolved one. */
  libraryId?: string
  /** Work title as the winning source gives it. */
  title: string
  /** "Family, Given" as the source gives. */
  authors: readonly string[]
  /** Publication year, when known. */
  year?: number
  /** Journal, conference, or repository name. */
  venue?: string
  /** Lowercase DOI with no url prefix. */
  doi?: string
  /** arXiv identifier. */
  arxivId?: string
  /** Canonical landing page, when known. */
  url?: string
  /** Every source that reported this work, or `['bib']` when only refs.bib did. */
  sources: readonly string[]
  /** Group key; `ungrouped` by default. */
  group: string
  /** Deterministic 0..100 score the host computed. */
  confidence: number
  /** Whether the host is holding this citation out of the deliverable. */
  quarantined: boolean
  /** How many times the project's prose cites this key. */
  uses: number
  /** Epoch milliseconds of the scan that produced `uses`. */
  lastScanAt?: number
  /** Free-text note the user or the model left. */
  note?: string
  /** Epoch milliseconds this citation entered the pool. */
  addedAt: number
  /** Epoch milliseconds of the last write. */
  updatedAt: number
}

/** What the header reads: the pool's own counts, never a client recount. */
export interface CitationPoolStats {
  /** Citations in the pool. */
  total: number
  /** Mean confidence over the pool, already rounded by the host. */
  avgConfidence: number
  /** Citations the host is holding out. */
  quarantined: number
  /** Files the last scan read. */
  scannedFiles: number
  /** Epoch milliseconds of the last scan. */
  lastScanAt?: number
}

/** One project's whole pool, as one Remote answer. */
export interface CitationPool {
  /** Project slug this pool belongs to. */
  project: string
  /** The project's groups, in the host's order. */
  groups: readonly CitationGroup[]
  /** The project's citations. */
  citations: readonly Citation[]
  /** The header's counts. */
  stats: CitationPoolStats
}

/** One paper project the pool selector offers. */
export interface CitationProject {
  /** Directory name under the host's project root. */
  slug: string
  /** Paper directories inside it. */
  papers: readonly string[]
}

/**
 * A settled pool read or write as the view consumes it: a total vocabulary,
 * so an unreachable host, a rejected request, and an unmounted namespace all
 * arrive as data rather than as a throw inside an event handler.
 */
export type PoolOutcome =
  | { ok: true; pool: CitationPool }
  | { ok: false; code: string }

/** A settled BibTeX export, in the same total vocabulary. */
export type BibtexOutcome =
  | { ok: true; bibtex: string }
  | { ok: false; code: string }

/**
 * The injected face the view drives; every member is built in `apply`.
 *
 * Declared as properties rather than methods because the view destructures
 * them out of its props: a method position would bind them to this face.
 *
 * Every mutating member answers with the pool the host reports AFTER the
 * write — `apply` re-reads it rather than trusting a mutation's own return —
 * so the view never has to guess what a group rename or a move did to the
 * counts it draws.
 */
export interface SciCitationsInjected {
  /** The paper projects the host can open a pool for. */
  readonly projects: () => Promise<readonly CitationProject[]>
  /** Read one project's pool. */
  readonly pool: (project: string) => Promise<PoolOutcome>
  /** Create one group from the label the user typed. */
  readonly createGroup: (project: string, label: string) => Promise<PoolOutcome>
  /** Delete one group; its citations return to `ungrouped`. */
  readonly removeGroup: (project: string, key: string) => Promise<PoolOutcome>
  /** Move one citation into one group. */
  readonly move: (project: string, citekey: string, group: string) => Promise<PoolOutcome>
  /** Drop one citation from the pool. */
  readonly remove: (project: string, citekey: string) => Promise<PoolOutcome>
  /** Re-read `refs.bib` and re-count the prose citations. */
  readonly rescan: (project: string) => Promise<PoolOutcome>
  /** Render the project's (or one group's) BibTeX. */
  readonly exportBibtex: (project: string, group?: string) => Promise<BibtexOutcome>
}
