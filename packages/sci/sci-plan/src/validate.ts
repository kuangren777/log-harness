/**
 * The structural check one declared plan must pass, as a pure function.
 *
 * The studied platform's `declare_workflow_plan` validated nothing beyond JSON
 * shape (`ClawsGO-System/02-MCP/clawsgo-server.md` §3): a plan whose edges named
 * an agent that was never declared, or whose dependencies formed a cycle, was
 * accepted and drawn as a broken progress card. Here every violation is
 * reported at once, and every message names the agent index, id, or edge that
 * caused it, so one rejected call is enough for the model to write a correct
 * plan on the next.
 * @module @deepseek-ai/dsh-sci-plan/src/validate
 */

import { topologicalSort } from './graph.ts'
import type { EdgeIndices } from './graph.ts'
import { ICON_PERSONA, PRODUCER_ICONS, VERIFIER_ICON } from './personas.ts'
import type { PlanAgent, PlanEdge, PlanInput, ResearchPlan } from './types.ts'

/**
 * The outcome of validating one declared plan: the canonical plan and the run
 * order its dependencies imply, or every reason it was refused.
 */
export type PlanValidation =
  | { readonly ok: true; readonly plan: ResearchPlan; readonly order: readonly PlanAgent[] }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * Read one length-checked edge as the pair of endpoints it is, trimmed to match
 * the trimmed agent ids they are compared against.
 * @param edge - an edge entry already known to hold exactly two elements.
 * @returns its source and target ids.
 */
function endpointsOf(edge: readonly string[]): readonly [string, string] {
  const [from, to] = edge as readonly [string, string]
  return [from.trim(), to.trim()]
}

/**
 * Resolve node indices back to the agents they name.
 * @param agents - the declared agents, indexed as the graph indexed them.
 * @param nodes - node indices produced by {@link topologicalSort}.
 * @returns the agents those indices name, in the same order.
 */
function namesOf(agents: readonly PlanAgent[], nodes: readonly number[]): readonly PlanAgent[] {
  return nodes.map(node => agents[node]).filter((agent): agent is PlanAgent => agent !== undefined)
}

/**
 * The composition check: a plan is refused when nothing in it refutes.
 *
 * Two rules. Every plan declares at least one {@link VERIFIER_ICON} agent, so a
 * producer-only swarm never reaches the fan-out gate. And when the plan declares
 * a {@link PRODUCER_ICONS} agent — one that leaves code, results, or delivered
 * files behind — at least one verifier must depend on one of them by an edge,
 * so the adversary runs after the artifact exists and reads it, not the
 * producer's summary of it. Read-only plans (search and web agents only) need
 * only the first rule: they leave no artifact for a downstream check to open.
 * @param agents - the declared agents, already trimmed.
 * @param edges - the resolved dependencies as agent indices.
 * @returns every composition refusal, each naming what to add.
 */
function verifierErrors(agents: readonly PlanAgent[], edges: readonly EdgeIndices[]): readonly string[] {
  if (agents.length === 0) return []
  const verifiers = new Set<number>()
  const producers = new Set<number>()
  agents.forEach((agent, index) => {
    if (agent.icon === VERIFIER_ICON) verifiers.add(index)
    else if (PRODUCER_ICONS.includes(agent.icon)) producers.add(index)
  })
  const verifierPersona = ICON_PERSONA[VERIFIER_ICON]
  if (verifiers.size === 0) {
    return [
      `no agent carries icon ${JSON.stringify(VERIFIER_ICON)}; every plan needs at least one ${verifierPersona} `
      + 'that tries to break what the others produce — a swarm of producers alone is refused',
    ]
  }
  if (producers.size === 0) return []
  const audited = edges.some(([from, to]) => producers.has(from) && verifiers.has(to))
  if (audited) return []
  const producerIds = [...producers].map(index => JSON.stringify(agents[index]?.id)).join(', ')
  const verifierIds = [...verifiers].map(index => JSON.stringify(agents[index]?.id)).join(', ')
  return [
    `no edge leads from a producing agent (${producerIds}) into the ${verifierPersona} (${verifierIds}); `
    + `add an edge so the ${verifierPersona} runs after the artifact exists and checks the artifact itself`,
  ]
}

/**
 * Check one declared plan and produce its canonical form.
 *
 * Every text field is trimmed, and edges are matched against the trimmed ids,
 * so surrounding whitespace never turns into a dangling reference. Field and
 * reference errors are collected together; the cycle check runs only once they
 * are all absent, because a graph with an unresolvable endpoint has no
 * meaningful cycle to report.
 * @param input - the plan as the tool schema admitted it.
 * @returns the canonical plan with its run order, or the list of refusals, each
 *   naming the offending agent index, id, or edge.
 */
export function validatePlan(input: PlanInput): PlanValidation {
  const errors: string[] = []
  const agents: PlanAgent[] = []
  const indexOfId = new Map<string, number>()

  input.agents.forEach((agent, index) => {
    const id = agent.id.trim()
    const name = agent.name.trim()
    const task = agent.task.trim()
    const firstIndex = indexOfId.get(id)
    if (id.length === 0) errors.push(`agents[${index}].id is empty; every agent needs an id for edges to reference`)
    else if (firstIndex === undefined) indexOfId.set(id, index)
    else errors.push(`agents[${index}].id ${JSON.stringify(id)} repeats the id already declared at agents[${firstIndex}]; ids must be unique`)
    if (name.length === 0) errors.push(`agents[${index}].name is empty; it is the card title the user reads`)
    if (task.length === 0) errors.push(`agents[${index}].task is empty; it is the one sentence saying what this agent does`)
    agents.push({ id, name, icon: agent.icon, task })
  })
  if (agents.length === 0) errors.push('agents is empty; a plan must declare at least one agent')

  const declared = input.edges ?? []
  const edges: PlanEdge[] = []
  const indexEdges: EdgeIndices[] = []
  declared.forEach((edge, index) => {
    if (edge.length !== 2) {
      errors.push(`edges[${index}] has ${edge.length} entries; an edge is a [from, to] pair`)
      return
    }
    const [from, to] = endpointsOf(edge)
    if (from === to) {
      errors.push(`edges[${index}] points ${JSON.stringify(from)} at itself; an agent cannot depend on itself`)
      return
    }
    const fromIndex = indexOfId.get(from)
    const toIndex = indexOfId.get(to)
    if (fromIndex === undefined) errors.push(`edges[${index}] starts at ${JSON.stringify(from)}, which no agent declares`)
    if (toIndex === undefined) errors.push(`edges[${index}] ends at ${JSON.stringify(to)}, which no agent declares`)
    if (fromIndex === undefined || toIndex === undefined) return
    edges.push([from, to])
    indexEdges.push([fromIndex, toIndex])
  })

  errors.push(...verifierErrors(agents, indexEdges))
  if (errors.length > 0) return { ok: false, errors }

  const sorted = topologicalSort(agents.length, indexEdges)
  if (!sorted.ok) {
    const named = namesOf(agents, sorted.cycle).map(agent => JSON.stringify(agent.id)).join(', ')
    return { ok: false, errors: [`edges form a dependency cycle; ${named} can never start because each waits on another`] }
  }
  return { ok: true, plan: { agents, edges }, order: namesOf(agents, sorted.order) }
}
