/**
 * Citation-pool plugin, browser half: the full-bleed 「引用池」 view, the rail
 * button that routes to it, and the two rows a `citations_list` or
 * `citations_add` call draws inside the research flow.
 *
 * Four registrations into three seats this package does not own — ui-layout's
 * keyed `view`, the sci shell's `rail.item`, and ui-tool's keyed
 * `tool.call.toolview` twice — so composing this plugin out of cordis.yml
 * removes the view, the button, and both rows together and leaves every other
 * surface exactly as it was.
 *
 * The wire seam is this file alone. This plugin MOUNTS the host's generated
 * `sci.citations` Remote contribution itself — the base web-app assembly
 * (`@deepseek-ai/dsh-api-remotes`) selects the namespaces every profile gets,
 * and a science-only namespace does not belong in that bundle — and then
 * turns its envelopes into the plain pools and total outcomes `./contract.ts`
 * declares, so no component ever sees an RPC error.
 */
import citationsRemote from '@deepseek-ai/dsh-sci-citations/remote'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.remote merge carrying the generated namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.layout merge and the SlotMap `view` declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
// Type-only: pulls the SlotMap declaration of the keyed tool view.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  BibtexOutcome, CitationPool, CitationProject, PoolOutcome, SciCitationsInjected,
} from './contract.ts'
import { CitationAdded } from './CitationAdded.tsx'
import { CitationsRailItem } from './RailItem.tsx'
import { CitationsTable } from './CitationsTable.tsx'
import { CitationsView } from './CitationsView.tsx'
import { createCitationsStore } from './stores.ts'
import { CITATIONS_VIEW } from './view-id.ts'
import { en, NS, zh, type SciCitationsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Pool-view, group-column, citation-row, and tool-row copy. */
    'sci-citations': SciCitationsKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the derivations through their own modules.

/**
 * Required services: the three registries and the Remote mount point.
 *
 * `remote.sci.citations` is deliberately NOT here: this plugin provides that
 * namespace service by mounting the contribution, and a fiber that injects
 * what its own apply provides never activates (the live symptom in ② was
 * `pending (waiting for service: remote.sci.literature)`).
 */
export const inject = ['slots', 'locale', 'remote']

/** This entry's position in the icon rail, below the search button. */
const RAIL_ORDER = 30

/** Wire name of the tool whose listings this package draws. */
const LIST_TOOL = 'citations_list'

/** Wire name of the tool whose additions this package draws. */
const ADD_TOOL = 'citations_add'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE_SERVICE = 'remote.sci.citations'

/** The code a call reports when the namespace is not mounted. */
const NAMESPACE_UNAVAILABLE = 'CITATIONS_REMOTE_UNAVAILABLE'

/** The code a call reports when it never reached an answer. */
const REMOTE_FAILED = 'CITATIONS_REMOTE_FAILED'

/**
 * One Remote answer, mirrored from `@deepseek-ai/dsh-typert-protocol` until
 * the host package's generated namespace lands in this compilation.
 */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The endpoints `sci-citations` exports under `sci.citations`
 * (spec 16-Workbench/10-spec-citations.md §2.2), mirrored for the same reason
 * as the record types in `./contract.ts`: this compilation still states the
 * pool vocabulary itself, so it also states the signatures over it.
 *
 * The six writes are typed as answering an unknown value on purpose. This
 * plugin re-reads the pool after each of them rather than trusting what they
 * return, so the view's numbers always come from one `pool` answer.
 */
interface CitationsNamespace {
  projects(): Promise<RemoteAnswer<{ projects: readonly CitationProject[] }>>
  pool(request: { project: string }): Promise<RemoteAnswer<CitationPool>>
  upsertGroup(request: { project: string; label: string }): Promise<RemoteAnswer<unknown>>
  removeGroup(request: { project: string; key: string }): Promise<RemoteAnswer<unknown>>
  move(request: { project: string; citekey: string; group: string }): Promise<RemoteAnswer<unknown>>
  removeCitation(request: { project: string; citekey: string }): Promise<RemoteAnswer<unknown>>
  rescan(request: { project: string }): Promise<RemoteAnswer<unknown>>
  exportBibtex(request: { project: string; group?: string }): Promise<RemoteAnswer<{ bibtex: string }>>
}

/**
 * Resolve the mounted namespace.
 *
 * `ctx.get`, not `ctx.remote['sci.citations']`: the traceable-service proxy
 * forwards that property read to the `remote.sci.citations` context property,
 * and a context property resolves only for a fiber that INJECTED it. This
 * plugin provides that service instead of injecting it, so it reads the
 * implementation directly — the same route ui-sci-search uses.
 * @param ctx - client root context.
 * @returns the namespace face, or undefined when the mount is not in place.
 */
function namespaceOf(ctx: ClientContext): CitationsNamespace | undefined {
  return ctx.get(NAMESPACE_SERVICE) as CitationsNamespace | undefined
}

/**
 * Read one project's pool, folding every failure into a stated code.
 * @param namespace - the mounted namespace.
 * @param project - the project slug to read.
 * @returns the pool, or why it could not be read.
 */
async function readPool(namespace: CitationsNamespace, project: string): Promise<PoolOutcome> {
  try {
    const answer = await namespace.pool({ project })
    return answer.ok ? { ok: true, pool: answer.value } : { ok: false, code: answer.error.code }
  } catch {
    // A call that never reached an answer is a stated code too: the view
    // draws failures, and an unhandled rejection would draw nothing.
    return { ok: false, code: REMOTE_FAILED }
  }
}

/**
 * Run one write and answer with the pool the host reports afterwards.
 *
 * The write's own return value is deliberately ignored: one shape — the
 * `pool` answer — feeds every number on screen, so a move and a rescan cannot
 * leave the view describing two different pools.
 * @param namespace - the mounted namespace.
 * @param project - the project the write belongs to.
 * @param write - the call to make.
 * @returns the pool after the write, or the failure that stopped it.
 */
async function afterWrite(
  namespace: CitationsNamespace,
  project: string,
  write: () => Promise<RemoteAnswer<unknown>>,
): Promise<PoolOutcome> {
  try {
    const answer = await write()
    if (!answer.ok) return { ok: false, code: answer.error.code }
  } catch {
    return { ok: false, code: REMOTE_FAILED }
  }
  return readPool(namespace, project)
}

/**
 * Client plugin body: mount the host's Remote contribution, then register the
 * dictionaries, the view, the rail button, and the two tool rows.
 *
 * The mount comes first and is awaited, so nothing this plugin registers can
 * render before the namespace it calls exists. Its disposer rides an effect
 * on this fiber: unloading the plugin unmounts the namespace, which is what
 * makes composing the row out of cordis.yml leave no Remote surface behind.
 * @param ctx - client root context.
 * @returns nothing; the fiber stays LOADING until the mount settles.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(citationsRemote)
  ctx.effect(() => () => { void unmount() }, 'ui-sci-citations: sci.citations remote namespace')

  // One handle for the view registration: the project a user opened and the
  // group they selected survive a trip through the research flow and back,
  // which an entry-local state would not.
  const store = createCitationsStore()

  /**
   * Run one write against the mounted namespace, or state that there is none.
   * @param project - the project the write belongs to.
   * @param write - the call to make once the namespace is resolved.
   * @returns the pool after the write, or the stated failure.
   */
  const writing = (
    project: string,
    write: (namespace: CitationsNamespace) => Promise<RemoteAnswer<unknown>>,
  ): Promise<PoolOutcome> => {
    const namespace = namespaceOf(ctx)
    // A namespace that is not there is a stated failure code, not a rejected
    // promise inside a click handler.
    if (namespace === undefined) return Promise.resolve({ ok: false, code: NAMESPACE_UNAVAILABLE })
    return afterWrite(namespace, project, () => write(namespace))
  }

  const injected = (): SciCitationsInjected => ({
    projects: async (): Promise<readonly CitationProject[]> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return []
      try {
        const answer = await namespace.projects()
        return answer.ok ? answer.value.projects : []
      } catch {
        // A project list the host cannot read is an empty selector with its
        // own stated empty state, never a thrown render.
        return []
      }
    },
    pool: async (project: string): Promise<PoolOutcome> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      return readPool(namespace, project)
    },
    createGroup: (project, label) => writing(project, ns => ns.upsertGroup({ project, label })),
    removeGroup: (project, key) => writing(project, ns => ns.removeGroup({ project, key })),
    move: (project, citekey, group) => writing(project, ns => ns.move({ project, citekey, group })),
    remove: (project, citekey) => writing(project, ns => ns.removeCitation({ project, citekey })),
    rescan: project => writing(project, ns => ns.rescan({ project })),
    exportBibtex: async (project: string, group?: string): Promise<BibtexOutcome> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      try {
        // Conditional spread, not `group: undefined`: under
        // exactOptionalPropertyTypes an absent group and an explicit undefined
        // are different requests, and "the whole project" is the absent one.
        const answer = await namespace.exportBibtex({ project, ...group === undefined ? {} : { group } })
        return answer.ok
          ? { ok: true, bibtex: answer.value.bibtex }
          : { ok: false, code: answer.error.code }
      } catch {
        return { ok: false, code: REMOTE_FAILED }
      }
    },
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-citations: dictionaries')

  // slots.inject, not a bare register: each of the three declarations lives
  // in another package whose entry may activate after this one, and a
  // redeclaration must re-install the contribution.
  ctx.slots.inject('view', () => ctx.slots.register({
    name: 'view', key: CITATIONS_VIEW, locale: NS, store, inject: injected,
  }, CitationsView))

  ctx.slots.inject('rail.item', () => ctx.slots.register({
    name: 'rail.item', id: CITATIONS_VIEW, order: RAIL_ORDER, locale: NS,
  }, CitationsRailItem))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: LIST_TOOL, locale: NS,
  }, CitationsTable))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: ADD_TOOL, locale: NS,
  }, CitationAdded))
}
