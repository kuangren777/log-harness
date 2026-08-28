/**
 * Durable vocabulary of the research-plan layer: the five card icons a declared
 * agent may carry, the six subagent personas they map onto, the canonical plan
 * a validated declaration produces, and the session event that publishes it.
 * @module @deepseek-ai/dsh-sci-plan/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Icon of one declared agent's card. The five values are the enumeration the
 * studied platform's `declare_workflow_plan` accepted
 * (`ClawsGO-System/02-MCP/clawsgo-server.md` §3); they are reproduced verbatim
 * because a user interface keys its card artwork off them and a sixth value
 * would render as nothing.
 */
export type PlanIcon = 'web' | 'search' | 'security' | 'code' | 'check'

/**
 * Name of one subagent persona of the science-research profile. The six are the
 * agent definitions the `sci` preset installs
 * (`ClawsGO-System/09-Target-Architecture/05-tier-model.md`); `sci-tier` asserts
 * that every persona named by {@link SciPlanDeclaredData} exists in that roster.
 */
export type PersonaName = 'researcher' | 'adversary' | 'scout' | 'writer' | 'plotter' | 'deliverer'

/** One agent as the model declares it, before validation trims or checks anything. */
export interface PlanAgentInput {
  /** Identifier the `edges` list references. */
  readonly id: string
  /** Card title naming what this agent is. */
  readonly name: string
  /** Card icon; the parameter schema admits only the five {@link PlanIcon} values. */
  readonly icon: PlanIcon
  /** One-sentence description of what this agent does. */
  readonly task: string
}

/**
 * One plan as the model declares it. `edges` is a list of two-element arrays
 * rather than typed pairs because the tool parameter schema cannot express a
 * fixed array length; {@link PlanEdge} is the validated form.
 */
export interface PlanInput {
  /** The agents the plan declares, in the order the model wrote them. */
  readonly agents: readonly PlanAgentInput[]
  /** Dependency pairs `[from, to]`; absent when every agent runs independently. */
  readonly edges?: readonly (readonly string[])[]
}

/** One agent of a validated plan: the same four fields, with every text field trimmed. */
export interface PlanAgent {
  /** Identifier the plan's edges reference; unique within one plan and non-empty. */
  readonly id: string
  /** Card title naming what this agent is; non-empty. */
  readonly name: string
  /** Card icon, one of the five {@link PlanIcon} values. */
  readonly icon: PlanIcon
  /** One-sentence description of what this agent does; non-empty. */
  readonly task: string
}

/**
 * One validated dependency: `from` must finish before `to` starts. Both ends
 * name an agent of the same plan and are never equal.
 */
export type PlanEdge = readonly [from: string, to: string]

/** A plan that passed every structural check: non-empty, uniquely identified, and acyclic. */
export interface ResearchPlan {
  /** The declared agents, in declaration order. */
  readonly agents: readonly PlanAgent[]
  /** The declared dependencies, in declaration order; empty when the model declared none. */
  readonly edges: readonly PlanEdge[]
}

/**
 * Opaque identity of one declared plan. It is the value `sci-tier`'s fan-out
 * latch consumes, so it crosses the session-log and process boundaries between
 * the two packages and is branded rather than a bare string.
 */
export type SciPlanId = Branded<'SciPlanId'>

/** Payload of {@link SessionEventMap['sci/plan-declared']}. */
export interface SciPlanDeclaredData {
  /** Identity of this declaration; the token `sci-tier`'s fan-out latch consumes exactly once. */
  readonly planId: SciPlanId
  /** The declared agents, validated and in declaration order. */
  readonly agents: readonly PlanAgent[]
  /** The declared dependencies, validated and in declaration order; empty when there are none. */
  readonly edges: readonly PlanEdge[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The model announced how it intends to split the work before fanning out.
     * This record is the authorization `sci-tier`'s G1 gate spends: a `workflow`
     * or `subagent` call is admitted only when a plan was declared and not yet
     * consumed, and a process that restarts mid-session rebuilds that latch by
     * replaying the log. A reader that skipped this event would therefore admit
     * a fan-out the deployment refused, so it is required-on-read and carries no
     * `ignorable` marker. It is also what a user interface draws the named
     * progress cards from.
     * @param data - the plan identity, the declared agents with their card text
     *   and icons, and the dependency pairs ordering them.
     */
    'sci/plan-declared': SciPlanDeclaredData
  }
}
