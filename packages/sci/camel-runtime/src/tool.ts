/**
 * The `fork_workspace` tool: the model names N variants, each a shell command,
 * and gets N result directories back in the workspace it already knows.
 * @module @deepseek-ai/dsh-camel-runtime/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { ForkOutcome, ForkRequest, ForkVariantResult } from './types.ts'

/** Name of the model-facing fork tool. */
export const FORK_TOOL = 'fork_workspace'

/** Shape a variant name must have: it becomes a directory name the model reads back. */
export const VARIANT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Bounds the tool enforces beyond the parameter schema. */
export interface ForkToolLimits {
  readonly maxVariants: number
  readonly defaultTimeoutSeconds: number
  readonly maxTimeoutSeconds: number
}

/** The callback the tool hands a validated request to. */
export type ForkRunner = (request: ForkRequest) => Promise<ForkOutcome>

/** The canonical value one `fork_workspace` call returns. */
export interface ForkToolValue {
  readonly forkId: string
  readonly variants: readonly ForkVariantResult[]
}

/** Raw arguments as the schema admits them. */
export interface ForkToolArgs {
  variants: { name: string; command: string }[]
  collect?: string
  timeoutSeconds?: number
}

/**
 * Validate what the parameter schema cannot: name shape and uniqueness,
 * non-blank commands, variant count, and the timeout range.
 * @param args - schema-checked arguments.
 * @param limits - deployment bounds.
 * @returns the canonical request.
 * @throws with a model-readable reason when a constraint fails.
 */
export function parseForkRequest(args: ForkToolArgs, limits: ForkToolLimits): ForkRequest {
  if (args.variants.length === 0) throw new Error('fork_workspace requires at least one variant')
  if (args.variants.length > limits.maxVariants) {
    throw new Error(`fork_workspace accepts at most ${limits.maxVariants} variants per call; got ${args.variants.length}`)
  }
  const seen = new Set<string>()
  const variants = args.variants.map((variant) => {
    const name = variant.name.trim()
    const command = variant.command.trim()
    if (!VARIANT_NAME.test(name)) throw new Error(`invalid variant name ${JSON.stringify(variant.name)}: use lowercase letters, digits, and dashes`)
    if (seen.has(name)) throw new Error(`duplicate variant name ${JSON.stringify(name)}`)
    seen.add(name)
    if (command.length === 0) throw new Error(`variant ${JSON.stringify(name)}: \`command\` must be a non-empty string`)
    return { name, command }
  })
  const timeoutSeconds = args.timeoutSeconds ?? limits.defaultTimeoutSeconds
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > limits.maxTimeoutSeconds) {
    throw new Error(`timeoutSeconds must be an integer between 1 and ${limits.maxTimeoutSeconds}`)
  }
  const collect = args.collect?.trim()
  return {
    variants,
    timeoutSeconds,
    ...collect === undefined || collect.length === 0 ? {} : { collect },
  }
}

/**
 * Render one fork's outcome the way the model reads it: one line per variant.
 * @param value - the call's canonical value.
 * @returns the model-facing result text.
 */
export function formatForkResult(value: ForkToolValue): string {
  const lines = [`fork ${value.forkId}: ${value.variants.length} ${value.variants.length === 1 ? 'variant' : 'variants'}`]
  for (const variant of value.variants) {
    lines.push(`- ${variant.name}: exit ${variant.exitCode}, results in ${variant.resultDir}`)
    const out = variant.stdoutTail.trim()
    if (out.length > 0) lines.push(indent(out))
    const err = variant.stderrTail.trim()
    if (variant.exitCode !== 0 && err.length > 0) lines.push(indent(`stderr: ${err}`))
  }
  return lines.join('\n')
}

function indent(text: string): string {
  return text.split('\n').map(line => `    ${line}`).join('\n')
}

/**
 * The model-facing description for one deployment.
 * @param forksDir - workspace-relative directory the results land in.
 * @param maxVariants - the per-call variant cap.
 * @returns the composed tool description.
 */
export function describeForkTool(forksDir: string, maxVariants: number): string {
  return 'Fork the current workspace into isolated copies and run one shell command in each, in parallel. '
    + 'Every variant starts from an identical snapshot of the workspace as it is now, so use it to try '
    + 'competing hypotheses, parameter sweeps, or risky transformations without touching the real files. '
    + `Each variant's stdout, stderr, exit code, and (with \`collect\`) a chosen output directory land in ${forksDir}/<forkId>/<variant>/ `
    + `of the real workspace. Up to ${maxVariants} variants per call. Variants cannot see each other or the real workspace; `
    + 'anything not collected is discarded when the variant ends.'
}

/**
 * Register `fork_workspace` on the mounting context.
 * @param ctx - the plugin context whose tool registry the tool joins.
 * @param run - the engine callback.
 * @param limits - deployment bounds.
 * @param forksDir - workspace-relative results directory, named in the description.
 */
export function applyForkTool(ctx: Context, run: ForkRunner, limits: ForkToolLimits, forksDir: string): void {
  ctx.tools.register(defineTool({
    name: FORK_TOOL,
    description: describeForkTool(forksDir, limits.maxVariants),
    parameters: {
      variants: {
        type: 'array',
        required: true,
        description: 'The variants to run, each in its own forked copy of the workspace.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Short lowercase identifier; names the result directory.' },
            command: { type: 'string', required: true, description: 'Shell command to run in the variant, from the workspace root.' },
          },
        },
      },
      collect: {
        type: 'string',
        description: 'Workspace-relative directory whose contents are copied back from each variant. Omit to keep only stdout and stderr.',
      },
      timeoutSeconds: {
        type: 'integer',
        description: `Per-variant wall-clock budget in seconds. Default ${limits.defaultTimeoutSeconds}, max ${limits.maxTimeoutSeconds}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          forkId: { type: 'string', required: true },
          variants: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                exitCode: { type: 'integer', required: true },
                stdoutTail: { type: 'string', required: true },
                stderrTail: { type: 'string', required: true },
                resultDir: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatForkResult(value) }],
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Fork workspace × ${args.variants.length}`,
      locations: args.collect === undefined ? [] : [{ path: args.collect }],
    }),
    async execute(args, exec) {
      const request = parseForkRequest(args, limits)
      if (!exec.agent) {
        // The fork is logged on the calling agent's session; a non-agent caller has no log to write it to.
        throw new Error('fork_workspace requires an owning agent session')
      }
      const outcome = await run(request)
      exec.agent.session.append('sci/fork-completed', {
        forkId: outcome.forkId,
        snapshotID: outcome.snapshotID,
        variants: outcome.variants.map(variant => ({ name: variant.name, exitCode: variant.exitCode })),
        durationMs: outcome.durationMs,
      }, { ignorable: true })
      return { forkId: outcome.forkId, variants: [...outcome.variants] }
    },
  }))
}
