/**
 * Wire vocabulary of the `sci.agents` namespace: the roster row a persona card
 * is drawn from, the patch a configuration gesture sends, one delegation log
 * entry, and the model catalog the base-model picker offers.
 *
 * This module contains types only, so the browser face can import the contract
 * without importing Host runtime code.
 * @module @deepseek-ai/dsh-sci-agents/types
 */

/** One base-model selection: a provider route and one of its model ids. */
export interface AgentModelRef {
  /** Provider id as the host's model catalog names it. */
  readonly provider: string
  /** Model id inside that provider. */
  readonly model: string
}

/**
 * The three tool permissions a persona's `toolFilter.deny` encodes.
 *
 * `true` means the child keeps the group's tools; `false` means every one of
 * them is denied, which `ctx.tools.restrict()` applies at child creation — the
 * denied tool is absent from the child's prompt AND refuses to execute.
 */
export interface AgentPermissions {
  /** Web search, web fetch, and literature search. */
  readonly web: boolean
  /** Sandbox code execution and file writes. */
  readonly code: boolean
  /** Writes into the shared knowledge base. */
  readonly writeLibrary: boolean
}

/** This month's real usage of one persona, as far as the host can read it. */
export interface AgentStats {
  /** Delegations to this persona since the start of the current month. */
  readonly monthCalls: number
  /** Mean delegation duration this month, absent when no call reported one. */
  readonly avgDurationMs?: number
  /** Output tokens this month, absent unless a settlement carried usage. */
  readonly monthTokens?: number
}

/** One persona as the roster reports it: metadata, live settings, real stats. */
export interface RosterAgent {
  /** Stable persona id — the handle every write takes, never the display name. */
  readonly persona: string
  /** Registered tool name the model delegates through, e.g. `subagent_scout`. */
  readonly toolName: string
  /** Card title, from the persona document's `display.name`. */
  readonly name: string
  /** One line under the title, from `display.role`. */
  readonly role: string
  /** Card body, from `display.description`. */
  readonly summary: string
  /** The `declare_research_plan` icon that selects this persona, when one does. */
  readonly icon?: string
  /**
   * Whether delegation to this persona is currently accepted. `false` keeps the
   * tool registered and refuses every call with a message the model can read.
   */
  readonly enabled: boolean
  /** The pinned base model, absent while the persona follows the child-loop default. */
  readonly model?: AgentModelRef
  /** The three permission switches, resolved from the delegation tool's settings. */
  readonly permissions: AgentPermissions
  /** This month's real usage. */
  readonly stats: AgentStats
}

/** How one delegation ended, or that it has not ended yet. */
export type AgentCallStatus = 'ok' | 'error' | 'running'

/** One delegation to one persona, read from the delegating session's log. */
export interface AgentCall {
  /** Epoch milliseconds of the `tool/call` record. */
  readonly ts: number
  /** The session that delegated — the one a row click reopens. */
  readonly sessionId: string
  /** Tool-call id, unique inside that session. */
  readonly callId: string
  /** The task text the model handed the persona (the call's `description`). */
  readonly task: string
  /**
   * The child's own turn time, from its `subagentTiming` projection. Absent
   * while the call is still running and whenever the child cannot be
   * identified — never the parent's dispatch latency, which for a background
   * delegation would report milliseconds for minutes of work.
   */
  readonly durationMs?: number
  /** How the call ended. */
  readonly status: AgentCallStatus
  /** Output tokens, absent unless the settlement carried usage. */
  readonly outputTokens?: number
  /** Web retrievals (searches and fetches) the child made, when its log was readable. */
  readonly retrievalCalls?: number
  /**
   * Retrievals that repeated an earlier one of the same tool and arguments —
   * the same query searched again, the same page fetched again. The studied
   * platform's literature subagent searched 29 times over one paper set
   * (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §5 row 9); this is that figure.
   */
  readonly retrievalRepeats?: number
}

/** One model in the host's catalog. */
export interface ModelOption {
  /** Model id inside its provider. */
  readonly model: string
}

/** One provider's slice of the host's model catalog. */
export interface ModelProvider {
  /** Provider route id. */
  readonly provider: string
  /** The provider's models, in catalog order. */
  readonly models: readonly ModelOption[]
}

/** One configuration write: only the fields the gesture actually changed. */
export interface AgentPatch {
  /** Turn delegation to this persona on or off. */
  readonly enabled?: boolean
  /** Pin the base model. */
  readonly model?: AgentModelRef
  /** Replace all three permission switches. */
  readonly permissions?: AgentPermissions
}

/** Request of the `sci.agents` `configure` endpoint. */
export interface ConfigureRequest {
  /** The persona to reconfigure, by its stable id. */
  readonly persona: string
  /** The fields this gesture changed. */
  readonly patch: AgentPatch
}

/** Request of the `sci.agents` `calls` endpoint. */
export interface CallsRequest {
  /** The persona whose delegation log to read. */
  readonly persona: string
  /** Newest-first cap on the returned rows; defaults to 50. */
  readonly limit?: number
}

/** Answer of the `sci.agents` `roster` endpoint. */
export interface RosterResult {
  /** The six personas, in `PERSONA_NAMES` order. */
  readonly agents: readonly RosterAgent[]
}

/** Answer of the `sci.agents` `configure` endpoint. */
export interface ConfigureResult {
  /** The persona as the host reports it after the write. */
  readonly agent: RosterAgent
}

/** Answer of the `sci.agents` `calls` endpoint. */
export interface CallsResult {
  /** The delegations, newest first. */
  readonly calls: readonly AgentCall[]
}

/** Answer of the `sci.agents` `models` endpoint. */
export interface ModelsResult {
  /** Providers that answered, each with the models it advertises. */
  readonly providers: readonly ModelProvider[]
  /** Providers whose catalog lookup failed; the others stay usable. */
  readonly failures: readonly ModelCatalogFailure[]
}

/** One provider whose catalog lookup did not answer. */
export interface ModelCatalogFailure {
  /** Provider route id. */
  readonly provider: string
  /** The lookup's own diagnostic. */
  readonly message: string
}
