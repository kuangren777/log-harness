/**
 * Agent-roster plugin, browser half: the full-bleed 「智能体」 view and the
 * rail button that routes to it.
 *
 * Two registrations into two seats this package does not own — ui-layout's
 * keyed `view` and the sci shell's `rail.item` — so composing this plugin out
 * of cordis.yml removes the view and the button together and leaves every
 * other surface exactly as it was.
 *
 * The wire seam is this file alone. This plugin MOUNTS the host's generated
 * `sci.agents` Remote contribution itself — the base web-app assembly
 * (`@deepseek-ai/dsh-api-remotes`) selects the namespaces every profile gets,
 * and a science-only namespace does not belong in that bundle — and then
 * turns its envelopes into the plain records and total outcomes
 * `./contract.ts` declares, so no component ever sees an RPC error.
 */
import agentsRemote from '@deepseek-ai/dsh-sci-agents/remote'
import { CONVERSATION_VIEW } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.remote merge carrying the generated namespaces.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.layout merge and the SlotMap `view` declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the `rail.item` seat declaration from the shell that owns it.
import type {} from '@deepseek-ai/dsh-client-ui-sci-shell/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  AgentPatch, CallsOutcome, ConfigureOutcome, ModelProvider, RosterAgent, RosterOutcome,
  SciAgentsInjected,
} from './contract.ts'
import type { AgentCall } from './contract.ts'
import { AgentsRailItem } from './RailItem.tsx'
import { AgentsView } from './AgentsView.tsx'
import { createAgentsStore } from './stores.ts'
import { AGENTS_VIEW } from './view-id.ts'
import { en, NS, zh, type SciAgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Roster, configuration, and delegation-log copy. */
    'sci-agents': SciAgentsKey
  }
}

// Export discipline: packages/client/AGENTS.md. The Loader exports are the
// whole `/client` surface; same-package tests reach the components, the store
// factory, and the derivations through their own modules.

/**
 * Required services: the two registries, the Remote mount point, and the
 * session route a log row takes.
 *
 * `remote.sci.agents` is deliberately NOT here: this plugin provides that
 * namespace service by mounting the contribution, and a fiber that injects
 * what its own apply provides never activates.
 */
export const inject = ['slots', 'locale', 'layout', 'remote', 'sessions']

/** This entry's position in the icon rail, above the literature-search button. */
const RAIL_ORDER = 35

/** Cordis service key the mounted namespace registers itself under. */
const NAMESPACE_SERVICE = 'remote.sci.agents'

/** The code a read reports when the namespace is not mounted. */
const NAMESPACE_UNAVAILABLE = 'AGENTS_REMOTE_UNAVAILABLE'

/** The code a read reports when the call itself never reached an answer. */
const REMOTE_FAILED = 'AGENTS_REMOTE_FAILED'

/**
 * One Remote answer, mirrored from `@deepseek-ai/dsh-typert-protocol` until
 * the host package's generated namespace lands in this compilation.
 */
type RemoteAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The four endpoints `sci-agents` exports under `sci.agents`
 * (spec 16-Workbench/12-spec-agents.md §2.3), mirrored for the same reason as
 * the record types in `./contract.ts`: this compilation still states the
 * record vocabulary itself, so it also states the signatures over it.
 */
interface AgentsNamespace {
  roster(): Promise<RemoteAnswer<{ agents: readonly RosterAgent[] }>>
  configure(request: { persona: string; patch: AgentPatch }): Promise<RemoteAnswer<{ agent: RosterAgent }>>
  calls(request: { persona: string }): Promise<RemoteAnswer<{ calls: readonly AgentCall[] }>>
  models(): Promise<RemoteAnswer<{ providers: readonly ModelProvider[] }>>
}

/**
 * Resolve the mounted namespace.
 *
 * `ctx.get`, not `ctx.remote['sci.agents']`: the traceable-service proxy
 * forwards that property read to the `remote.sci.agents` context property,
 * and a context property resolves only for a fiber that INJECTED it. This
 * plugin provides that service instead of injecting it, so it reads the
 * implementation directly.
 * @param ctx - client root context.
 * @returns the namespace face, or undefined when the mount is not in place.
 */
function namespaceOf(ctx: ClientContext): AgentsNamespace | undefined {
  return ctx.get(NAMESPACE_SERVICE) as AgentsNamespace | undefined
}

/**
 * Client plugin body: mount the host's Remote contribution, then register the
 * dictionaries, the view, and the rail button.
 *
 * The mount comes first and is awaited, so nothing this plugin registers can
 * render before the namespace it calls exists. Its disposer rides an effect
 * on this fiber: unloading the plugin unmounts the namespace, which is what
 * makes composing the row out of cordis.yml leave no Remote surface behind.
 * @param ctx - client root context.
 * @returns nothing; the fiber stays LOADING until the mount settles.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(agentsRemote)
  ctx.effect(() => () => { void unmount() }, 'ui-sci-agents: sci.agents remote namespace')

  // One handle for the view registration: which page the user is on and
  // which persona it is about survive a trip through the research flow.
  const store = createAgentsStore()

  const injected = (): SciAgentsInjected => ({
    roster: async (): Promise<RosterOutcome> => {
      const namespace = namespaceOf(ctx)
      // A namespace that is not there is a stated failure code, not a
      // rejected promise inside an effect.
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      try {
        const answer = await namespace.roster()
        return answer.ok ? { ok: true, agents: answer.value.agents } : { ok: false, code: answer.error.code }
      } catch {
        return { ok: false, code: REMOTE_FAILED }
      }
    },
    configure: async (persona: string, patch: AgentPatch): Promise<ConfigureOutcome> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      try {
        const answer = await namespace.configure({ persona, patch })
        return answer.ok ? { ok: true, agent: answer.value.agent } : { ok: false, code: answer.error.code }
      } catch {
        // A write that never reached an answer is a stated code too: the
        // indicator says the save failed rather than claiming it landed.
        return { ok: false, code: REMOTE_FAILED }
      }
    },
    calls: async (persona: string): Promise<CallsOutcome> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return { ok: false, code: NAMESPACE_UNAVAILABLE }
      try {
        const answer = await namespace.calls({ persona })
        return answer.ok ? { ok: true, calls: answer.value.calls } : { ok: false, code: answer.error.code }
      } catch {
        return { ok: false, code: REMOTE_FAILED }
      }
    },
    models: async (): Promise<readonly ModelProvider[]> => {
      const namespace = namespaceOf(ctx)
      if (namespace === undefined) return []
      try {
        const answer = await namespace.models()
        // An unreadable catalog is an empty one: the configuration page then
        // states that the agent follows the session model, which is true.
        return answer.ok ? answer.value.providers : []
      } catch {
        return []
      }
    },
    openSession: (sessionId: string): void => {
      // The audit record carries the delegating session's id as plain wire
      // text; the runtime's branded handle is that same string.
      ctx.sessions.open(sessionId as SessionId)
      ctx.layout.showView(CONVERSATION_VIEW)
    },
  })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sci-agents: dictionaries')

  // slots.inject, not a bare register: both declarations live in another
  // package whose entry may activate after this one, and a redeclaration must
  // re-install the contribution.
  ctx.slots.inject('view', () => ctx.slots.register({
    name: 'view', key: AGENTS_VIEW, locale: NS, store, inject: injected,
  }, AgentsView))

  ctx.slots.inject('rail.item', () => ctx.slots.register({
    name: 'rail.item', id: AGENTS_VIEW, order: RAIL_ORDER, locale: NS,
  }, AgentsRailItem))
}
