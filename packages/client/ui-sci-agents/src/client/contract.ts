/**
 * The agent view's data vocabulary.
 *
 * Every member here is JSON-compatible: the components see plain records and
 * callbacks, never an RPC envelope, so the whole wire seam is the `apply`
 * body that builds {@link SciAgentsInjected}.
 *
 * The record types below MIRROR the `sci.agents` namespace payloads of spec
 * 16-Workbench/12-spec-agents.md §2.3, the same way ui-sci-search mirrors
 * `sci-literature`. They live here only until `packages/sci/sci-agents` ships
 * a client-safe `./types` export; the assembly step then replaces this block
 * with `import type { … } from '@deepseek-ai/dsh-sci-agents/types'` and this
 * file keeps only the outcome vocabulary and the injected face.
 */

/** One base-model selection: a provider and one of its model ids. */
export interface AgentModelRef {
  /** Provider id as the host's model catalog names it. */
  provider: string
  /** Model id inside that provider. */
  model: string
}

/**
 * The three tool permissions a persona's `toolFilter.deny` encodes.
 *
 * `true` means the sub-agent keeps the tools; `false` means the host denies
 * them at `ctx.tools.restrict` time, which is where the switch really lands.
 */
export interface AgentPermissions {
  /** Web search, web fetch, and literature search. */
  web: boolean
  /** Sandbox code execution and file writes. */
  code: boolean
  /** Writes into the shared knowledge base. */
  writeLibrary: boolean
}

/** This month's real usage of one persona, as far as the host can read it. */
export interface AgentStats {
  /** Delegations to this persona since the start of the month. */
  monthCalls: number
  /** Mean wall-clock duration, absent when no call reported a timing. */
  avgDurationMs?: number
  /** Output tokens this month, absent unless settlements carried usage. */
  monthTokens?: number
}

/** One persona as the roster reports it: metadata, live settings, real stats. */
export interface RosterAgent {
  /** Stable persona id — the handle every write takes, never the name. */
  persona: string
  /** Wire tool name the model delegates through, e.g. `subagent_scout`. */
  toolName: string
  /** Display name from the persona file. */
  name: string
  /** One-line role, drawn under the name. */
  role: string
  /** The persona's charter summary, drawn as the card's description. */
  summary: string
  /** Persona icon key the research plan uses, when the host declares one. */
  icon?: string
  /** Whether delegation to this persona is currently accepted. */
  enabled: boolean
  /** The configured base model, absent while the persona follows the session's. */
  model?: AgentModelRef
  /** The three permission switches, resolved from settings. */
  permissions: AgentPermissions
  /** This month's real usage. */
  stats: AgentStats
}

/** How one delegation ended, or that it has not ended yet. */
export type AgentCallStatus = 'ok' | 'error' | 'running'

/** One delegation to this persona, from the audit table plus its timing. */
export interface AgentCall {
  /** Epoch milliseconds of the tool call. */
  ts: number
  /** The session that delegated — the one a row click reopens. */
  sessionId: string
  /** Tool-call id, unique inside its session. */
  callId: string
  /** The task text the model handed the persona. */
  task: string
  /** Wall-clock duration, absent while the call is still running. */
  durationMs?: number
  /** How the call ended. */
  status: AgentCallStatus
  /** Output tokens, absent unless the settlement carried usage. */
  outputTokens?: number
  /** Web retrievals the child made, absent while its log was unreadable. */
  retrievalCalls?: number
  /** Retrievals that repeated an earlier one verbatim — the redundancy figure. */
  retrievalRepeats?: number
}

/** One model in the host's catalog. */
export interface ModelOption {
  /** Model id inside its provider. */
  model: string
}

/** One provider's slice of the host's model catalog. */
export interface ModelProvider {
  /** Provider id. */
  provider: string
  /** The provider's models, in catalog order. */
  models: readonly ModelOption[]
}

/** One configuration write: only the fields the gesture actually changed. */
export interface AgentPatch {
  /** Turn delegation to this persona on or off. */
  enabled?: boolean
  /** Pin the base model. */
  model?: AgentModelRef
  /** Replace all three permission switches. */
  permissions?: AgentPermissions
}

/** A settled roster read, stated so the view never sees an RPC error. */
export type RosterOutcome =
  | { ok: true; agents: readonly RosterAgent[] }
  | { ok: false; code: string }

/** A settled configuration write, carrying the agent the host now reports. */
export type ConfigureOutcome =
  | { ok: true; agent: RosterAgent }
  | { ok: false; code: string }

/** A settled delegation-log read. */
export type CallsOutcome =
  | { ok: true; calls: readonly AgentCall[] }
  | { ok: false; code: string }

/**
 * The injected face the view drives; every member is built in `apply`.
 *
 * Declared as properties rather than methods because the view destructures
 * them out of its props: a method position would bind them to this face.
 */
export interface SciAgentsInjected {
  /** Read the whole roster: metadata, live settings, and this month's stats. */
  readonly roster: () => Promise<RosterOutcome>
  /**
   * Write one patch for one persona and answer with the agent the host
   * reports afterwards — the view draws that, never its own optimistic copy.
   */
  readonly configure: (persona: string, patch: AgentPatch) => Promise<ConfigureOutcome>
  /** Read one persona's delegation log, newest first. */
  readonly calls: (persona: string) => Promise<CallsOutcome>
  /**
   * Read the host's model catalog; an unreadable catalog answers empty, and
   * the configuration page then states that instead of offering a choice.
   */
  readonly models: () => Promise<readonly ModelProvider[]>
  /** Open the session that made one delegation and show the research flow. */
  readonly openSession: (sessionId: string) => void
}
