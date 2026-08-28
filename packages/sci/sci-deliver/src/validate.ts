/**
 * The four-step delivery validation chain, shared verbatim by the
 * `deliver_files` tool and the shell spool.
 *
 * It is a pure function over injected filesystem and session predicates so that
 * one implementation can decide both channels. That matters beyond tidiness:
 * `<spoolDir>/pending/` is the one model-writable path under `.sci/`, so a
 * spool entry is model-controlled input. Re-running this chain on the harness
 * side is the only thing that makes a spool delivery as trustworthy as a tool
 * call.
 * @module @deepseek-ai/dsh-sci-deliver/src/validate
 */

import { validateCanvas, validatePaper, validateSciplot } from '@deepseek-ai/dsh-sci-manifest'
import type { ManifestKind, ValidationResult } from '@deepseek-ai/dsh-sci-manifest'
import { isDeliverablePath } from './paths.ts'
import type { DeliveryPathConfig } from './paths.ts'
import type { DeliveryKind, DeliveryRequest } from './types.ts'

/** One manifest's text plus the asset predicate its own directory supports. */
export interface ManifestRead {
  /** Raw file content, still unparsed. */
  readonly text: string
  /**
   * Whether an asset a canvas node references exists beside the manifest.
   * @param relativePath - `src` exactly as the node wrote it.
   * @returns whether the renderer will find that file.
   */
  assetExists(relativePath: string): boolean
}

/** Everything the validation chain needs from outside itself. */
export interface DeliveryIo {
  /** The project layout the delivery-area rule is evaluated against. */
  readonly paths: DeliveryPathConfig
  /**
   * Whether anything exists at this path.
   * @param path - the resolved path being delivered.
   * @returns whether the path resolves to an existing entry.
   */
  exists(path: string): Promise<boolean>
  /**
   * Whether this path is a regular file rather than a directory or device.
   * @param path - the resolved path being delivered.
   * @returns whether the entry is a regular file.
   */
  isFile(path: string): Promise<boolean>
  /**
   * Read a manifest and the asset predicate its directory supports.
   * @param path - the resolved manifest path.
   * @returns the manifest's text and its asset resolver.
   */
  readManifest(path: string): Promise<ManifestRead>
  /**
   * Whether this session's log already records a delivery of this path.
   * @param path - the resolved manifest path.
   * @returns whether the manifest already opened a workbench in this session.
   */
  alreadyDelivered(path: string): boolean
}

/** The chain's outcome: the kind that will be logged, or the model-facing reason it was refused. */
export type DeliveryDecision =
  | { readonly ok: true; readonly kind: DeliveryKind }
  | { readonly ok: false; readonly reason: string }

/** Manifest validators keyed by kind, so the chain never branches on kind itself. */
const MANIFEST_VALIDATORS: Record<ManifestKind, (json: unknown, read: ManifestRead) => ValidationResult> = {
  paper: json => validatePaper(json),
  sciplot: json => validateSciplot(json),
  canvas: (json, read) => validateCanvas(json, { assetExists: relativePath => read.assetExists(relativePath) }),
}

/**
 * Refuse a delivery with a model-facing reason.
 * @param reason - the sentence the model reads in its tool result or prompt context.
 * @returns the refusing decision.
 */
function deny(reason: string): DeliveryDecision {
  return { ok: false, reason }
}

/**
 * Validate one manifest's content and its once-per-session budget.
 * @param path - the resolved manifest path.
 * @param kind - the manifest kind the path classified as.
 * @param io - the injected filesystem and session predicates.
 * @returns the accepting decision, or the reason the manifest was refused.
 */
async function validateManifest(path: string, kind: ManifestKind, io: DeliveryIo): Promise<DeliveryDecision> {
  const read = await io.readManifest(path)
  let json: unknown
  try {
    json = JSON.parse(read.text)
  } catch (error: unknown) {
    // JSON.parse throws SyntaxError and nothing else.
    return deny(`${path} is not valid JSON: ${(error as SyntaxError).message}`)
  }
  const result = MANIFEST_VALIDATORS[kind](json, read)
  if (!result.ok) return deny(`${path} is not a valid ${kind} manifest: ${result.errors.join('; ')}`)
  if (io.alreadyDelivered(path)) {
    return deny(`${path} was already delivered; later edits reach the open workbench live — describe the change in chat instead`)
  }
  return { ok: true, kind }
}

/**
 * Decide one delivery, in the order the delivery contract fixes: delivery area,
 * then existence, then manifest validity and the once-per-session budget.
 *
 * The order is load-bearing for the model-facing text. A path outside the
 * delivery area is refused before the filesystem is touched, so the reason
 * names the delivery directory rather than a missing file, and a model that
 * guessed the wrong path is told where to put the file instead of being told it
 * is absent.
 * @param request - the requested delivery, with its path already resolved to the sandbox.
 * @param io - the project layout plus the injected filesystem and session predicates.
 * @returns the kind that will be logged, or the reason the delivery was refused.
 */
export async function validateDelivery(request: DeliveryRequest, io: DeliveryIo): Promise<DeliveryDecision> {
  const { path } = request
  const kind = isDeliverablePath(path, io.paths)
  if (kind === undefined) {
    return deny(
      `${path} is outside the delivery area; only ${io.paths.deliveryDir}/ and a bundle's own `
      + `.paper / .sciplot manifest can be delivered — copy it into ${io.paths.deliveryDir}/ `
      + 'under a descriptive name and deliver the copy',
    )
  }
  if (!await io.exists(path)) return deny(`${path} does not exist`)
  if (!await io.isFile(path)) return deny(`${path} is not a regular file`)
  if (kind === 'file') return { ok: true, kind }
  return await validateManifest(path, kind, io)
}
