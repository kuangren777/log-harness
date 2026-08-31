/**
 * The five variant tools: `create_variant`, `run_in_variant`,
 * `collect_variant`, `delete_variant`, `list_variants`. Every denial happens
 * here or in the engine, in the executor, and names the rule broken.
 * @module @deepseek-ai/dsh-camel-runtime/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { VARIANT_NAME } from './registry.ts'
import type { VariantEngine } from './variants.ts'
import type { VariantCollectResult, VariantListing, VariantRecord, VariantRunResult } from './types.ts'

/** Name of the tool that creates a slot. */
export const CREATE_TOOL = 'create_variant'
/** Name of the tool that runs a command in a slot. */
export const RUN_TOOL = 'run_in_variant'
/** Name of the tool that copies a slot's directory back into the workspace. */
export const COLLECT_TOOL = 'collect_variant'
/** Name of the tool that deletes a slot. */
export const DELETE_TOOL = 'delete_variant'
/** Name of the tool that lists the slots. */
export const LIST_TOOL = 'list_variants'

/** Bounds the tools enforce beyond the parameter schema. */
export interface VariantToolLimits {
  readonly maxVariants: number
  readonly defaultTimeoutSeconds: number
  readonly maxTimeoutSeconds: number
}

/**
 * Validate a slot name the schema admits as any string.
 * @param name - raw name.
 * @returns the trimmed name.
 * @throws with a model-readable reason.
 */
export function parseVariantName(name: string): string {
  const trimmed = name.trim()
  if (!VARIANT_NAME.test(trimmed)) throw new Error(`invalid variant name ${JSON.stringify(name)}: use lowercase letters, digits, and dashes`)
  return trimmed
}

/**
 * Validate a command budget.
 * @param timeoutSeconds - raw value, absent for the default.
 * @param limits - deployment bounds.
 * @returns the budget in seconds.
 * @throws when outside `[1, maxTimeoutSeconds]` or not an integer.
 */
export function parseTimeout(timeoutSeconds: number | undefined, limits: VariantToolLimits): number {
  const value = timeoutSeconds ?? limits.defaultTimeoutSeconds
  if (!Number.isInteger(value) || value <= 0 || value > limits.maxTimeoutSeconds) {
    throw new Error(`timeoutSeconds must be an integer between 1 and ${limits.maxTimeoutSeconds}`)
  }
  return value
}

/**
 * Validate a non-blank text field.
 * @param value - raw text.
 * @param field - field name for the error.
 * @returns the trimmed text.
 */
export function parseText(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`\`${field}\` must be a non-empty string`)
  return trimmed
}

/** Render the slot count the way every mutation reports it. */
function slots(used: number, max: number): string {
  return `${used}/${max} slots used`
}

/**
 * Render a creation.
 * @param record - the new slot.
 * @param used - slots in use after creation.
 * @param max - slot cap.
 * @returns the model-facing text.
 */
export function formatCreated(record: VariantRecord, used: number, max: number): string {
  const origin = record.from === undefined ? `copied from ${record.project}` : `forked from variant ${record.from} (${record.project})`
  return `variant ${record.name} created, ${origin}; ${slots(used, max)}`
}

/**
 * Render a run: exit code, then the stdout tail, then stderr on a failure.
 * @param result - the run outcome.
 * @returns the model-facing text.
 */
export function formatRun(result: VariantRunResult): string {
  const lines = [`variant ${result.name}: exit ${result.exitCode} (${result.durationMs} ms)`]
  const out = result.stdoutTail.trim()
  if (out.length > 0) lines.push(out)
  const err = result.stderrTail.trim()
  if (result.exitCode !== 0 && err.length > 0) lines.push(`stderr: ${err}`)
  return lines.join('\n')
}

/**
 * Render a collection.
 * @param result - the collection outcome.
 * @returns the model-facing text.
 */
export function formatCollected(result: VariantCollectResult): string {
  return `collected ${result.files} ${result.files === 1 ? 'file' : 'files'} from variant ${result.name}:${result.path} into ${result.destination}`
}

/**
 * Render a listing, one slot per line.
 * @param rows - slots with state.
 * @param max - slot cap.
 * @returns the model-facing text.
 */
export function formatListing(rows: readonly VariantListing[], max: number): string {
  if (rows.length === 0) return `no variants; ${slots(0, max)}`
  const lines = rows.map(row => `- ${row.name}: ${row.project}, ${row.state}${row.from === undefined ? '' : `, forked from ${row.from}`}, last used ${row.lastUsedAt}`)
  return [slots(rows.length, max), ...lines].join('\n')
}

/**
 * Register the five tools on the mounting context.
 * @param ctx - the plugin context whose tool registry the tools join.
 * @param engine - the variant engine.
 * @param limits - deployment bounds.
 * @param variantsDir - workspace-relative results directory, named in descriptions.
 */
export function applyVariantTools(ctx: Context, engine: VariantEngine, limits: VariantToolLimits, variantsDir: string): void {
  const requireAgent = <A>(exec: { agent?: A }, tool: string): A => {
    if (!exec.agent) throw new Error(`${tool} requires an owning agent session`)
    return exec.agent
  }
  const max = limits.maxVariants

  ctx.tools.register(defineTool({
    name: CREATE_TOOL,
    description: 'Create a persistent variant: an isolated microVM holding a copy of one project directory, '
      + 'for trying a hypothesis, a parameter set, or a risky change without touching the real files. '
      + `Up to ${max} variants per workspace; when full, delete one with delete_variant first. `
      + 'Pass `from` to fork an existing variant instead — the copy then starts from that variant\'s current files, processes, and memory. '
      + 'Variants pause when idle and resume on use. Nothing a variant writes reaches the workspace until collect_variant copies it back.',
    parameters: {
      name: { type: 'string', required: true, description: 'Short lowercase identifier; names the slot and its results directory.' },
      project: { type: 'string', required: true, description: 'Workspace-relative project directory to copy, e.g. projects/my-study.' },
      from: { type: 'string', description: 'Existing variant to fork from. The project is inherited.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          project: { type: 'string', required: true },
          sandboxID: { type: 'string', required: true },
          from: { type: 'string' },
          slotsUsed: { type: 'integer', required: true },
          slotsMax: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCreated(value as unknown as VariantRecord, value.slotsUsed, value.slotsMax) }],
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: `Create variant ${args.name}`, locations: [{ path: args.project }] }),
    async execute(args, exec) {
      const agent = requireAgent(exec, CREATE_TOOL)
      const name = parseVariantName(args.name)
      const project = parseText(args.project, 'project')
      const from = args.from === undefined ? undefined : parseVariantName(args.from)
      const record = await engine.create(name, project, from)
      const used = (await engine.registry.load()).length
      agent.session.append('sci/variant-created', {
        name: record.name,
        project: record.project,
        sandboxID: record.sandboxID,
        ...record.from === undefined ? {} : { from: record.from },
      }, { ignorable: true })
      return {
        name: record.name,
        project: record.project,
        sandboxID: record.sandboxID,
        ...record.from === undefined ? {} : { from: record.from },
        slotsUsed: used,
        slotsMax: max,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: RUN_TOOL,
    description: 'Run one shell command inside a variant, from its project directory. The variant is resumed if it was paused. '
      + 'A non-zero exit is reported, not thrown. Output beyond the last 4000 characters is dropped from the result.',
    parameters: {
      name: { type: 'string', required: true, description: 'The variant to run in.' },
      command: { type: 'string', required: true, description: 'Shell command, run from the variant\'s project directory.' },
      timeoutSeconds: { type: 'integer', description: `Wall-clock budget in seconds. Default ${limits.defaultTimeoutSeconds}, max ${limits.maxTimeoutSeconds}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          exitCode: { type: 'integer', required: true },
          stdoutTail: { type: 'string', required: true },
          stderrTail: { type: 'string', required: true },
          durationMs: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatRun(value) }],
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: `Run in variant ${args.name}`, locations: [] }),
    async execute(args, exec) {
      const agent = requireAgent(exec, RUN_TOOL)
      const name = parseVariantName(args.name)
      const command = parseText(args.command, 'command')
      const timeoutSeconds = parseTimeout(args.timeoutSeconds, limits)
      const result = await engine.run(name, command, timeoutSeconds)
      agent.session.append('sci/variant-run', { name, exitCode: result.exitCode, durationMs: result.durationMs }, { ignorable: true })
      return { ...result }
    },
  }))

  ctx.tools.register(defineTool({
    name: COLLECT_TOOL,
    description: `Copy a directory of a variant's project back into the workspace, under ${variantsDir}/<name>/collect/. `
      + 'The real project files are never overwritten; read the collected copy and merge what you want by hand.',
    parameters: {
      name: { type: 'string', required: true, description: 'The variant to collect from.' },
      path: { type: 'string', description: 'Project-relative directory to collect. Omit for the whole project.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          path: { type: 'string', required: true },
          destination: { type: 'string', required: true },
          files: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatCollected(value) }],
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: `Collect from variant ${args.name}`, locations: args.path === undefined ? [] : [{ path: args.path }] }),
    async execute(args, exec) {
      requireAgent(exec, COLLECT_TOOL)
      const name = parseVariantName(args.name)
      const path = args.path === undefined || args.path.trim().length === 0 ? '.' : args.path.trim()
      return { ...await engine.collect(name, path) }
    },
  }))

  ctx.tools.register(defineTool({
    name: DELETE_TOOL,
    description: 'Delete a variant: its microVM is destroyed and its slot freed. Files already collected stay in the workspace.',
    parameters: {
      name: { type: 'string', required: true, description: 'The variant to delete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          slotsUsed: { type: 'integer', required: true },
          slotsMax: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `variant ${value.name} deleted; ${slots(value.slotsUsed, value.slotsMax)}` }],
    },
    presentCall: (args): GenericCallView => ({ card: 'generic', title: `Delete variant ${args.name}`, locations: [] }),
    async execute(args, exec) {
      const agent = requireAgent(exec, DELETE_TOOL)
      const name = parseVariantName(args.name)
      const record = await engine.delete(name)
      const used = (await engine.registry.load()).length
      agent.session.append('sci/variant-deleted', { name: record.name, sandboxID: record.sandboxID }, { ignorable: true })
      return { name: record.name, slotsUsed: used, slotsMax: max }
    },
  }))

  ctx.tools.register(defineTool({
    name: LIST_TOOL,
    description: 'List the variants of this workspace with their project, state (running, paused, or missing), and last use.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slotsMax: { type: 'integer', required: true },
          variants: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                project: { type: 'string', required: true },
                state: { type: 'string', required: true, enum: ['running', 'paused', 'missing'] },
                from: { type: 'string' },
                createdAt: { type: 'string', required: true },
                lastUsedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatListing(value.variants as unknown as VariantListing[], value.slotsMax) }],
    },
    presentCall: (): GenericCallView => ({ card: 'generic', title: 'List variants', locations: [] }),
    async execute() {
      const rows = await engine.list()
      return {
        slotsMax: max,
        variants: rows.map(row => ({
          name: row.name,
          project: row.project,
          state: row.state,
          ...row.from === undefined ? {} : { from: row.from },
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
        })),
      }
    },
  }))
}
