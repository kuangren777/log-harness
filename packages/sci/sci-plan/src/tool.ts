/**
 * The `declare_research_plan` tool — the model-facing replacement for the
 * studied platform's `mcp__clawsgo__declare_workflow_plan`.
 *
 * The parameter schema is reproduced verbatim from
 * `ClawsGO-System/02-MCP/clawsgo-server.md` §3, because the five icons are what
 * a user interface draws its progress cards from. Three things changed. The
 * plan is validated — unique ids, resolvable edges, no self-edge, no cycle —
 * instead of accepted as written. The accepted plan is echoed back in run
 * order, so the model can read what it just committed to. And the declaration
 * is a logged event rather than a browser-only side effect, which is what makes
 * it usable as the authorization `sci-tier` spends on the fan-out that follows.
 * @module @deepseek-ai/dsh-sci-plan/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { ICON_PERSONA, PERSONA_NAMES, PLAN_ICONS } from './personas.ts'
import { randomPlanId } from './plan-id.ts'
import { formatPlanResult } from './render.ts'
import type { RenderedAgent } from './render.ts'
import { validatePlan } from './validate.ts'

/** Name of the model-facing plan declaration tool. */
export const PLAN_TOOL = 'declare_research_plan'

/** The canonical value one accepted `declare_research_plan` call returns. */
export interface PlanToolValue {
  /** Identity of the declaration, and the token the next fan-out consumes. */
  readonly planId: string
  /**
   * The accepted agents in run order, dependencies before dependents, each
   * carrying the persona its icon selects.
   */
  readonly agents: readonly RenderedAgent[]
  /** The accepted dependencies as `[from, to]` pairs, in declaration order. */
  readonly edges: readonly (readonly string[])[]
}

/**
 * The model-facing description. It states the one obligation the gate enforces
 * — declare before fanning out, once per fan-out — because a model that learns
 * that only from a denied `workflow` call has already lost a turn.
 * @returns the composed tool description.
 */
export function describePlanTool(): string {
  return 'Announce how you intend to split the work before you fan out to a swarm. '
    + 'Declare one agent per parallel line of work, each with a short id that `edges` refers to, '
    + 'a card title, an icon, and one sentence saying what it does. '
    + `Icons select the subagent persona that runs the step: ${PLAN_ICONS.map(icon => `${icon} runs as ${ICON_PERSONA[icon]}`).join(', ')}. `
    + 'Use `edges` only for real ordering constraints — `[["installer", "verifier"]]` means the verifier waits for the installer; '
    + 'agents with no edge between them run in parallel. The plan must be acyclic and every edge must name a declared agent. '
    + 'One declaration authorizes one fan-out: declare again before the next one.'
}

/**
 * Format the refusal the model reads when a plan does not validate.
 * @param errors - every reason the plan was refused.
 * @returns the message the thrown error carries into the tool result.
 */
export function formatPlanRefusal(errors: readonly string[]): string {
  return [`${PLAN_TOOL} declared nothing: the plan has ${errors.length === 1 ? '1 problem' : `${errors.length} problems`}.`, ...errors.map(error => `- ${error}`)].join('\n')
}

/**
 * Register `declare_research_plan` on the mounting context.
 * @param ctx - the plugin context whose tool registry the tool joins.
 * @param maxAgents - inclusive cap on how many agents one plan may declare.
 */
export function applyPlanTool(ctx: Context, maxAgents: number): void {
  ctx.tools.register(defineTool({
    name: PLAN_TOOL,
    description: describePlanTool(),
    parameters: {
      agents: {
        type: 'array',
        required: true,
        description: 'One entry per parallel line of work, in the order you want them shown.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Short unique id for this agent; `edges` refers to it.' },
            name: { type: 'string', required: true, description: 'Card title naming what this agent is.' },
            icon: { type: 'string', required: true, enum: PLAN_ICONS, description: 'Card icon, which also selects the persona that runs the step.' },
            task: { type: 'string', required: true, description: 'One sentence on what this agent does.' },
          },
        },
      },
      edges: {
        type: 'array',
        description: 'Ordering constraints as [from, to] pairs. Omit when every agent runs independently.',
        items: { type: 'array', items: { type: 'string' } },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planId: { type: 'string', required: true },
          agents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                icon: { type: 'string', required: true, enum: PLAN_ICONS },
                task: { type: 'string', required: true },
                persona: { type: 'string', required: true, enum: PERSONA_NAMES },
              },
            },
          },
          edges: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatPlanResult(value.agents, value.edges) }],
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Declare a research plan of ${args.agents.length} ${args.agents.length === 1 ? 'agent' : 'agents'}`,
    }),
    execute(args, exec) {
      if (!exec.agent) {
        // A declaration is the authorization a later fan-out on the same
        // session spends; a caller with no session has no log to record it in.
        throw new Error(`${PLAN_TOOL} requires an owning agent session`)
      }
      if (args.agents.length > maxAgents) {
        throw new Error(formatPlanRefusal([`agents declares ${args.agents.length} agents; this deployment admits at most ${maxAgents}`]))
      }
      const checked = validatePlan(args)
      if (!checked.ok) throw new Error(formatPlanRefusal(checked.errors))
      const { plan, order } = checked
      const planId = randomPlanId()
      exec.agent.session.append('sci/plan-declared', { planId, agents: plan.agents, edges: plan.edges })
      return Promise.resolve({
        planId,
        agents: order.map(agent => ({ ...agent, persona: ICON_PERSONA[agent.icon] })),
        edges: plan.edges.map(([from, to]) => [from, to]),
      })
    },
  }))
}
