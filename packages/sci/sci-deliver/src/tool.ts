/**
 * The `deliver_files` tool — the model-facing replacement for the studied
 * platform's `mcp__clawsgo__deliver_files`.
 *
 * Three things changed. The field is `path` rather than `sandboxPath`, because
 * the model is naming a file, not a sandbox. `description` is optional, because
 * a figure whose title says everything needed a placeholder sentence before.
 * And a refused file comes back as a named rejection with the reason and the
 * remedy instead of an opaque failure, so a call that delivers three of four
 * files still delivers three.
 * @module @deepseek-ai/dsh-sci-deliver/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { BUNDLE_KINDS } from '@deepseek-ai/dsh-sci-manifest'
import { baseName } from './paths.ts'
import type { Recorder } from './record.ts'
import type { DeliveryKind, DeliveryRequest } from './types.ts'

/** Name of the model-facing delivery tool. */
export const DELIVER_TOOL = 'deliver_files'

/** Bytes per binary kilobyte and megabyte, for the size a card and the model both read. */
const KIB = 1024
const MIB = KIB * KIB

/** The canonical value one `deliver_files` call returns. */
export interface DeliveryToolValue {
  /** One entry per file that reached the user, in call order. */
  readonly delivered: readonly {
    readonly deliveryId: string
    readonly path: string
    readonly title: string
    readonly kind: DeliveryKind
    readonly size: number
    readonly sha256: string
  }[]
  /** One entry per file that did not, in call order. */
  readonly rejected: readonly { readonly path: string; readonly reason: string }[]
}

/**
 * Format a byte count the way a person reads a file size.
 * @param bytes - the file's byte length.
 * @returns a short human-readable size.
 */
export function formatSize(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`
  if (bytes < MIB) return `${Math.round(bytes / KIB)} KB`
  return `${(bytes / MIB).toFixed(1)} MB`
}

/**
 * Pluralize the noun both result lines share.
 * @param count - how many files the line reports.
 * @returns `file` or `files`.
 */
function files(count: number): string {
  return count === 1 ? 'file' : 'files'
}

/**
 * Render one call's outcome as the model reads it: what reached the user, and
 * what did not and why.
 * @param value - the call's canonical value.
 * @returns the model-facing result text.
 */
export function formatDeliveryResult(value: DeliveryToolValue): string {
  const lines: string[] = []
  if (value.delivered.length > 0) {
    const listed = value.delivered
      .map(entry => `${baseName(entry.path)} (${formatSize(entry.size)})`)
      .join(', ')
    lines.push(`delivered ${value.delivered.length} ${files(value.delivered.length)}: ${listed}`)
  }
  for (const entry of value.rejected) lines.push(`rejected ${entry.path}: ${entry.reason}`)
  return lines.join('\n')
}

/**
 * Validate the value constraints the parameter schema cannot express: a
 * non-blank path and title, and a `description` that is either absent or says
 * something.
 * @param file - one schema-checked entry of the `files` array.
 * @returns the canonical request.
 * @throws when a required text field is blank.
 */
export function parseDeliveryRequest(file: { path: string; title: string; description?: string }): DeliveryRequest {
  const path = file.path.trim()
  const title = file.title.trim()
  if (path.length === 0) throw new Error('invalid file: `path` must be a non-empty string')
  if (title.length === 0) throw new Error('invalid file: `title` must be a non-empty string')
  const description = file.description?.trim()
  return { path, title, ...description === undefined || description.length === 0 ? {} : { description } }
}

/**
 * The model-facing description for one deployment. The delivery directory's
 * name is the only part that varies, and it is the part the model must get
 * right, so it is interpolated rather than described generically.
 * @param deliveryDir - the configured delivery directory name.
 * @returns the composed tool description.
 */
export function describeDeliverTool(deliveryDir: string): string {
  return 'Deliver finished files to the user, who sees one card per file. '
    + `Deliverable paths are anything inside a project's ${deliveryDir}/ directory, `
    + "plus a paper or figure bundle's own .paper / .sciplot manifest. "
    + `Anything else — a build product, a scratch file, a downloaded PDF — must be copied into ${deliveryDir}/ `
    + 'under a descriptive name and delivered from there. '
    + 'Deliver a bundle manifest once: later edits reach the workbench the user already has open, '
    + 'so describe further changes in chat instead of delivering the manifest again.'
}

/**
 * Register `deliver_files` on the mounting context.
 * @param ctx - the plugin context whose tool registry the tool joins.
 * @param deliver - the delivery commit point shared with the spool.
 * @param deliveryDir - the configured delivery directory name, named in the description.
 */
export function applyDeliverTool(ctx: Context, deliver: Recorder, deliveryDir: string): void {
  ctx.tools.register(defineTool({
    name: DELIVER_TOOL,
    description: describeDeliverTool(deliveryDir),
    parameters: {
      files: {
        type: 'array',
        required: true,
        description: 'The files to deliver, in the order the user should see them.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Path of the file to deliver.' },
            title: { type: 'string', required: true, description: 'Short card title naming what this file is.' },
            description: { type: 'string', description: 'One sentence on what the file contains. Omit when the title says it.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delivered: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                deliveryId: { type: 'string', required: true },
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['file', ...BUNDLE_KINDS] },
                size: { type: 'integer', required: true },
                sha256: { type: 'string', required: true },
              },
            },
          },
          rejected: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                reason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDeliveryResult(value) }],
    },
    presentCall: (args): GenericCallView => ({
      card: 'generic',
      title: `Deliver ${args.files.length} ${files(args.files.length)}`,
      locations: args.files.map(file => ({ path: file.path })),
    }),
    async execute(args, exec) {
      if (args.files.length === 0) throw new Error('deliver_files requires at least one file')
      if (!exec.agent) {
        // A delivery is logged on the calling agent's session; a non-agent
        // caller has no log to write it to and no user to show a card.
        throw new Error('deliver_files requires an owning agent session')
      }
      const { session } = exec.agent
      const value: { delivered: DeliveryToolValue['delivered'][number][]; rejected: { path: string; reason: string }[] } = {
        delivered: [],
        rejected: [],
      }
      for (const file of args.files) {
        const request = parseDeliveryRequest(file)
        const outcome = await deliver(session, request, 'tool')
        if (outcome.ok) value.delivered.push({ ...outcome.record })
        else value.rejected.push({ path: request.path, reason: outcome.reason })
      }
      return value
    },
  }))
}
