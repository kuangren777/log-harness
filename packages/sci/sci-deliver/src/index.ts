/**
 * Delivery for the science-research agent profile: the `deliver_files` tool,
 * the shell delivery spool, and the failure re-injection that makes a failed
 * shell delivery visible to the model.
 *
 * `apply` owns three contributions, all effects of the mounting fiber:
 *
 * - `deliver_files` on `ctx.tools`, the schema-checked channel.
 * - A turn-start drain of `<spoolDir>/pending/`, the channel that fits inside a
 *   shell loop. Both go through the same validation chain and the same commit
 *   point, so the `sci/delivered` event they append differs only in `via`.
 * - One `ctx.systemPrompt.context()` entry that materialises pending spool
 *   failures exactly once, so a rejected shell delivery reaches the model's
 *   next request instead of vanishing.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-deliver
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: merges the services this plugin injects onto Context, plus the
// `agent/pre-step` waterfall the spool drain observes.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { DELIVERY_FAILURES_CONTEXT, DELIVERY_FAILURES_ORDER, DeliveryFailureBuffer } from './failures.ts'
import { createDeliveryFileSystem } from './fs.ts'
import { createRecorder, randomDeliveryId } from './record.ts'
import { drainSpool } from './spool.ts'
import { applyDeliverTool } from './tool.ts'
import type { BundleDirs, DeliveryPathConfig } from './paths.ts'

export { DELIVERY_FAILURES_CONTEXT, DELIVERY_FAILURES_ORDER, DeliveryFailureBuffer, renderDeliveryFailures } from './failures.ts'
export type { DeliveryFailure } from './failures.ts'
export { createDeliveryFileSystem } from './fs.ts'
export type { DeliveryFileSystem } from './fs.ts'
export { baseName, directoryName, isDeliverablePath, normalizeSegments } from './paths.ts'
export type { BundleDirs, DeliveryPathConfig } from './paths.ts'
export { DeliveryId, createRecorder, randomDeliveryId } from './record.ts'
export type { DeliveryOutcome, DeliveryRecord, Recorder, RecorderOptions } from './record.ts'
export { BASE64_SNAPSHOT_SUFFIX, encodeSnapshot, snapshotDelivery } from './snapshot.ts'
export type { DeliverySnapshot, SnapshotFileSystem, SnapshotRequest } from './snapshot.ts'
export {
  SPOOL_DONE,
  SPOOL_ENTRY_EXTENSION,
  SPOOL_FAILED,
  SPOOL_PENDING,
  SPOOL_TOMBSTONE,
  drainSpool,
  parseSpoolEntry,
} from './spool.ts'
export type { SpoolEntry, SpoolFileSystem, SpoolRound } from './spool.ts'
export {
  DELIVER_TOOL,
  applyDeliverTool,
  describeDeliverTool,
  formatDeliveryResult,
  formatSize,
  parseDeliveryRequest,
} from './tool.ts'
export type { DeliveryToolValue } from './tool.ts'
export { validateDelivery } from './validate.ts'
export type { DeliveryDecision, DeliveryIo, ManifestRead } from './validate.ts'
export type {
  DeliveryId as DeliveryIdType,
  DeliveryKind,
  DeliveryRequest,
  DeliveryVia,
  SciDeliveredData,
  SciDeliveryFailedData,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'sci-deliver'

/**
 * The tool registry the delivery tool joins, the filesystem every path is
 * resolved and copied through, and the prompt layer that carries a failed shell
 * delivery back to the model.
 */
export const inject = ['tools', 'fs', 'systemPrompt']

/**
 * Step number of a turn's first model step. The agent loop resets its step
 * counter at every turn boundary and proposes `step + 1`, so this is the one
 * pre-step per turn at which the spool is drained.
 */
const FIRST_STEP_OF_TURN = 1

/** Default byte cap on a deliverable file: large enough for a rendered figure or a compiled PDF. */
const DEFAULT_MAX_DELIVERY_BYTES = 64 * 1024 * 1024

/** Default depth of the canvas asset walk: the manifest's directory and two levels of asset folders. */
const DEFAULT_CANVAS_ASSET_DEPTH = 3

/** Deployment-varying choices for the science-research delivery layer. */
export interface Config {
  /**
   * Absolute sandbox path holding one directory per project. Required: the home
   * layout differs per sandbox image, and a wrong guess would refuse every
   * delivery the agent attempts.
   */
  projectRoot: string
  /** Directory name of the delivery area inside one project — the only freely deliverable location. */
  deliveryDir: string
  /** Directory names of the two bundle trees inside one project. */
  bundleDirs: BundleDirs
  /**
   * Absolute sandbox path of the delivery spool, holding `pending/`, `done/`,
   * and `failed/`. Required: `pending/` is the one path under `.sci/` the
   * in-sandbox `sci` command and the model can write, and it must be the same
   * directory on both sides or shell deliveries are silently never read.
   */
  spoolDir: string
  /**
   * Absolute sandbox path holding one directory per delivery, into which the
   * delivered bytes are copied. Required for the same reason as `spoolDir`: a
   * wrong root writes snapshots where no card can find them.
   */
  snapshotDir: string
  /**
   * Whether the spool is drained at the start of every turn. The intended
   * deployment has no directory watcher, so this is how a shell delivery is
   * noticed; a deployment that adds one turns it off.
   */
  pollOnTurnStart: boolean
  /** How many directory levels below a canvas manifest are walked for the assets its nodes reference. */
  canvasAssetDepth: number
  /** Inclusive byte cap on a deliverable file; a larger file is refused rather than truncated. */
  maxDeliveryBytes: number
}

/** Schemastery schema for the science-research delivery layer. */
export const Config: z<Config> = z.object({
  projectRoot: z.string().required(),
  deliveryDir: z.string().default('workspace'),
  bundleDirs: z.object({
    papers: z.string().default('papers'),
    sciplots: z.string().default('sciplots'),
  }).default({ papers: 'papers', sciplots: 'sciplots' }),
  spoolDir: z.string().required(),
  snapshotDir: z.string().required(),
  pollOnTurnStart: z.boolean().default(true),
  canvasAssetDepth: z.number().step(1).min(1).default(DEFAULT_CANVAS_ASSET_DEPTH),
  maxDeliveryBytes: z.number().step(1).min(1).default(DEFAULT_MAX_DELIVERY_BYTES),
})

/**
 * Register the science-research delivery layer on the mounting context.
 * @param ctx - the mounting context, carrying `tools`, `fs`, and `systemPrompt`.
 * @param config - the resolved deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const paths: DeliveryPathConfig = {
    projectRoot: config.projectRoot,
    deliveryDir: config.deliveryDir,
    bundleDirs: config.bundleDirs,
  }
  const fs = createDeliveryFileSystem(ctx)
  const failures = new DeliveryFailureBuffer()
  const deliver = createRecorder({
    fs,
    paths,
    snapshotDir: config.snapshotDir,
    canvasAssetDepth: config.canvasAssetDepth,
    maxDeliveryBytes: config.maxDeliveryBytes,
    newDeliveryId: randomDeliveryId,
  })

  ctx.systemPrompt.context({
    name: DELIVERY_FAILURES_CONTEXT,
    order: DELIVERY_FAILURES_ORDER,
    text: () => failures.take(),
  })

  applyDeliverTool(ctx, deliver, config.deliveryDir)

  /**
   * Decide every entry the in-sandbox `sci` command left in the spool, against
   * the session that is about to make a request.
   * @param session - the calling agent's session, which receives both events.
   */
  const drain = (session: Session): Promise<void> => drainSpool({
    spoolDir: config.spoolDir,
    fs,
    deliver: async (request) => {
      const outcome = await deliver(session, request, 'spool')
      return outcome.ok ? undefined : outcome.reason
    },
    onFailure: (path, reason) => {
      session.append('sci/delivery-failed', { via: 'spool', path, reason }, { ignorable: true })
      failures.record({ path, reason })
    },
  })

  if (!config.pollOnTurnStart) return
  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step === FIRST_STEP_OF_TURN) await drain(payload.agent.session)
    return await next()
  })
}
