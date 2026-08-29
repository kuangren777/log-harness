/**
 * Literature-search plugin, browser half: the full-bleed 「检索」 view, the
 * rail button that routes to it, and the `literature_search` tool row.
 *
 * Three registrations into three seats this package does not own — ui-layout's
 * keyed `view`, the sci shell's `rail.item`, and ui-tool's keyed
 * `tool.call.toolview` — so composing this plugin out of cordis.yml removes
 * the view, the button, and the row together and leaves every other surface
 * exactly as it was.
 *
 * The wire seam is this file alone. This plugin MOUNTS the host's generated
 * `sci.literature` Remote contribution itself — the base web-app assembly
 * (`@deepseek-ai/dsh-api-remotes`) selects the namespaces every profile gets,
 * and a science-only namespace does not belong in that bundle — and then
 * turns its envelopes into the plain records and total outcomes
 * `./contract.ts` declares, so no component ever sees an RPC error.
 */
import literatureRemote from '@deepseek-ai/dsh-sci-literature/remote'
import { CONVERSATION_VIEW } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.remote merge carrying the generated namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.conversation merge carrying the input resolver.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.layout merge and the SlotMap `view` declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
// Type-only: pulls the SlotMap declaration of the keyed tool view.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  LiteratureSearchRequest, LiteratureSearchResult, RecentQuery, SciSearchInjected, SearchOutcome,
} from './contract.ts'
import { LiteratureHits } from './LiteratureHits.tsx'
import { SearchRailItem } from './RailItem.tsx'
import { SearchView } from './SearchView.tsx'
import { createSearchStore } from './stores.ts'
import { SEARCH_VIEW } from './view-id.ts'
import { en, NS, zh, type SciSearchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Search-view, result-card, and tool-row copy. */
    'sci-search': SciSearchKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the derivations through their own modules.

/**
 * Required services: the three registries, the Remote mount point, and the
 * deep-dive route.
 *
 * `remote.sci.literature` is deliberately NOT here: this plugin provides that
 * namespace service by mounting the contribution, and a fiber that injects
 * what its own apply provides never activates (the live symptom was
 * `pending (waiting for service: remote.sci.literature)`).
 */
export const inject = [
  'slots', 'locale', 'layout', 'remote', 'sessions', 'workspaces', 'conversation',
]

/** This entry's position in the icon rail, below the research-flow button. */
const RAIL_ORDER = 40

/** Wire name of the tool whose calls this package draws. */
const TOOL_NAME = 'literature_search'

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE_SERVICE = 'remote.sci.literature'

/** The code a search reports when the namespace is not mounted. */
const NAMESPACE_UNAVAILABLE = 'LITERATURE_REMOTE_UNAVAILABLE'

/**
 * One Remote answer, mirrored from `@deepseek-ai/dsh-typert-protocol` until
 * the host package's generated namespace lands in this compilation.
 */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The three endpoints `sci-literature` exports under `sci.literature`
 * (spec 16-Workbench/04-spec-search.md §2.2), mirrored for the same reason as
 * the record types in `./contract.ts`: this compilation still states the
 * record vocabulary itself, so it also states the signatures over it.
 */
interface LiteratureNamespace {
  search(request: LiteratureSearchRequest): Promise<RemoteAnswer<LiteratureSearchResult>>
  recent(): Promise<RemoteAnswer<{ entries: readonly RecentQuery[] }>>
  forget(request: { id: string }): Promise<RemoteAnswer<{ ok: true }>>
}

/**
 * Resolve the mounted namespace.
 *
 * `ctx.get`, not `ctx.remote['sci.literature']`: the traceable-service proxy
 * forwards that property read to the `remote.sci.literature` context
 * property, and a context property resolves only for a fiber that INJECTED it
 * (verified against vendored cordis: the read throws `cannot get property
 * "remote.sci.literature" without inject`). This plugin provides that service
 * instead of injecting it, so it reads the implementation directly — the same
 * route ui-skill uses for `connection`.
 * @param ctx - client root context.
 * @returns the namespace face, or undefined when the mount is not in place.
 */
function namespaceOf(ctx: ClientContext): LiteratureNamespace | undefined {
  return ctx.get(NAMESPACE_SERVICE) as LiteratureNamespace | undefined
}

/**
 * The session one deep dive lands in: the current session's Workspace, else
 * the most recent one, connected to its reusable blank session. With no
 * Workspace at all the current session is the only place to put the prompt.
 * @param ctx - client root context.
 * @returns the target session id, or undefined when there is none.
 */
async function deepDiveSession(ctx: ClientContext): Promise<SessionId | undefined> {
  const workspaces = ctx.workspaces.list.getSnapshot()
  const current = ctx.sessions.list.getSnapshot().current
  const owning = current === undefined
    ? undefined
    : workspaces.items.find(item => item.sessionIds.includes(current))?.workspaceId
  const target = owning ?? workspaces.recentWorkspaceId
  if (target === undefined) return current
  return ctx.workspaces.connectWorkspace(target)
}

/**
 * Client plugin body: mount the host's Remote contribution, then register the
 * dictionaries, the view, the rail button, and the tool row.
 *
 * The mount comes first and is awaited, so nothing this plugin registers can
 * render before the namespace it calls exists. Its disposer rides an effect
 * on this fiber: unloading the plugin unmounts the namespace, which is what
 * makes composing the row out of cordis.yml leave no Remote surface behind.
 * @param ctx - client root context.
 * @returns nothing; the fiber stays LOADING until the mount settles.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(literatureRemote)
  ctx.effect(() => () => { void unmount() }, 'ui-sci-search: sci.literature remote namespace')

  // One handle for the view registration: the search a user ran survives a
  // trip through the research flow and back, which an entry-local state
  // would not.
  const store = createSearchStore()

  const injected = (): SciSearchInjected => ({
    search: async (request: LiteratureSearchRequest): Promise<SearchOutcome> => {
      const namespace = namespaceOf(ctx)
      // A namespace that is not there is a stated failure code, not a
      // rejected promise inside a click handler.
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      const answer = await namespace.search(request)
      return answer.ok ? { ok: true, result: answer.value } : { ok: false, code: answer.error.code }
    },
    recent: async (): Promise<readonly RecentQuery[]> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return []
      const answer = await namespace.recent()
      // A history the host cannot read is an empty strip, never a thrown
      // render: the search box itself still works without it.
      return answer.ok ? answer.value.entries : []
    },
    forget: async (id: string): Promise<readonly RecentQuery[]> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return []
      await namespace.forget({ id })
      const answer = await namespace.recent()
      return answer.ok ? answer.value.entries : []
    },
    deepDive: (prompt: string): void => {
      void deepDiveSession(ctx).then(
        (sessionId) => {
          if (sessionId !== undefined) {
            const scope = ctx.sessions.scope(sessionId)
            // The composer machine is per session and reached through its own
            // scope; a session the runtime has not scoped yet simply opens
            // with an empty composer rather than losing the view switch.
            if (scope !== undefined) ctx.conversation.input.for(scope).setDraft(prompt)
            ctx.sessions.open(sessionId)
          }
          ctx.layout.showView(CONVERSATION_VIEW)
        },
        (reason: unknown) => {
          // Same tolerance as the shell's own New Session flow: a failed
          // connect leaves the user in the research flow with an empty
          // composer instead of a dead button.
          console.warn('literature deep dive failed:', reason)
          ctx.layout.showView(CONVERSATION_VIEW)
        },
      )
    },
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-search: dictionaries')

  // slots.inject, not a bare register: each of the three declarations lives
  // in another package whose entry may activate after this one, and a
  // redeclaration must re-install the contribution.
  ctx.slots.inject('view', () => ctx.slots.register({
    name: 'view', key: SEARCH_VIEW, locale: NS, store, inject: injected,
  }, SearchView))

  ctx.slots.inject('rail.item', () => ctx.slots.register({
    name: 'rail.item', id: SEARCH_VIEW, order: RAIL_ORDER, locale: NS,
  }, SearchRailItem))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: TOOL_NAME, locale: NS,
  }, LiteratureHits))
}
