/**
 * Shared state of the agent view: which page it is on, which persona that
 * page is about, the roster the host reported, that roster's delegation logs
 * and model catalog, and where the last configuration write stands.
 *
 * Nothing transient lives here. This view has three pages and a user walks
 * between them, so the page, the selected persona, and everything already
 * read from the host must survive a trip through the research flow and back —
 * an entry-local state would send them back to a loading roster every time.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { AgentCall, ModelProvider, RosterAgent } from './contract.ts'

/** Which of the three pages the view is showing. */
export type AgentsPage = 'roster' | 'config' | 'log'

/** Where the roster read stands. */
export type RosterStatus = 'loading' | 'ready' | 'error'

/** Where the last configuration write stands. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** The view's shared state. */
export interface AgentsState {
  /** The page on screen. */
  page: AgentsPage
  /** The persona the config and log pages are about, or null on the roster. */
  persona: string | null
  /** Where the roster read stands. */
  status: RosterStatus
  /** The failure code of the roster read, or null. */
  error: string | null
  /** The roster the host reported, in host order. */
  agents: RosterAgent[]
  /** Delegation logs by persona id, filled as each read settles. */
  callsByPersona: Record<string, AgentCall[]>
  /** Failure code of the last delegation-log read, by persona id. */
  callsErrors: Record<string, string>
  /** The host's model catalog; empty when it could not be read. */
  models: ModelProvider[]
  /** Where the last configuration write stands. */
  save: SaveStatus
  /** The failure code of the last configuration write, or null. */
  saveError: string | null
}

/** Declared action shape, so the exported factory keeps a stable return type. */
type AgentsActions = {
  beginLoad: (draft: AgentsState) => void
  loaded: (draft: AgentsState, agents: readonly RosterAgent[]) => void
  failed: (draft: AgentsState, code: string) => void
  setCalls: (draft: AgentsState, persona: string, calls: readonly AgentCall[]) => void
  setCallsFailed: (draft: AgentsState, persona: string, code: string) => void
  setModels: (draft: AgentsState, providers: readonly ModelProvider[]) => void
  showRoster: (draft: AgentsState) => void
  showConfig: (draft: AgentsState, persona: string) => void
  showLog: (draft: AgentsState, persona: string) => void
  beginSave: (draft: AgentsState) => void
  saved: (draft: AgentsState, agent: RosterAgent) => void
  saveFailed: (draft: AgentsState, code: string) => void
}

/**
 * Declares the agent view's shared state and its complete write surface.
 * @returns the store handle (one per plugin body — never a module singleton).
 */
export function createAgentsStore(): EngineStoreHandle<AgentsState, AgentsActions> {
  return defineStore({
    init: (): AgentsState => ({
      page: 'roster',
      persona: null,
      status: 'loading',
      error: null,
      agents: [],
      callsByPersona: {},
      callsErrors: {},
      models: [],
      save: 'idle',
      saveError: null,
    }),
    actions: {
      // A refresh keeps the page and the persona: the numbers on a card may
      // move while the user is reading a log, and sending them back to the
      // roster for that would be the view losing their place.
      beginLoad: (d) => {
        d.status = 'loading'
        d.error = null
      },
      loaded: (d, agents: readonly RosterAgent[]) => {
        d.status = 'ready'
        d.error = null
        d.agents = [...agents]
      },
      failed: (d, code: string) => {
        d.status = 'error'
        d.error = code
      },
      setCalls: (d, persona: string, calls: readonly AgentCall[]) => {
        d.callsByPersona[persona] = [...calls]
        // Reflect, not `delete`: the key is the persona id, and the record
        // must not keep a failure that a later read already disproved.
        Reflect.deleteProperty(d.callsErrors, persona)
      },
      // A log the host could not read is stated as such: an empty list would
      // read as 「还没有被委派过」, which is a different fact.
      setCallsFailed: (d, persona: string, code: string) => {
        d.callsErrors[persona] = code
      },
      setModels: (d, providers: readonly ModelProvider[]) => { d.models = [...providers] },
      showRoster: (d) => {
        d.page = 'roster'
        d.persona = null
        d.save = 'idle'
        d.saveError = null
      },
      showConfig: (d, persona: string) => {
        d.page = 'config'
        d.persona = persona
        d.save = 'idle'
        d.saveError = null
      },
      showLog: (d, persona: string) => {
        d.page = 'log'
        d.persona = persona
      },
      beginSave: (d) => {
        d.save = 'saving'
        d.saveError = null
      },
      // Indexed by persona, never by name: the display name is the one field
      // a host-side persona edit can move.
      saved: (d, agent: RosterAgent) => {
        d.save = 'saved'
        d.saveError = null
        const at = d.agents.findIndex(candidate => candidate.persona === agent.persona)
        if (at >= 0) d.agents[at] = agent
      },
      saveFailed: (d, code: string) => {
        d.save = 'error'
        d.saveError = code
      },
    },
  })
}

/** The agent view's store handle type, for the components' `PropsStore` share. */
export type AgentsStore = ReturnType<typeof createAgentsStore>
