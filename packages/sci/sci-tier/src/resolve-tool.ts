/**
 * The `resolve_tier` tool — how the auto composition's session gets its tier.
 *
 * The studied platform bound the tier before the task was known, by a user
 * choice made at session start, and a task that outgrew that choice left the
 * model between a refused swarm and a hollow deliverable
 * (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §1.2, §6.1). Here the composition
 * mounts the swarm and the model resolves the tier from the task: the call
 * appends `sci/tier-resolved` with `resolvedBy: 'model'` and the reason, the
 * gates read the latest such record, and a second call raises a balanced
 * session to cluster mid-way. A tier is only ever raised: the swarm's spend is
 * what the user reserved, and a session that has already started one finishes
 * in it.
 * @module @deepseek-ai/dsh-sci-tier/src/resolve-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { rebuildResolvedTier } from './latch.ts'
import { PRESET_NAMES } from './presets.ts'
import type { SciTier } from './types.ts'

/** Name of the model-facing tier resolution tool. */
export const RESOLVE_TOOL = 'resolve_tier'

/** The two tiers the model may resolve a session to, in the order the schema lists them. */
export const RESOLVABLE_TIERS: readonly SciTier[] = ['balanced', 'cluster']

/**
 * The model-facing description. It states when each tier is right, that the
 * call is what opens the fan-out gate, and that a balanced resolution can be
 * raised later — so the model neither fans out before resolving nor stays in a
 * pass the task has outgrown.
 * @returns the composed tool description.
 */
export function describeResolveTool(): string {
  return 'Resolve this session\'s tier from the task, before any other tool call. `cluster` when the work needs a '
    + 'real experiment or reproduction, systematic multi-source research, or due-diligence-grade coverage that '
    + 'one thread cannot honestly finish; `balanced` for everything one careful pass covers. Until you resolve, '
    + 'no fan-out tool runs. Call it again with `cluster` and the reason the moment a balanced task turns out '
    + 'larger than one pass — a tier is only ever raised, never lowered. Give one sentence on why the task '
    + 'needs the tier you chose.'
}

/**
 * The text the model reads after a resolution: which tier the session now runs
 * at and the one obligation that tier brings.
 * @param tier - the resolved tier.
 * @param reason - the model's reason, as it wrote it.
 * @returns the result text.
 */
export function formatResolveResult(tier: SciTier, reason: string): string {
  if (tier === 'cluster') {
    return `Tier resolved to Swarm mode: ${reason}\n`
      + 'Declare a plan with declare_research_plan immediately before every fan-out; every plan carries an adversary.'
  }
  return `Tier resolved to Solo mode: ${reason}\n`
    + 'Do the work in this thread. If it outgrows one pass, call resolve_tier again with cluster and the reason.'
}

/**
 * Register `resolve_tier` on the mounting context.
 * @param ctx - the plugin context whose tool registry the tool joins.
 */
export function applyResolveTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: RESOLVE_TOOL,
    description: describeResolveTool(),
    parameters: {
      tier: {
        type: 'string',
        required: true,
        enum: RESOLVABLE_TIERS,
        description: 'The tier the task needs: cluster for a swarm, balanced for one pass.',
      },
      reason: {
        type: 'string',
        required: true,
        description: 'One sentence on why the task needs this tier.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tier: { type: 'string', required: true, enum: RESOLVABLE_TIERS },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatResolveResult(value.tier, value.reason) }],
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Resolve the tier: ${args.tier === 'cluster' ? 'Swarm' : 'Solo'}`,
    }),
    execute(args, exec) {
      if (!exec.agent) {
        // The resolution is the record the gates read; a caller with no
        // session has no log to leave it in and no gate to open.
        throw new Error(`${RESOLVE_TOOL} requires an owning agent session`)
      }
      const reason = args.reason.trim()
      if (reason === '') {
        throw new Error(`${RESOLVE_TOOL} needs a reason: one sentence on why the task needs the ${args.tier} tier`)
      }
      const session = exec.agent.session
      if (args.tier === 'balanced' && rebuildResolvedTier(session.events) === 'cluster') {
        throw new Error(`${RESOLVE_TOOL} refused: this session is already resolved to cluster, and a tier is only ever raised. Finish the work in the swarm.`)
      }
      session.append('sci/tier-resolved', {
        tier: args.tier,
        presetName: session.header.agentPreset ?? PRESET_NAMES.auto,
        resolvedBy: 'model',
        reason,
      })
      return Promise.resolve({ tier: args.tier, reason })
    },
  }))
}
