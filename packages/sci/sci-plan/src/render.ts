/**
 * The text one accepted declaration returns to the model: the agents in run
 * order, and the dependency graph drawn as text.
 *
 * The studied platform returned nothing a model could read — the plan existed
 * only as cards in the user's browser, so a model that declared a cycle or a
 * dangling edge learned about it from neither side. Echoing the sorted plan
 * back makes the accepted shape part of the transcript, which is also what the
 * fan-out that follows is authorized against.
 *
 * These functions also run on session-log replay over arguments this build did
 * not produce, so a malformed edge is skipped rather than thrown on: a display
 * path must never break a replay.
 * @module @deepseek-ai/dsh-sci-plan/src/render
 */

import type { PersonaName, PlanIcon } from './types.ts'

/** The fields the result text draws for one accepted agent. */
export interface RenderedAgent {
  /** Identifier the edges refer to. */
  readonly id: string
  /** Card title naming what this agent is. */
  readonly name: string
  /** Card icon. */
  readonly icon: PlanIcon
  /** One sentence on what this agent does. */
  readonly task: string
  /** The subagent persona this agent's icon selects. */
  readonly persona: PersonaName
}

/**
 * Pluralize the agent count.
 * @param count - how many agents the plan declares.
 * @returns `agent` or `agents`.
 */
function agentWord(count: number): string {
  return count === 1 ? 'agent' : 'agents'
}

/**
 * Describe the dependency count in words, including the empty case a plan of
 * independent agents produces.
 * @param count - how many dependencies the plan declares.
 * @returns the phrase that completes the summary line.
 */
function dependencyPhrase(count: number): string {
  if (count === 0) return 'no dependencies'
  return count === 1 ? '1 dependency' : `${count} dependencies`
}

/**
 * Draw the dependency graph as one line per agent that others wait on.
 *
 * Sources appear in run order and each names its targets in declaration order,
 * so the drawing reads top-down like the plan runs. A dependency declared twice
 * is drawn once; an entry that does not hold two endpoints is drawn not at all,
 * because a replayed argument list is not re-validated.
 * @param agents - the agents in run order.
 * @param edges - the declared dependencies as `[from, to]` entries.
 * @returns the drawn lines, empty when no agent depends on another.
 */
export function formatDag(agents: readonly RenderedAgent[], edges: readonly (readonly string[])[]): readonly string[] {
  const targets = new Map<string, Set<string>>()
  for (const [from, to] of edges) {
    if (from === undefined || to === undefined) continue
    const known = targets.get(from)
    if (known === undefined) targets.set(from, new Set([to]))
    else known.add(to)
  }
  const lines: string[] = []
  for (const agent of agents) {
    const known = targets.get(agent.id)
    if (known !== undefined) lines.push(`  ${agent.id} → ${[...known].join(', ')}`)
  }
  return lines
}

/**
 * Render one accepted plan as the model reads it back.
 * @param agents - the agents in run order, as {@link validatePlan} sorted them.
 * @param edges - the declared dependencies.
 * @returns the model-facing result text.
 */
export function formatPlanResult(agents: readonly RenderedAgent[], edges: readonly (readonly string[])[]): string {
  const lines = [`research plan declared: ${agents.length} ${agentWord(agents.length)}, ${dependencyPhrase(edges.length)}.`]
  agents.forEach((agent, index) => {
    lines.push(`${index + 1}. ${agent.id} — ${agent.name} [${agent.icon}, runs as ${agent.persona}]: ${agent.task}`)
  })
  const dag = formatDag(agents, edges)
  if (dag.length > 0) lines.push('dependencies:', ...dag)
  return lines.join('\n')
}
