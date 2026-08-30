/**
 * Knowledge-library plugin, browser half: the full-bleed 「知识库」 view, the
 * rail button that routes to it, the two library tool rows, and the
 * 「加入知识库」 action on ②'s result cards.
 *
 * Five registrations into four seats this package does not own — ui-layout's
 * keyed `view`, the sci shell's `rail.item`, ui-tool's keyed
 * `tool.call.toolview` twice, and ②'s `search.result.actions` — so composing
 * this plugin out of cordis.yml removes the view, the button, both rows, and
 * the card action together and leaves every other surface exactly as it was.
 * ② is a soft dependency in the only sense that matters at runtime:
 * `slots.inject` waits for the declaration, so a profile without ② simply has
 * no card action.
 *
 * The wire seam is this file alone. This plugin MOUNTS the host's generated
 * `sci.library` Remote contribution itself — the base web-app assembly
 * (`@deepseek-ai/dsh-api-remotes`) selects the namespaces every profile gets,
 * and a science-only namespace does not belong in that bundle — and then
 * turns its envelopes, and the two `/library-api` routes, into the plain
 * entries and total outcomes `./contract.ts` declares, so no component ever
 * sees an RPC error or a `Response`.
 */
import libraryRemote from '@deepseek-ai/dsh-sci-library/remote'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.remote merge carrying the generated namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.layout merge and the SlotMap `view` declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
// Type-only: pulls ②'s `search.result.actions` seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sci-search/client'
// Type-only: pulls the SlotMap declaration of the keyed tool view.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  FileTextOutcome, LibraryEntry, LibraryOutcome, LibraryPage, LibraryPatch, LibraryQuery, LibraryRecord,
  SciLibraryAddInjected, SciLibraryInjected, UploadOutcome, UploadRequest,
} from './contract.ts'
import { AddToLibrary } from './AddToLibrary.tsx'
import { LibraryAdded, LibraryHits } from './LibraryHits.tsx'
import { LibraryRailItem } from './RailItem.tsx'
import { LibraryView } from './LibraryView.tsx'
import { createLibraryStore, type LibraryStore } from './stores.ts'
import { fileUrl, uploadCodeOf, uploadUrl } from './routes.ts'
import { LIBRARY_VIEW } from './view-id.ts'
import { en, NS, zh, type SciLibraryKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Library-view, detail, upload, tool-row, and card-action copy. */
    'sci-library': SciLibraryKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the derivations through their own modules.

/**
 * Required services: the two registries and the Remote mount point.
 *
 * `remote.sci.library` is deliberately NOT here: this plugin provides that
 * namespace service by mounting the contribution, and a fiber that injects
 * what its own apply provides never activates.
 */
export const inject = ['slots', 'locale', 'remote']

/** This entry's position in the icon rail, below the literature search. */
const RAIL_ORDER = 20

/** Wire name of the tool whose hit list this package draws. */
const SEARCH_TOOL = 'library_search'

/** Wire name of the tool whose confirmation row this package draws. */
const ADD_TOOL = 'library_add'

/** This package's entry id in ②'s per-record action strip. */
const ACTION_ID = 'library-add'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE_SERVICE = 'remote.sci.library'

/** The code a call reports when the namespace is not mounted. */
const NAMESPACE_UNAVAILABLE = 'LIBRARY_REMOTE_UNAVAILABLE'

/** The code a call reports when it never reached an answer. */
const REMOTE_FAILED = 'LIBRARY_REMOTE_FAILED'

/** The code a read reports for an id the library does not hold. */
const NOT_FOUND = 'LIBRARY_NOT_FOUND'

/** The code a file read reports when the route could not be reached at all. */
const FILE_UNREACHABLE = 'LIBRARY_FILE_UNREACHABLE'

/**
 * Entries the id seed reads. The host caps a page at 100 rows, so a library
 * larger than that seeds the most recently updated 100; a record past them
 * offers 「加入知识库」, and the host merges rather than duplicating it.
 */
const STORED_SEED_LIMIT = 100

/**
 * One Remote answer, mirrored from `@deepseek-ai/dsh-typert-protocol` until
 * the host package's generated namespace lands in this compilation.
 */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The seven endpoints `sci-library` exports under `sci.library`
 * (spec 16-Workbench/07-spec-library.md §3.2), mirrored for the same reason as
 * the entry types in `./contract.ts`.
 */
interface LibraryNamespace {
  list(request: LibraryQuery): Promise<RemoteAnswer<LibraryPage>>
  get(request: { id: string }): Promise<RemoteAnswer<{ entry: LibraryEntry } | { error: 'not-found' }>>
  add(request: {
    record?: LibraryRecord
    tags?: readonly string[]
    withPdf?: boolean
  }): Promise<RemoteAnswer<{ entry: LibraryEntry; created: boolean; fetchError?: string }>>
  update(request: {
    id: string
    patch: LibraryPatch
  }): Promise<RemoteAnswer<{ entry: LibraryEntry } | { error: 'not-found' }>>
  removeEntry(request: {
    id: string
    deleteFiles?: boolean
  }): Promise<RemoteAnswer<{ removed: boolean; filesCleared: number }>>
  related(request: { id: string; limit?: number }): Promise<RemoteAnswer<{ entries: readonly LibraryEntry[] }>>
  fetchPdf(request: { id: string }): Promise<RemoteAnswer<{ entry: LibraryEntry } | { error: string }>>
}

/**
 * Resolve the mounted namespace.
 *
 * `ctx.get`, not `ctx.remote['sci.library']`: a context property resolves only
 * for a fiber that INJECTED it, and this plugin provides that service instead
 * of injecting it.
 * @param ctx - client root context.
 * @returns the namespace face, or undefined when the mount is not in place.
 */
function namespaceOf(ctx: ClientContext): LibraryNamespace | undefined {
  return ctx.get(NAMESPACE_SERVICE) as LibraryNamespace | undefined
}

/**
 * Run one Remote call and fold every way it can go wrong into a stated code.
 * @param namespace - the mounted namespace, or undefined when it is not there.
 * @param run - the call to make on it.
 * @returns the value, or the code that stands in for it.
 */
async function settle<T>(
  namespace: LibraryNamespace | undefined,
  run: (namespace: LibraryNamespace) => Promise<RemoteAnswer<T>>,
): Promise<LibraryOutcome<T>> {
  // A namespace that is not there is a stated failure code, not a rejected
  // promise inside a click handler.
  if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
  try {
    const answer = await run(namespace)
    return answer.ok ? { ok: true, value: answer.value } : { ok: false, code: answer.error.code }
  } catch {
    // A call that never reached an answer is a stated code too: the view draws
    // failures, and an unhandled rejection would draw nothing.
    return { ok: false, code: REMOTE_FAILED }
  }
}

/**
 * Client plugin body: mount the host's Remote contribution, then register the
 * dictionaries, the view, the rail button, the two tool rows, and the action
 * on ②'s cards.
 *
 * The mount comes first and is awaited, so nothing this plugin registers can
 * render before the namespace it calls exists. Its disposer rides an effect on
 * this fiber: unloading the plugin unmounts the namespace.
 * @param ctx - client root context.
 * @returns nothing; the fiber stays LOADING until the mount settles.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(libraryRemote)
  ctx.effect(() => () => { void unmount() }, 'ui-sci-library: sci.library remote namespace')

  // One handle for both registrations that need the shared state: the library
  // view and the action on ②'s cards agree on which ids the library holds,
  // which an entry-local state could not.
  const store: LibraryStore = createLibraryStore()

  const readPage = (query: LibraryQuery): Promise<LibraryOutcome<LibraryPage>> =>
    settle(namespaceOf(ctx), namespace => namespace.list(query))

  const viewFace = (): SciLibraryInjected => ({
    list: readPage,
    get: async (id: string): Promise<LibraryOutcome<LibraryEntry>> => {
      const outcome = await settle(namespaceOf(ctx), namespace => namespace.get({ id }))
      if (!outcome.ok) return outcome
      return 'entry' in outcome.value
        ? { ok: true, value: outcome.value.entry }
        : { ok: false, code: NOT_FOUND }
    },
    update: async (id: string, patch: LibraryPatch): Promise<LibraryOutcome<LibraryEntry>> => {
      const outcome = await settle(namespaceOf(ctx), namespace => namespace.update({ id, patch }))
      if (!outcome.ok) return outcome
      return 'entry' in outcome.value
        ? { ok: true, value: outcome.value.entry }
        : { ok: false, code: NOT_FOUND }
    },
    // `deleteFiles` is the browser's delete: a user removing an entry from the
    // library means its PDFs too, and leaving them behind would keep bytes no
    // surface can reach again.
    remove: async (id: string): Promise<LibraryOutcome<null>> => {
      const outcome = await settle(namespaceOf(ctx), namespace => namespace.removeEntry({ id, deleteFiles: true }))
      if (!outcome.ok) return outcome
      return outcome.value.removed ? { ok: true, value: null } : { ok: false, code: NOT_FOUND }
    },
    related: async (id: string): Promise<readonly LibraryEntry[]> => {
      // A related list the host cannot compute is an empty section, never a
      // thrown render: the entry itself still reads.
      const outcome = await settle(namespaceOf(ctx), namespace => namespace.related({ id }))
      return outcome.ok ? outcome.value.entries : []
    },
    fetchPdf: async (id: string): Promise<LibraryOutcome<LibraryEntry>> => {
      const outcome = await settle(namespaceOf(ctx), namespace => namespace.fetchPdf({ id }))
      if (!outcome.ok) return outcome
      return 'entry' in outcome.value
        ? { ok: true, value: outcome.value.entry }
        : { ok: false, code: outcome.value.error }
    },
    upload: async ({ entryId, kind, file }: UploadRequest): Promise<UploadOutcome> => {
      const body = new FormData()
      body.append('file', file, file.name)
      try {
        const response = await fetch(uploadUrl(entryId, kind), { method: 'POST', body })
        if (!response.ok) return { ok: false, code: uploadCodeOf(response.status) }
        // The route answers `{ ok: true, entry }` (sci-library upload-route).
        return { ok: true, entry: (await response.json() as { entry: LibraryEntry }).entry }
      } catch {
        // An upload that never reached the route (offline, a body the route
        // did not answer as JSON) is stated as a failure the picker draws.
        return { ok: false, code: 'failed' }
      }
    },
    readText: async (entryId: string, name: string): Promise<FileTextOutcome> => {
      try {
        const response = await fetch(fileUrl(entryId, name))
        return response.ok
          ? { ok: true, text: await response.text() }
          : { ok: false, code: `LIBRARY_FILE_HTTP_${response.status}` }
      } catch {
        return { ok: false, code: FILE_UNREACHABLE }
      }
    },
  })

  // The id set the action on ②'s cards reads, seeded once from the host the
  // first time that action mounts. The library view's own read keeps it
  // current afterwards, so this runs only for a profile where a search is the
  // first library surface a user reaches.
  let seeded = false

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-library: dictionaries')

  // slots.inject, not a bare register: each declaration lives in another
  // package whose entry may activate after this one, and a redeclaration must
  // re-install the contribution.
  ctx.slots.inject('view', () => ctx.slots.register({
    name: 'view', key: LIBRARY_VIEW, locale: NS, store, inject: viewFace,
  }, LibraryView))

  ctx.slots.inject('rail.item', () => ctx.slots.register({
    name: 'rail.item', id: LIBRARY_VIEW, order: RAIL_ORDER, locale: NS,
  }, LibraryRailItem))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: SEARCH_TOOL, locale: NS,
  }, LibraryHits))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: ADD_TOOL, locale: NS,
  }, LibraryAdded))

  ctx.slots.inject('search.result.actions', () => ctx.slots.register({
    name: 'search.result.actions',
    id: ACTION_ID,
    locale: NS,
    store,
    inject: (actions): SciLibraryAddInjected => {
      if (!seeded) {
        seeded = true
        void readPage({ limit: STORED_SEED_LIMIT }).then((outcome) => {
          if (outcome.ok) actions.setStored(outcome.value.entries.map(entry => entry.id))
        })
      }
      return {
        add: async (record: LibraryRecord): Promise<LibraryOutcome<LibraryEntry>> => {
          const outcome = await settle(namespaceOf(ctx), namespace => namespace.add({ record }))
          return outcome.ok ? { ok: true, value: outcome.value.entry } : outcome
        },
      }
    },
  }, AddToLibrary))
}
