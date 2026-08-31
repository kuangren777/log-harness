/**
 * The `suggest_tier_upgrade` tool — the balanced tier's legitimate exit.
 *
 * The studied platform's balanced reminder ended with "suggest the user rerun it
 * in Agent cluster mode", which the model could only do in prose: the suggestion
 * reached the user as a sentence in a reply and nothing could act on it. Here it
 * is a tool call, so the suggestion becomes a logged
 * `sci/tier-upgrade-suggested` record a user interface can turn into an upgrade
 * button, and the reason the model gave is quoted into the forked session's
 * opening message instead of being lost with the old thread.
 * @module @deepseek-ai/dsh-sci-tier/src/suggest-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
// Type-only: merges the event this tool appends into the session event map.
import type {} from './types.ts'

/** Name of the model-facing tier-upgrade suggestion tool. */
export const SUGGEST_TOOL = 'suggest_tier_upgrade'

/**
 * The model-facing description. It states what the tool does NOT do — it does
 * not switch tiers and does not start a swarm — because a model that reads
 * "upgrade" as an action would call it and then wait for capabilities that never
 * arrive in this session.
 * @returns the composed tool description.
 */
export function describeSuggestTool(): string {
  return 'Tell the user this task would be better served by Swarm mode, which fans the work out '
    + 'across parallel subagents. This does not change the current session: it records the suggestion so '
    + 'the user can decide, and they continue in a new session if they accept. Call it only after you have '
    + 'delivered what a single honest pass covers — a real smaller pilot with its reduced scope stated, never '
    + 'a large-looking result whose numbers no real run produced — and say in one sentence what the swarm '
    + 'would add that this pass could not: which angles stay uncovered, which sources stay unread, which '
    + 'experiment stays unrun at full scale.'
}

/**
 * Register `suggest_tier_upgrade` on the mounting context.
 * @param ctx - the plugin context whose tool registry the tool joins.
 */
export function applySuggestTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: SUGGEST_TOOL,
    description: describeSuggestTool(),
    parameters: {
      reason: {
        type: 'string',
        required: true,
        description: 'One sentence on what a swarm would add that this single pass could not.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Suggested Swarm mode to the user: ${value.reason}\n`
          + 'The current session stays in Solo mode. Finish and deliver what this pass covers.',
      }],
    },
    presentCall: (): GenericCallView => ({
      card: 'generic',
      title: 'Suggest Swarm mode',
    }),
    execute(args, exec) {
      if (!exec.agent) {
        // The suggestion's whole value is the record it leaves for the user to
        // act on; a caller with no session has no log to leave it in.
        throw new Error(`${SUGGEST_TOOL} requires an owning agent session`)
      }
      const reason = args.reason.trim()
      if (reason === '') {
        throw new Error(`${SUGGEST_TOOL} needs a reason: one sentence on what a swarm would add that this pass could not`)
      }
      exec.agent.session.append('sci/tier-upgrade-suggested', { reason }, { ignorable: true })
      return Promise.resolve({ reason })
    },
  }))
}
