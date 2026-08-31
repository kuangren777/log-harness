/**
 * The icon-to-persona mapping, the cross-package contract this package defines
 * and `sci-tier` consumes.
 *
 * The studied platform's plan schema carried five card icons and nothing else;
 * which subagent actually ran was decided later, by prose in the Workflow
 * script. Here one icon names one persona, so the card a user sees and the
 * agent definition that runs are the same choice made once.
 * @module @deepseek-ai/dsh-sci-plan/src/personas
 */

import type { PersonaName, PlanIcon } from './types.ts'

/** The five card icons, in the order the tool description lists them. */
export const PLAN_ICONS: readonly PlanIcon[] = ['web', 'search', 'security', 'code', 'check']

/**
 * The one icon whose persona refutes rather than produces. Every declared plan
 * must carry at least one agent with this icon: a swarm of producers alone
 * ships whatever its producers believe, and the studied platform's fabricated
 * reproduction (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §3) left the swarm
 * precisely because no node in the DAG was asked to break it.
 */
export const VERIFIER_ICON: PlanIcon = 'security'

/**
 * The icons whose personas leave an artifact behind — written code, rendered
 * results, delivered files. When a plan declares one of these, its verifier must
 * sit downstream of one by an edge, so the adversary reads the artifact and the
 * log that produced it rather than the producer's own account of it.
 */
export const PRODUCER_ICONS: readonly PlanIcon[] = ['code', 'check']

/**
 * The six subagent personas of the science-research profile. `sci-tier` asserts
 * that the persona files it installs cover exactly this set, so a renamed agent
 * definition fails at load rather than at the first fan-out.
 */
export const PERSONA_NAMES: readonly PersonaName[] = [
  'researcher',
  'adversary',
  'scout',
  'writer',
  'plotter',
  'deliverer',
]

/**
 * Which persona each declared icon runs as.
 *
 * `plotter` is deliberately absent from the value set: figure work is not a
 * distinguishable intent at the card level — a plotting step reads as `code`
 * to a user watching the plan — so `plotter` is reachable only when an agent's
 * `task` text asks for a figure and the orchestrating thread selects it
 * explicitly. Adding a sixth icon for it would change a schema a user
 * interface keys its artwork off; naming it here would route every code step
 * to the wrong persona.
 */
export const ICON_PERSONA: Readonly<Record<PlanIcon, PersonaName>> = {
  web: 'researcher',
  search: 'scout',
  security: 'adversary',
  code: 'writer',
  check: 'deliverer',
}
