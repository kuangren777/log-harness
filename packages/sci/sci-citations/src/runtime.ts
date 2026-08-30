/**
 * `ctx.sciCitations` — one citation pool per paper project: the entries, the
 * groups a person filed them into, the deterministic confidence, and the
 * in-text use counts read out of the manuscript itself.
 *
 * Two rules shape every method here. The bibliography on disk is authoritative
 * for what the paper cites, so `add` writes `refs.bib` and `rescan` reads it
 * back rather than treating the tables as the truth. And a decision a person
 * made — the group, the note, a hand-set quarantine — survives every rescan,
 * because re-reading a file is not new information about what someone meant.
 * @module @deepseek-ai/dsh-sci-citations/src/runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { parseBibtex, removeBibtexEntry, upsertBibtexEntry } from './bibtex.ts'
import { citekeyBase, normalizeCitekey, uniqueCitekey } from './citekey.ts'
import { confidence } from './confidence.ts'
import {
  Config,
  DELIVERY_DIR,
  PAPERS_DIR,
  PAPER_SRC_DIR,
  QUARANTINE,
  REFS_FILE,
  UNGROUPED,
} from './config.ts'
import {
  CitationsError,
  CITATIONS_INVALID_REQUEST,
  CITATIONS_POOL_FULL,
  CITATIONS_UNKNOWN_CITEKEY,
  CITATIONS_UNKNOWN_GROUP,
  CITATIONS_UNKNOWN_PROJECT,
} from './error.ts'
import {
  joinPath,
  listDirEntries,
  readTextIfPresent,
  scanTextFiles,
  statPath,
  writeTextFile,
} from './fs-scan.ts'
import type { CitationFileSystem } from './fs-scan.ts'
import {
  bibEntryFromCitation,
  citationFromBib,
  citationId,
  citationRow,
  groupKeyFromLabel,
  groupRowKey,
  mergeBibEntry,
  normalizeDoi,
  paletteColor,
  poolStats,
  quarantineFlag,
  quarantineFloor,
  renderBibtexFile,
  sortCitations,
  sortGroups,
} from './pool.ts'
import { assertProjectSlug } from './project.ts'
import { resolveWork } from './resolve.ts'
import { countUses } from './scan.ts'
import { CITATION_GROUP_TABLE, CITATION_TABLE, sciCitationsDomainSpec } from './spec.ts'
import { applyCitationsTool } from './tool.ts'
import type {
  Citation,
  CitationAddRequest,
  CitationAddResult,
  CitationExportRequest,
  CitationExportResult,
  CitationGroup,
  CitationGroupRemoveRequest,
  CitationGroupUpsertRequest,
  CitationMoveRequest,
  CitationOkResult,
  CitationParseError,
  CitationPool,
  CitationPoolRequest,
  CitationProject,
  CitationProjectsResult,
  CitationRemoveRequest,
  CitationRescanRequest,
  CitationRescanResult,
  CitationUpdateRequest,
  ScannedFile,
} from './types.ts'

/** Cordis service key of this package. */
export const SERVICE_KEY = 'sciCitations'

/** Wire namespace the citation endpoints are exported under. */
export const CITATIONS_NAMESPACE = 'sci.citations'

/** Group keys every project has without anyone creating them. */
export const RESERVED_GROUPS: readonly string[] = [UNGROUPED, QUARANTINE]

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciCitations: CitationsRuntime
  }
}

/**
 * One paper project's citation pool. The service reads and writes files inside
 * the project it was asked about and never creates, resumes, or drives an
 * Agent or Session.
 */
export class CitationsRuntime extends TypertRemoteService {
  static inject = ['fs', 'storageDomain', 'systemPrompt', 'tools']

  /** Loader validation for the citation layer's deployment policy. */
  static Config: z<Config> = Config

  /** The resolved deployment configuration; the tool reads `projectRoot` from it. */
  readonly config: Config

  /** Assigned by `Service.init` before Cordis publishes the service. */
  private citations!: KvTable<string, Citation>
  /** Assigned by `Service.init` before Cordis publishes the service. */
  private groups!: KvTable<string, CitationGroup>

  /**
   * Files the last `rescan` of each project read, in THIS process.
   *
   * The count is a header ornament, not a fact about the pool: it is what the
   * scan happened to walk, it changes with nothing but the files, and it is
   * recovered by pressing rescan. Persisting it would mean a third table whose
   * only column is a number nobody can act on, so it lives here and reads `0`
   * until the first scan of a fresh process.
   */
  private readonly scans = new Map<string, { files: number; at: number }>()

  /**
   * @param ctx - Host context carrying the filesystem and storage-domain seams.
   * @param config - the resolved deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // CITATIONS_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciCitations', { namespace: 'sci.citations' })
    this.config = config
  }

  /**
   * Open the two tables, then register the tools that serve from them.
   *
   * The tools are registered here rather than by a second Loader row so that
   * one composition entry mounts the whole layer, and AFTER the tables open so
   * a call cannot reach a service whose pool has no medium.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sciCitationsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sci-citations.domainClose')
    this.citations = domain.table(CITATION_TABLE)
    this.groups = domain.table(CITATION_GROUP_TABLE)
    applyCitationsTool(this.ctx, this)
  }

  /** The filesystem seam, narrowed to the five calls this package makes. */
  private get fs(): CitationFileSystem {
    return this.ctx.fs
  }

  /**
   * Every project directory, with the paper bundles inside each.
   * @returns the projects in listing order; an absent `projectRoot` yields none.
   */
  @Remote('projects')
  async projects(): Promise<CitationProjectsResult> {
    const projects: CitationProject[] = []
    for (const entry of await listDirEntries(this.fs, this.config.projectRoot)) {
      if (entry.type !== 'directory') continue
      projects.push({ slug: entry.name, papers: await this.paperSlugs(entry.name) })
    }
    return { projects }
  }

  /**
   * One project's whole pool as it stands, with no file access.
   * @param request - the project to read.
   * @returns the groups, the citations, and the header counters.
   * @throws CitationsError `CITATIONS_INVALID_REQUEST` for a slug that is not a directory name.
   */
  @Remote('pool')
  pool(request: CitationPoolRequest): Promise<CitationPool> {
    return Promise.resolve(this.poolOf(assertProjectSlug(request.project)))
  }

  /**
   * Create a group, or rename and recolor an existing one.
   * @param request - the project, the optional key, the label, and the optional color.
   * @returns the stored group.
   * @throws CitationsError `CITATIONS_INVALID_REQUEST` for a blank label or a reserved key.
   */
  @Remote('upsertGroup')
  async upsertGroup(request: CitationGroupUpsertRequest): Promise<CitationGroup> {
    const project = assertProjectSlug(request.project)
    const label = request.label.trim()
    if (label === '') throw new CitationsError('分组需要一个名称', CITATIONS_INVALID_REQUEST)
    const key = (request.key ?? groupKeyFromLabel(label)).trim()
    if (RESERVED_GROUPS.includes(key)) {
      throw new CitationsError(`分组名 ${key} 是保留名，不能新建`, CITATIONS_INVALID_REQUEST)
    }
    const rowKey = groupRowKey(project, key)
    const existing = this.groups.get(rowKey)
    const order = existing?.order ?? this.groupsOf(project).length
    const group: CitationGroup = {
      project,
      key,
      label,
      color: request.color ?? existing?.color ?? paletteColor(order),
      order,
    }
    await this.groups.put(rowKey, group)
    return group
  }

  /**
   * Drop a group; its citations return to `ungrouped`.
   * @param request - the project and the group key.
   * @returns `{ ok: true }` once the group is absent.
   * @throws CitationsError `CITATIONS_INVALID_REQUEST` for a reserved key.
   */
  @Remote('removeGroup')
  async removeGroup(request: CitationGroupRemoveRequest): Promise<CitationOkResult> {
    const project = assertProjectSlug(request.project)
    if (RESERVED_GROUPS.includes(request.key)) {
      throw new CitationsError(`分组 ${request.key} 是保留名，不能删除`, CITATIONS_INVALID_REQUEST)
    }
    const now = Date.now()
    for (const citation of this.citationsOf(project)) {
      if (citation.group !== request.key) continue
      await this.citations.put(citation.id, citationRow({ ...citation, group: UNGROUPED, updatedAt: now }))
    }
    await this.groups.delete(groupRowKey(project, request.key))
    return { ok: true }
  }

  /**
   * File one citation into another group.
   *
   * `quarantine` is a group AND a flag, so moving into it raises the flag and
   * moving out of it lowers one the move itself set; a citation moved between
   * two ordinary groups keeps whatever flag it had. Moving a citation that
   * scores below the threshold out of `quarantine` refiles it without releasing
   * it, because the automatic half of the flag is not the move's to lower.
   * @param request - the project, the citekey, and the destination group.
   * @returns `{ ok: true }` once the citation is filed.
   * @throws CitationsError `CITATIONS_UNKNOWN_CITEKEY` or `CITATIONS_UNKNOWN_GROUP`.
   */
  @Remote('move')
  async move(request: CitationMoveRequest): Promise<CitationOkResult> {
    const project = assertProjectSlug(request.project)
    const citation = this.requireCitation(project, request.citekey)
    this.assertGroup(project, request.group)
    const quarantined = request.group === QUARANTINE
      ? true
      : citation.group === QUARANTINE ? false : citation.quarantined
    await this.citations.put(citation.id, citationRow({
      ...citation,
      group: request.group,
      quarantined: quarantineFloor(citation.confidence, quarantined),
      updatedAt: Date.now(),
    }))
    return { ok: true }
  }

  /**
   * Put one work in the pool and in the manuscript's bibliography.
   *
   * The work is resolved before anything is written, so a DOI no index holds
   * produces an error rather than a citekey pointing at nothing. The row is
   * then stored and the first paper bundle's `refs.bib` is updated in place.
   * @param request - the project plus whatever identifies the work.
   * @returns the stored citation and whether the citekey was new.
   * @throws CitationsError `CITATIONS_UNKNOWN_PROJECT`, `CITATIONS_UNRESOLVED`,
   *   `CITATIONS_UNKNOWN_GROUP`, `CITATIONS_INVALID_REQUEST`, or
   *   `CITATIONS_POOL_FULL` when the project is already at `maxCitations`.
   */
  @Remote('add')
  async add(request: CitationAddRequest): Promise<CitationAddResult> {
    const project = assertProjectSlug(request.project)
    await this.assertProjectExists(project)
    const resolved = await resolveWork(this.ctx, {
      ...request.libraryId === undefined ? {} : { libraryId: request.libraryId },
      ...request.record === undefined ? {} : { record: request.record },
      ...request.doi === undefined ? {} : { doi: request.doi },
      ...request.arxivId === undefined ? {} : { arxivId: request.arxivId },
    })
    const record = resolved.record
    const authors = [...(record.authors ?? [])]
    const rows = this.citationsOf(project)
    const taken = new Set(rows.map(citation => citation.citekey))
    // The same work added twice must converge on one row: identity is the
    // work's own identifier, not the minted citekey, so a repeat add (a bare
    // DOI after a doi:-prefixed one, a record after a plain doi) updates the
    // existing citation instead of minting a suffixed twin.
    const doiKey = normalizeDoi(record.doi)
    const twin = request.citekey !== undefined
      ? undefined
      : rows.find(row => (doiKey !== undefined && normalizeDoi(row.doi) === doiKey)
        || (record.arxivId !== undefined && row.arxivId === record.arxivId))
    const citekey = request.citekey !== undefined
      ? normalizeCitekey(request.citekey)
      : twin !== undefined
        ? twin.citekey
        : uniqueCitekey(citekeyBase(authors, record.year), taken)
    if (citekey === '') throw new CitationsError('citekey 不能为空', CITATIONS_INVALID_REQUEST)
    const group = request.group ?? UNGROUPED
    this.assertGroup(project, group)

    const existing = this.citations.get(citationId(project, citekey))
    if (existing === undefined && taken.size >= this.config.maxCitations) {
      throw new CitationsError(`引用池已满（上限 ${this.config.maxCitations} 条）`, CITATIONS_POOL_FULL)
    }
    const now = Date.now()
    const sources = [...record.sources]
    const score = confidence({
      sources,
      ...record.year === undefined ? {} : { year: record.year },
      ...record.citedBy === undefined ? {} : { citedBy: record.citedBy },
      ...record.venue === undefined ? {} : { venue: record.venue },
      ...record.doi === undefined ? {} : { doi: record.doi },
      ...resolved.libraryStatus === undefined ? {} : { libraryStatus: resolved.libraryStatus },
    })
    const citation = citationRow({
      id: citationId(project, citekey),
      project,
      citekey,
      ...resolved.libraryId === undefined ? {} : { libraryId: resolved.libraryId },
      title: record.title,
      authors,
      ...record.year === undefined ? {} : { year: record.year },
      ...record.venue === undefined ? {} : { venue: record.venue },
      ...record.doi === undefined ? {} : { doi: record.doi },
      ...record.arxivId === undefined ? {} : { arxivId: record.arxivId },
      ...record.url === undefined ? {} : { url: record.url },
      sources,
      group: existing === undefined ? group : existing.group,
      confidence: score,
      quarantined: quarantineFlag(existing, score),
      uses: existing?.uses ?? 0,
      ...existing?.lastScanAt === undefined ? {} : { lastScanAt: existing.lastScanAt },
      ...existing?.note === undefined ? {} : { note: existing.note },
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
    })
    await this.citations.put(citation.id, citation)
    await this.writeBib(project, citation)
    return { citation, created: existing === undefined }
  }

  /**
   * Change the part of a citation a person owns.
   *
   * `quarantined: false` on a row scoring below the threshold refiles nothing:
   * the flag's automatic half stands, and the returned row shows it still set.
   * @param request - the project, the citekey, and the fields to change.
   * @returns the stored citation.
   * @throws CitationsError `CITATIONS_UNKNOWN_CITEKEY` or `CITATIONS_UNKNOWN_GROUP`.
   */
  @Remote('update')
  async update(request: CitationUpdateRequest): Promise<Citation> {
    const project = assertProjectSlug(request.project)
    const citation = this.requireCitation(project, request.citekey)
    const patch = request.patch
    if (patch.group !== undefined) this.assertGroup(project, patch.group)
    const next = citationRow({
      ...citation,
      ...patch.group === undefined ? {} : { group: patch.group },
      ...patch.quarantined === undefined
        ? {}
        : { quarantined: quarantineFloor(citation.confidence, patch.quarantined) },
      ...patch.note === undefined ? {} : { note: patch.note },
      updatedAt: Date.now(),
    })
    await this.citations.put(next.id, next)
    return next
  }

  /**
   * Drop one citation from the pool, and optionally from every `refs.bib`.
   * @param request - the project, the citekey, and whether the bibliography follows.
   * @returns `{ ok: true }` once the citation is absent.
   * @throws CitationsError `CITATIONS_UNKNOWN_CITEKEY`.
   */
  @Remote('removeCitation')
  async removeCitation(request: CitationRemoveRequest): Promise<CitationOkResult> {
    const project = assertProjectSlug(request.project)
    const citation = this.requireCitation(project, request.citekey)
    await this.citations.delete(citation.id)
    if (request.alsoBib === true) {
      for (const paper of await this.paperSlugs(project)) {
        const path = this.refsPath(project, paper)
        const current = await readTextIfPresent(this.fs, path)
        if (current === undefined) continue
        const next = removeBibtexEntry(current, citation.citekey)
        if (next !== current) await writeTextFile(this.fs, path, next)
      }
    }
    return { ok: true }
  }

  /**
   * Re-read the project from disk: every `refs.bib`, then every `.md` and
   * `.tex` the citekeys could appear in.
   * @param request - the project to re-read.
   * @returns the merged pool and one entry per unreadable `refs.bib` block.
   * @throws CitationsError `CITATIONS_UNKNOWN_PROJECT` when the project has no directory.
   */
  @Remote('rescan')
  async rescan(request: CitationRescanRequest): Promise<CitationRescanResult> {
    const project = assertProjectSlug(request.project)
    await this.assertProjectExists(project)
    const now = Date.now()
    const papers = await this.paperSlugs(project)
    const parseErrors = await this.mergeBibliographies(project, papers, now)
    const files = await this.scanProject(project, papers)
    const counts = countUses(files, this.citationsOf(project).map(citation => citation.citekey))
    for (const citation of this.citationsOf(project)) {
      // countUses answers for every citekey it was given, so the lookup is total.
      const uses = counts[citation.citekey] as number
      await this.citations.put(citation.id, citationRow({ ...citation, uses, lastScanAt: now }))
    }
    this.scans.set(project, { files: files.length, at: now })
    return { pool: this.poolOf(project), parseErrors }
  }

  /**
   * Render the pool, or one group of it, as a BibTeX file.
   * @param request - the project and the optional group filter.
   * @returns the file text; empty when the selection is empty.
   */
  @Remote('exportBibtex')
  exportBibtex(request: CitationExportRequest): Promise<CitationExportResult> {
    const project = assertProjectSlug(request.project)
    const selected = this.citationsOf(project)
      .filter(citation => request.group === undefined || citation.group === request.group)
    return Promise.resolve({ bibtex: renderBibtexFile(sortCitations(selected)) })
  }

  /**
   * Fold every paper bundle's `refs.bib` into the tables.
   * @param project - the project slug.
   * @param papers - the bundle slugs to read.
   * @param now - epoch milliseconds to stamp new and merged rows with.
   * @returns one entry per unreadable block, located by file and line.
   */
  private async mergeBibliographies(
    project: string,
    papers: readonly string[],
    now: number,
  ): Promise<CitationParseError[]> {
    const parseErrors: CitationParseError[] = []
    for (const paper of papers) {
      const path = this.refsPath(project, paper)
      const text = await readTextIfPresent(this.fs, path)
      if (text === undefined) continue
      const parsed = parseBibtex(text)
      for (const error of parsed.errors) parseErrors.push({ path, line: error.line, message: error.message })
      for (const entry of parsed.entries) {
        if (entry.key === '') continue
        const id = citationId(project, entry.key)
        const existing = this.citations.get(id)
        await this.citations.put(id, existing === undefined
          ? citationFromBib(project, entry, now)
          : mergeBibEntry(existing, entry, now))
      }
    }
    return parseErrors
  }

  /**
   * Read every file a citekey could appear in.
   * @param project - the project slug.
   * @param papers - the bundle slugs to walk.
   * @returns the manuscripts' sources and the delivery directory's Markdown.
   */
  private async scanProject(project: string, papers: readonly string[]): Promise<ScannedFile[]> {
    const files: ScannedFile[] = []
    for (const paper of papers) {
      files.push(...await scanTextFiles(
        this.fs,
        joinPath(this.projectDir(project), PAPERS_DIR, paper, PAPER_SRC_DIR),
        { maxBytes: this.config.scanMaxBytes },
      ))
    }
    files.push(...await scanTextFiles(
      this.fs,
      joinPath(this.projectDir(project), DELIVERY_DIR),
      { maxBytes: this.config.scanMaxBytes, extensions: ['.md'] },
    ))
    return files
  }

  /**
   * Write one citation into the project's bibliography.
   *
   * The first paper bundle in listing order owns the file: a project with no
   * paper bundle yet has nowhere to put a bibliography, and the pool row alone
   * is the honest state until one exists.
   * @param project - the project slug.
   * @param citation - the citation to store.
   */
  private async writeBib(project: string, citation: Citation): Promise<void> {
    const paper = (await this.paperSlugs(project))[0]
    if (paper === undefined) return
    const path = this.refsPath(project, paper)
    const current = await readTextIfPresent(this.fs, path)
    await writeTextFile(this.fs, path, upsertBibtexEntry(current ?? '', bibEntryFromCitation(citation)))
  }

  /**
   * The paper bundles of one project.
   * @param project - the project slug.
   * @returns the bundle slugs in listing order; an absent `papers/` yields none.
   */
  private async paperSlugs(project: string): Promise<string[]> {
    const entries = await listDirEntries(this.fs, joinPath(this.projectDir(project), PAPERS_DIR))
    return entries.filter(entry => entry.type === 'directory').map(entry => entry.name)
  }

  /**
   * Absolute path of one project directory.
   * @param project - the project slug.
   * @returns the directory path under `projectRoot`.
   */
  private projectDir(project: string): string {
    return joinPath(this.config.projectRoot, project)
  }

  /**
   * Absolute path of one paper bundle's bibliography.
   * @param project - the project slug.
   * @param paper - the bundle slug.
   * @returns the `refs.bib` path inside the bundle's source tree.
   */
  private refsPath(project: string, paper: string): string {
    return joinPath(this.projectDir(project), PAPERS_DIR, paper, PAPER_SRC_DIR, REFS_FILE)
  }

  /**
   * The citations of one project.
   * @param project - the project slug.
   * @returns the rows, unordered.
   */
  private citationsOf(project: string): Citation[] {
    return [...this.citations.entries()].map(([, row]) => row).filter(row => row.project === project)
  }

  /**
   * The groups of one project.
   * @param project - the project slug.
   * @returns the rows, unordered.
   */
  private groupsOf(project: string): CitationGroup[] {
    return [...this.groups.entries()].map(([, row]) => row).filter(row => row.project === project)
  }

  /**
   * Assemble one project's pool from the tables.
   * @param project - the project slug.
   * @returns the ordered groups and citations with the header counters.
   */
  private poolOf(project: string): CitationPool {
    const citations = sortCitations(this.citationsOf(project))
    return {
      project,
      groups: sortGroups(this.groupsOf(project)),
      citations,
      stats: poolStats(citations, this.scans.get(project)?.files ?? 0),
    }
  }

  /**
   * Read one citation that has to be there.
   * @param project - the project slug.
   * @param citekey - the citekey the caller named.
   * @returns the stored row.
   * @throws CitationsError `CITATIONS_UNKNOWN_CITEKEY` when the pool has no such row.
   */
  private requireCitation(project: string, citekey: string): Citation {
    const citation = this.citations.get(citationId(project, citekey))
    if (citation === undefined) {
      throw new CitationsError(`引用池里没有 ${citekey}`, CITATIONS_UNKNOWN_CITEKEY)
    }
    return citation
  }

  /**
   * Check a destination group exists.
   * @param project - the project slug.
   * @param group - the group key.
   * @throws CitationsError `CITATIONS_UNKNOWN_GROUP` for a key that is neither
   *   reserved nor a group of this project.
   */
  private assertGroup(project: string, group: string): void {
    if (RESERVED_GROUPS.includes(group)) return
    if (this.groups.get(groupRowKey(project, group)) !== undefined) return
    throw new CitationsError(`项目 ${project} 里没有分组 ${group}`, CITATIONS_UNKNOWN_GROUP)
  }

  /**
   * Check the project has a directory to read and write in.
   * @param project - the project slug.
   * @throws CitationsError `CITATIONS_UNKNOWN_PROJECT` when nothing is there.
   */
  private async assertProjectExists(project: string): Promise<void> {
    const info = await statPath(this.fs, this.projectDir(project))
    if (info === undefined || info.type !== 'directory') {
      throw new CitationsError(`没有项目 ${project}`, CITATIONS_UNKNOWN_PROJECT)
    }
  }
}
