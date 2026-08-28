/**
 * Validator for `.canvas` node boards, from the JSON block of the
 * `clawsgo-canvas` skill.
 *
 * Two checks are stricter than the renderer on purpose. The renderer silently
 * drops an edge that points at a missing node id; here it is an error naming
 * the edge, because a silently dropped relationship reaches the user as a board
 * that is quietly wrong. Asset references are resolved through the injected
 * {@link CanvasAssetResolver} instead of being trusted, because the renderer can
 * only display files that live beside the manifest.
 * @module @deepseek-ai/dsh-sci-manifest/canvas
 */

import {
  optionalString,
  requireArray,
  requireFiniteNumber,
  requireObject,
  requirePositiveNumber,
  requireString,
  requireVersion,
  requireContainedPath,
} from './fields.ts'
import type { JsonObject } from './fields.ts'
import { toResult } from './kinds.ts'
import type { ValidationResult } from './kinds.ts'

const CANVAS = 'canvas manifest'

/** The card types the board renders. */
const NODE_TYPES = ['image', 'video', 'text'] as const

type CanvasNodeType = (typeof NODE_TYPES)[number]

/** Resolves the assets an image or video node references. */
export interface CanvasAssetResolver {
  /**
   * Report whether a referenced asset exists beside the `.canvas` file.
   * @param relativePath - `src` exactly as written in the node data, relative to the manifest directory.
   * @returns whether the renderer will find that file.
   */
  assetExists(relativePath: string): boolean
}

/**
 * Narrow a node `type` member to a renderable card type.
 * @param value - the parsed `type` member.
 * @returns whether the board can render it.
 */
function isCanvasNodeType(value: unknown): value is CanvasNodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value)
}

/**
 * Record a collection id and report the second use of a duplicate.
 * @param id - the id read from the entry, or `undefined` when it was unusable.
 * @param seen - ids already accepted in this collection.
 * @param path - entry path quoted in the failure message.
 * @param label - collection noun used in the failure message.
 * @param errors - accumulator appended on failure.
 */
function trackId(id: string | undefined, seen: Set<string>, path: string, label: string, errors: string[]): void {
  if (id === undefined) return
  if (seen.has(id)) {
    errors.push(`${path}.id duplicates an earlier ${label} id ${JSON.stringify(id)}`)
    return
  }
  seen.add(id)
}

/**
 * Validate the world coordinates every node carries.
 * @param node - the node object.
 * @param path - node path quoted in failure messages.
 * @param errors - accumulator appended on failure.
 */
function validatePosition(node: JsonObject, path: string, errors: string[]): void {
  const position = requireObject(node['position'], `${path}.position`, errors)
  if (position === undefined) return
  requireFiniteNumber(position, 'x', `${path}.position.x`, errors)
  requireFiniteNumber(position, 'y', `${path}.position.y`, errors)
}

/**
 * Validate the optional rendered size, which defaults to 200x200 when absent.
 * @param node - the node object.
 * @param path - node path quoted in failure messages.
 * @param errors - accumulator appended on failure.
 */
function validateSize(node: JsonObject, path: string, errors: string[]): void {
  const raw = node['size']
  if (raw === undefined) return
  const size = requireObject(raw, `${path}.size`, errors)
  if (size === undefined) return
  requirePositiveNumber(size, 'width', `${path}.size.width`, errors)
  requirePositiveNumber(size, 'height', `${path}.size.height`, errors)
}

/**
 * Validate the card type and the `data` members that type renders.
 * @param node - the node object.
 * @param path - node path quoted in failure messages.
 * @param assets - resolver consulted for image and video sources.
 * @param errors - accumulator appended on failure.
 */
function validateNodeData(node: JsonObject, path: string, assets: CanvasAssetResolver, errors: string[]): void {
  const type = node['type']
  if (!isCanvasNodeType(type)) {
    errors.push(`${path}.type must be one of ${NODE_TYPES.join(', ')} (got ${JSON.stringify(type)})`)
    return
  }
  const data = requireObject(node['data'], `${path}.data`, errors)
  if (data === undefined) return
  optionalString(data, 'title', `${path}.data.title`, errors)
  if (type === 'text') {
    requireString(data, 'markdown', `${path}.data.markdown`, errors)
    return
  }
  const source = requireString(data, 'src', `${path}.data.src`, errors)
  if (source === undefined) return
  if (!requireContainedPath(source, `${path}.data.src`, errors)) return
  if (assets.assetExists(source)) return
  errors.push(`${path}.data.src references a missing asset ${JSON.stringify(source)}`)
}

/**
 * Validate every node and collect the ids edges may point at.
 * @param manifest - the manifest root.
 * @param assets - resolver consulted for image and video sources.
 * @param errors - accumulator appended on failure.
 * @returns the node ids accepted so far, empty when the list itself was unusable.
 */
function validateNodes(manifest: JsonObject, assets: CanvasAssetResolver, errors: string[]): Set<string> {
  const ids = new Set<string>()
  const nodes = requireArray(manifest, 'nodes', `${CANVAS}.nodes`, errors)
  if (nodes === undefined) return ids
  nodes.forEach((entry, index) => {
    const path = `${CANVAS}.nodes[${index}]`
    const node = requireObject(entry, path, errors)
    if (node === undefined) return
    trackId(requireString(node, 'id', `${path}.id`, errors), ids, path, 'node', errors)
    validatePosition(node, path, errors)
    validateSize(node, path, errors)
    validateNodeData(node, path, assets, errors)
  })
  return ids
}

/**
 * Require one edge endpoint to name a node on this board.
 * @param edge - the edge object.
 * @param key - `source` or `target`.
 * @param label - edge path, with its id appended when it has one.
 * @param path - edge path quoted in the member failure message.
 * @param nodeIds - ids accepted by {@link validateNodes}.
 * @param errors - accumulator appended on failure.
 */
function validateEndpoint(
  edge: JsonObject,
  key: 'source' | 'target',
  label: string,
  path: string,
  nodeIds: ReadonlySet<string>,
  errors: string[],
): void {
  const endpoint = requireString(edge, key, `${path}.${key}`, errors)
  if (endpoint === undefined) return
  if (nodeIds.has(endpoint)) return
  errors.push(`${label} has ${key} ${JSON.stringify(endpoint)}, which is not a node id in this canvas`)
}

/**
 * Validate every edge against the accepted node ids.
 * @param manifest - the manifest root.
 * @param nodeIds - ids accepted by {@link validateNodes}.
 * @param errors - accumulator appended on failure.
 */
function validateEdges(manifest: JsonObject, nodeIds: ReadonlySet<string>, errors: string[]): void {
  const edges = requireArray(manifest, 'edges', `${CANVAS}.edges`, errors)
  if (edges === undefined) return
  const ids = new Set<string>()
  edges.forEach((entry, index) => {
    const path = `${CANVAS}.edges[${index}]`
    const edge = requireObject(entry, path, errors)
    if (edge === undefined) return
    const id = requireString(edge, 'id', `${path}.id`, errors)
    trackId(id, ids, path, 'edge', errors)
    optionalString(edge, 'label', `${path}.label`, errors)
    const label = id === undefined ? path : `${path} ${JSON.stringify(id)}`
    validateEndpoint(edge, 'source', label, path, nodeIds, errors)
    validateEndpoint(edge, 'target', label, path, nodeIds, errors)
  })
}

/**
 * Validate a `.canvas` board file.
 * @param json - the parsed board, or any value read from the `.canvas` path.
 * @param opts - resolves the assets image and video nodes reference.
 * @returns success, or every offending field path, node id, and edge id.
 */
export function validateCanvas(json: unknown, opts: CanvasAssetResolver): ValidationResult {
  const errors: string[] = []
  const manifest = requireObject(json, CANVAS, errors)
  if (manifest !== undefined) {
    requireVersion(manifest, CANVAS, errors)
    validateEdges(manifest, validateNodes(manifest, opts, errors), errors)
  }
  return toResult('canvas', errors)
}
