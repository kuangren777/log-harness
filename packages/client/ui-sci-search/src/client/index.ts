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
 * The wire seam is this file alone. The host answers over the Typert Remote
 * namespace `sci.literature`; the injected face turns its envelopes into the
 * plain records and total outcomes `./contract.ts` declares, so no component
 * ever sees an RPC error.
 */
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

/** Required services: the three registries, the Remote namespace, and the deep-dive route. */
export const inject = [
  'slots', 'locale', 'layout', 'remote', 'remote.sci.literature', 'sessions', 'workspaces', 'conversation',
]

/** This entry's position in the icon rail, below the research-flow button. */
const RAIL_ORDER = 40

/** Wire name of the tool whose calls this package draws. */
const TOOL_NAME = 'literature_search'

/**
 * One Remote answer, mirrored from `@deepseek-ai/dsh-typert-protocol` until
 * the host package's generated namespace lands in this compilation.
 */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The three endpoints `sci-literature` exports under `sci.literature`
 * (spec 16-Workbench/04-spec-search.md §2.2). Mirrored for the same reason as
 * the record types in `./contract.ts`: the generated namespace declaration
 * does not exist until that host package is in the tree, and the assembly
 * step replaces both this interface and {@link namespaceOf} with it.
 */
interface LiteratureNamespace {
  search(request: LiteratureSearchRequest): Promise<RemoteAnswer<LiteratureSearchResult>>
  recent(): Promise<RemoteAnswer<{ entries: readonly RecentQuery[] }>>
  forget(request: { id: string }): Promise<RemoteAnswer<{ ok: true }>>
}

/**
 * Resolve the host namespace off the Remote service. The cast is the whole
 * seam: cordis resolves `ctx.remote['sci.literature']` to the namespace
 * service registered as `remote.sci.literature`, which this compilation has
 * no generated declaration for yet.
 * @param ctx - client root context.
 * @returns the namespace face.
 */
function namespaceOf(ctx: ClientContext): LiteratureNamespace {
  return (ctx.remote as unknown as { 'sci.literature': LiteratureNamespace })['sci.literature']
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
 * Client plugin body: register the dictionaries, the view, the rail button,
 * and the tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One handle for the view registration: the search a user ran survives a
  // trip through the research flow and back, which an entry-local state
  // would not.
  const store = createSearchStore()

  const injected = (): SciSearchInjected => ({
    search: async (request: LiteratureSearchRequest): Promise<SearchOutcome> => {
      const answer = await namespaceOf(ctx).search(request)
      return answer.ok ? { ok: true, result: answer.value } : { ok: false, code: answer.error.code }
    },
    recent: async (): Promise<readonly RecentQuery[]> => {
      const answer = await namespaceOf(ctx).recent()
      // A history the host cannot read is an empty strip, never a thrown
      // render: the search box itself still works without it.
      return answer.ok ? answer.value.entries : []
    },
    forget: async (id: string): Promise<readonly RecentQuery[]> => {
      await namespaceOf(ctx).forget({ id })
      const answer = await namespaceOf(ctx).recent()
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
