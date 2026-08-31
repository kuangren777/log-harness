/**
 * Plan declaration for the science-research agent profile: the
 * `declare_research_plan` tool, the validation that makes a declared plan a
 * real DAG, and the `sci/plan-declared` event that authorizes the fan-out
 * following it.
 *
 * `apply` owns one contribution, an effect of the mounting fiber:
 * `declare_research_plan` on `ctx.tools`. Everything else this package exports
 * is a pure function or a type another package consumes — `ICON_PERSONA` is the
 * icon-to-persona contract `sci-tier` reads, and `validatePlan` is the same
 * check a rebuild can re-run over the log.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-plan
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import { applyPlanTool } from './tool.ts'

export { topologicalSort } from './graph.ts'
export type { EdgeIndices, TopologicalSort } from './graph.ts'
export { ICON_PERSONA, PERSONA_NAMES, PLAN_ICONS, PRODUCER_ICONS, VERIFIER_ICON } from './personas.ts'
export { SciPlanId, randomPlanId } from './plan-id.ts'
export { formatDag, formatPlanResult } from './render.ts'
export type { RenderedAgent } from './render.ts'
export { PLAN_TOOL, applyPlanTool, describePlanTool, formatPlanRefusal } from './tool.ts'
export type { PlanToolValue } from './tool.ts'
export { validatePlan } from './validate.ts'
export type { PlanValidation } from './validate.ts'
export type {
  PersonaName,
  PlanAgent,
  PlanAgentInput,
  PlanEdge,
  PlanIcon,
  PlanInput,
  ResearchPlan,
  SciPlanDeclaredData,
  SciPlanId as SciPlanIdType,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'sci-plan'

/** The tool registry the plan declaration tool joins. */
export const inject = ['tools']

/**
 * Default cap on how many agents one plan may declare: wider than any observed
 * cluster fan-out, narrow enough that a runaway plan is refused where the model
 * can still fix it.
 */
const DEFAULT_MAX_AGENTS = 16

/** Deployment-varying choices for the science-research plan layer. */
export interface Config {
  /**
   * Inclusive cap on how many agents one declaration may name. The plan is
   * model-authored JSON and the cluster width a deployment can actually run
   * varies with its machine, so a plan wider than that is refused at
   * declaration — where the model still has the turn to narrow it — rather
   * than accepted and then partly unrunnable.
   */
  maxAgents: number
}

/** Schemastery schema for the science-research plan layer. */
export const Config: z<Config> = z.object({
  maxAgents: z.number().step(1).min(1).default(DEFAULT_MAX_AGENTS),
})

/**
 * Register the plan declaration tool on the mounting context.
 * @param ctx - the mounting context, carrying `tools`.
 * @param config - the resolved deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  applyPlanTool(ctx, config.maxAgents)
}
