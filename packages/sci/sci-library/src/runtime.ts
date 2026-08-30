/**
 * `ctx.sciLibrary` — the knowledge base itself: the `sci_library_entry` table,
 * the browser Remote that reads and edits it, the `/library-api` routes that
 * move bytes in and out of the sandbox, and the open-access PDF download.
 *
 * One composition entry mounts the whole layer. The table opens first, then the
 * HTTP routes and the tools are registered, so a request or a tool call can
 * never reach a service whose rows have no medium.
 *
 * The literature layer is a soft dependency, read through `ctx.get` rather than
 * declared in `inject`: a deployment may compose the knowledge base without the
 * public indexes, and there `library_add` still stores what the caller supplied
 * — it only loses the metadata a DOI lookup would have filled in.
 * @module @deepseek-ai/dsh-sci-library/src/runtime
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { LiteratureRecord } from '@deepseek-ai/dsh-sci-literature/types'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-sci-literature'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, DEFAULT_PAGE_LIMIT, DEFAULT_RELATED_LIMIT, MAX_PAGE_LIMIT, MAX_RELATED_LIMIT } from './config.ts'
import {
  applyPatch,
  entryFromDraft,
  entryFromRecord,
  expiredEntryIds,
  facetTags,
  filterEntries,
  libraryCounts,
  mergeEntry,
  orderEntries,
  pageBounds,
  withFile,
} from './entries.ts'
import { LibraryError, libraryErrorCode } from './error.ts'
import { fetchPdfBytes } from './fetch-bytes.ts'
import { entryDirName, readEntryFile, sha256Hex, writeEntryFile } from './files.ts'
import type { LibraryFs } from './files.ts'
import { relatedEntries } from './score.ts'
import { ENTRY_TABLE, sciLibraryDomainSpec } from './spec.ts'
import { applyLibraryTools } from './tool.ts'
import { createLibraryRouter, LIBRARY_ROUTE_PREFIX, NEW_ENTRY } from './upload-route.ts'
import type {
  LibraryAddRequest,
  LibraryAddResult,
  LibraryEntry,
  LibraryFetchPdfRequest,
  LibraryFetchPdfResult,
  LibraryFile,
  LibraryGetRequest,
  LibraryGetResult,
  LibraryKind,
  LibraryPage,
  LibraryQuery,
  LibraryRelatedRequest,
  LibraryRelatedResult,
  LibraryRemoveRequest,
  LibraryRemoveResult,
  LibraryUpdateRequest,
  LibraryUpdateResult,
  UploadedFile,
} from './types.ts'

/** Cordis service key and Remote namespace of this package. */
export const SERVICE_KEY = 'sciLibrary'

/** Wire namespace the knowledge-base endpoints are exported under. */
export const LIBRARY_NAMESPACE = 'sci.library'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciLibrary: LibraryRuntime
  }
}

/**
 * The id a hand-written draft is stored under.
 *
 * A draft carrying an identifier is keyed by it, so the same work added twice —
 * once by hand, once from a search — lands on one row instead of two. A draft
 * with no identifier gets a minted id, because nothing about its text is stable
 * enough to key on: the user may rename it a minute later.
 * @param draft - the caller's fields.
 * @returns the entry id.
 */
export function draftId(draft: Partial<LibraryEntry>): string {
  if (draft.id !== undefined && draft.id !== '') return draft.id
  if (draft.doi !== undefined && draft.doi !== '') return `doi:${draft.doi.toLowerCase()}`
  if (draft.arxivId !== undefined && draft.arxivId !== '') return `arxiv:${draft.arxivId}`
  return `note:${randomUUID()}`
}

/**
 * The file name one entry's downloaded PDF is stored under.
 * @param id - the entry id.
 * @returns a sanitized name ending in `.pdf`.
 */
export function pdfFileName(id: string): string {
  return `${entryDirName(id)}.pdf`
}

/**
 * The user's knowledge base: papers, datasets, and notes they chose to keep,
 * plus the sandbox files that belong to them. The service performs reads and
 * table writes only: it never creates, resumes, or drives an Agent or Session.
 */
export class LibraryRuntime extends TypertRemoteService {
  static inject = ['storageDomain', 'systemPrompt', 'tools', 'fs', 'webServer', 'connection']

  /** Loader validation for the knowledge base's deployment policy. */
  static Config: z<Config> = Config

  private readonly config: Config
  /** Assigned by `Service.init` before Cordis publishes the service. */
  private table!: KvTable<string, LibraryEntry>
  /** Assigned by `Service.init`; the narrow filesystem seam this package writes through. */
  private files!: LibraryFs

  /**
   * @param ctx - Host context carrying the storage-domain, filesystem, and webserver forms.
   * @param config - the resolved deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // LIBRARY_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciLibrary', { namespace: 'sci.library' })
    this.config = config
  }

  /** Inclusive byte cap on one uploaded or downloaded file. */
  get maxFileBytes(): number {
    return this.config.maxFileBytes
  }

  /**
   * Open the entry table, then claim the HTTP prefix and register the tools.
   *
   * Both contributions are effects of the mounting fiber, so composing the
   * package out takes the routes and the tools with it.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sciLibraryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sci-library.domainClose')
    this.table = domain.table(ENTRY_TABLE)
    // `writeBytes` is the filesystem seam's binary write; the structural
    // `LibraryFs` shape names exactly the four methods this package calls.
    this.files = this.ctx.fs
    this.ctx.effect(() => this.ctx.webServer.register({
      kind: 'prefix',
      path: LIBRARY_ROUTE_PREFIX,
      handler: createLibraryRouter(
        {
          maxFileBytes: this.config.maxFileBytes,
          upload: (entryId, kind, file) => this.upload(entryId, kind, file),
          download: (entryId, name) => this.download(entryId, name),
        },
        headers => this.ctx.connection.isTrustedRequest(headers),
      ),
    }), 'sci-library: upload api')
    applyLibraryTools(this.ctx, this, this.config.libraryRoot)
  }

  /**
   * Every stored entry, as an in-memory snapshot.
   * @returns the rows in table order.
   */
  private snapshot(): LibraryEntry[] {
    return [...this.table.entries()].map(([, entry]) => entry)
  }

  /**
   * List or search the knowledge base.
   * @param query - the listing's filters, free text, and page bounds.
   * @returns the page, with the tag facets and the whole-library counts beside it.
   */
  @Remote('list')
  list(query: LibraryQuery): Promise<LibraryPage> {
    const all = this.snapshot()
    const filtered = filterEntries(all, query)
    const ordered = orderEntries(filtered, query.query)
    const bounds = pageBounds(query.limit, query.offset, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
    return Promise.resolve({
      entries: ordered.slice(bounds.offset, bounds.offset + bounds.limit),
      total: ordered.length,
      tags: facetTags(filtered),
      counts: libraryCounts(all),
    })
  }

  /**
   * Read one entry.
   * @param request - the entry to read.
   * @returns the entry, or `not-found` when the library does not hold it.
   */
  @Remote('get')
  get(request: LibraryGetRequest): Promise<LibraryGetResult> {
    const entry = this.table.get(request.id)
    return Promise.resolve(entry === undefined ? { error: 'not-found' } : { entry })
  }

  /**
   * Put one entry in the knowledge base.
   *
   * An id the library already holds is merged into rather than overwritten, and
   * the answer says so through `created: false`: adding the same paper twice
   * must gain the second call's tags without losing the title, status, or note
   * the user set on the first.
   * @param request - the record or draft to store, the tags, and whether to fetch the PDF.
   * @returns the stored entry, whether it was new, and any download failure.
   * @throws LibraryError `LIBRARY_INVALID_REQUEST` when the request names neither a record nor a draft.
   */
  @Remote('add')
  async add(request: LibraryAddRequest): Promise<LibraryAddResult> {
    const now = Date.now()
    const tags = request.tags ?? []
    let incoming: LibraryEntry
    if (request.record !== undefined) {
      incoming = entryFromRecord(request.record, tags, now)
    } else if (request.entry !== undefined) {
      incoming = entryFromDraft(request.entry, draftId(request.entry), tags, now)
    } else {
      throw new LibraryError('add needs either a literature record or an entry draft', 'LIBRARY_INVALID_REQUEST')
    }
    const existing = this.table.get(incoming.id)
    const stored = existing === undefined ? incoming : mergeEntry(existing, incoming, now)
    await this.table.put(stored.id, stored)
    await this.trim()
    if (request.withPdf !== true) return { entry: stored, created: existing === undefined }
    try {
      return { entry: await this.downloadPdf(stored), created: existing === undefined }
    } catch (error: unknown) {
      return { entry: stored, created: existing === undefined, fetchError: libraryErrorCode(error) }
    }
  }

  /**
   * Change the fields the user owns on one entry.
   * @param request - the entry and the fields to change.
   * @returns the edited entry, or `not-found` when the library does not hold it.
   */
  @Remote('update')
  async update(request: LibraryUpdateRequest): Promise<LibraryUpdateResult> {
    const existing = this.table.get(request.id)
    if (existing === undefined) return { error: 'not-found' }
    const next = applyPatch(existing, request.patch, Date.now())
    await this.table.put(next.id, next)
    return { entry: next }
  }

  /**
   * Drop one entry, optionally emptying its files.
   *
   * `deleteFiles` empties rather than unlinks: the filesystem seam offers no
   * removal, so the honest thing it can do is truncate each file to zero bytes.
   * The zero-byte files and their directory stay until the sandbox is reset.
   * @param request - the entry to drop and whether to empty its files.
   * @returns whether a row existed, and how many files were emptied.
   */
  @Remote('removeEntry')
  async removeEntry(request: LibraryRemoveRequest): Promise<LibraryRemoveResult> {
    const existing = this.table.get(request.id)
    let filesCleared = 0
    if (existing !== undefined && request.deleteFiles === true) {
      for (const file of existing.files) {
        await writeEntryFile(this.files, this.config.libraryRoot, existing.id, file.name, new Uint8Array(0), Date.now())
        filesCleared += 1
      }
    }
    return { removed: await this.table.delete(request.id), filesCleared }
  }

  /**
   * The entries most like one the library already holds.
   * @param request - the entry to find neighbours of, and how many to return.
   * @returns the neighbours, best first; empty when the id is unknown.
   */
  @Remote('related')
  related(request: LibraryRelatedRequest): Promise<LibraryRelatedResult> {
    const subject = this.table.get(request.id)
    if (subject === undefined) return Promise.resolve({ entries: [] })
    const bounds = pageBounds(request.limit, 0, DEFAULT_RELATED_LIMIT, MAX_RELATED_LIMIT)
    return Promise.resolve({ entries: relatedEntries(subject, this.snapshot(), bounds.limit) })
  }

  /**
   * Download one entry's open-access PDF into its library directory.
   * @param request - the entry whose `pdfUrl` to fetch.
   * @returns the entry carrying the stored file, or the failure class.
   */
  @Remote('fetchPdf')
  async fetchPdf(request: LibraryFetchPdfRequest): Promise<LibraryFetchPdfResult> {
    const entry = this.table.get(request.id)
    if (entry === undefined) return { error: 'LIBRARY_NOT_FOUND' }
    try {
      return { entry: await this.downloadPdf(entry) }
    } catch (error: unknown) {
      return { error: libraryErrorCode(error) }
    }
  }

  /**
   * Resolve one identifier to a bibliographic record through the literature layer.
   * @param identifier - a DOI or an arXiv id.
   * @param signal - cancellation of the lookup.
   * @returns the matching record, or undefined when the layer is absent or matched nothing.
   */
  async lookup(identifier: string, signal?: AbortSignal): Promise<LiteratureRecord | undefined> {
    const literature = this.ctx.get('sciLiterature')
    if (literature === undefined) return undefined
    const wanted = identifier.trim().toLowerCase()
    const result = await literature.search({ query: identifier, limit: 3 }, signal)
    return result.records.find(record => record.doi?.toLowerCase() === wanted
      || record.arxivId?.toLowerCase() === wanted
      || record.id.toLowerCase() === `doi:${wanted}`
      || record.id.toLowerCase() === `arxiv:${wanted}`)
  }

  /**
   * Store one uploaded file, creating the entry when the caller asked for one.
   * @param entryId - the entry to attach to, or `new`.
   * @param kind - the kind a new entry takes; ignored when the entry exists.
   * @param file - the parsed upload.
   * @returns the entry carrying the stored file.
   * @throws LibraryError `LIBRARY_NOT_FOUND` when a named entry is not in the library.
   */
  async upload(entryId: string, kind: LibraryKind | undefined, file: UploadedFile): Promise<LibraryEntry> {
    const now = Date.now()
    let entry = this.table.get(entryId)
    if (entry === undefined) {
      if (entryId !== NEW_ENTRY) {
        throw new LibraryError(`the library has no entry ${JSON.stringify(entryId)}`, 'LIBRARY_NOT_FOUND')
      }
      // Keyed by content, so re-uploading the same bytes lands on the row that
      // already describes them instead of minting a second entry for one file.
      const id = `file:${sha256Hex(file.bytes)}`
      entry = this.table.get(id) ?? entryFromDraft({
        title: file.name,
        kind: kind ?? (file.mediaType === 'application/pdf' ? 'paper' : 'dataset'),
        sources: ['upload'],
      }, id, [], now)
    }
    const stored = await writeEntryFile(this.files, this.config.libraryRoot, entry.id, file.name, file.bytes, now)
    const next = withFile(entry, stored, now)
    await this.table.put(next.id, next)
    await this.trim()
    return next
  }

  /**
   * Read one stored file back for the download route.
   * @param entryId - the owning entry.
   * @param name - the stored file name.
   * @returns the file record and its bytes.
   * @throws LibraryError `LIBRARY_NOT_FOUND` when the entry or the file is unknown.
   */
  async download(entryId: string, name: string): Promise<{ file: LibraryFile; bytes: Uint8Array }> {
    const entry = this.table.get(entryId)
    const file = entry?.files.find(candidate => candidate.name === name)
    if (entry === undefined || file === undefined) {
      throw new LibraryError('no such file in the library', 'LIBRARY_NOT_FOUND')
    }
    return {
      file,
      bytes: await readEntryFile(this.files, this.config.libraryRoot, entry.id, file, this.config.maxFileBytes),
    }
  }

  /**
   * Fetch one entry's open-access PDF and attach it.
   * @param entry - the entry to fetch for.
   * @returns the entry carrying the stored file.
   * @throws LibraryError from the download, or `LIBRARY_NOT_FOUND` when the entry has no PDF link.
   */
  private async downloadPdf(entry: LibraryEntry): Promise<LibraryEntry> {
    if (entry.pdfUrl === undefined || entry.pdfUrl === '') {
      throw new LibraryError('this entry carries no open-access PDF link', 'LIBRARY_NOT_FOUND')
    }
    const bytes = await fetchPdfBytes(entry.pdfUrl, {
      maxBytes: this.config.maxFileBytes,
      timeoutMs: this.config.fetchTimeoutMs,
    })
    const now = Date.now()
    const stored = await writeEntryFile(this.files, this.config.libraryRoot, entry.id, pdfFileName(entry.id), bytes, now)
    const current = this.table.get(entry.id)
    if (current === undefined) {
      // Re-read rather than reuse the row this call started from: a download
      // is a network round-trip long, and putting a stale copy back would undo
      // whatever the user changed meanwhile — or resurrect a row they deleted.
      throw new LibraryError('the entry was removed while its PDF was downloading', 'LIBRARY_NOT_FOUND')
    }
    const next = withFile(current, stored, now)
    await this.table.put(next.id, next)
    return next
  }

  /**
   * Drop the oldest file-less rows once the library passes its size cap.
   */
  private async trim(): Promise<void> {
    for (const expired of expiredEntryIds(this.snapshot(), this.config.maxEntries)) {
      await this.table.delete(expired)
    }
  }
}
