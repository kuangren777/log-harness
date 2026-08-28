/**
 * Ownership diff between two revisions of one manifest.
 *
 * Each bundle kind has fields the agent must never write: the LaTeX workbench
 * appends `versions`, the sciplot render script maintains `history` and
 * `output`, the user owns sciplot `annotations`, and the user's own drags own
 * the `position` and `size` of every canvas node that already exists. A write
 * or edit that changes any of them is a denial, not a merge — the agent cannot
 * see the co-editing side that produced the current value.
 * @module @deepseek-ai/dsh-sci-manifest/owned-fields
 */

import { isJsonObject } from './fields.ts'
import type { JsonObject } from './fields.ts'
import type { ManifestKind } from './kinds.ts'

/** Platform-owned top-level fields of a `.paper` manifest. */
const PAPER_OWNED = ['versions'] as const
/** Render-script-owned and user-owned top-level fields of a `.sciplot` manifest. */
const SCIPLOT_OWNED = ['history', 'output', 'annotations'] as const
/** User-owned geometry of a canvas node that already exists. */
const CANVAS_NODE_OWNED = ['position', 'size'] as const

/**
 * Compare two parsed JSON values by structure, ignoring object key order.
 * @param left - value from the manifest before the edit.
 * @param right - value from the manifest after the edit.
 * @returns whether the two values are the same JSON document.
 */
function jsonEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) {
    return Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (isJsonObject(left)) {
    if (!isJsonObject(right)) return false
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    return keys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
  }
  return left === right
}

/**
 * Read a member of a value that may not be a manifest at all.
 * @param manifest - the parsed manifest revision.
 * @param key - member name.
 * @returns the member, or `undefined` when the revision is not an object.
 */
function readMember(manifest: unknown, key: string): unknown {
  return isJsonObject(manifest) ? manifest[key] : undefined
}

/**
 * Diff a fixed list of top-level owned fields.
 * @param owned - field names this kind forbids the agent from writing.
 * @param before - manifest revision on disk.
 * @param after - manifest revision the edit would produce.
 * @returns the changed field names, in the order they are declared.
 */
function diffTopLevel(owned: readonly string[], before: unknown, after: unknown): string[] {
  return owned.filter(field => !jsonEqual(readMember(before, field), readMember(after, field)))
}

/**
 * Read the node objects of a canvas revision.
 * @param manifest - the parsed canvas revision.
 * @returns every node that is a JSON object, or `[]` when the list is unusable.
 */
function readNodes(manifest: unknown): JsonObject[] {
  const nodes = readMember(manifest, 'nodes')
  if (!Array.isArray(nodes)) return []
  return nodes.filter(isJsonObject)
}

/**
 * Diff the geometry of canvas nodes present in both revisions. Nodes the edit
 * added or removed are not reported: the skill permits both. Every ambiguity
 * resolves toward reporting a change, because the consumer treats a non-empty
 * result as a denial and an empty one as permission: a `before` node whose id
 * is missing, non-string, or shared with another node cannot be matched, so
 * its geometry counts as changed; an `after` revision whose node list is
 * unreadable counts as changing every `before` node's geometry; and an id
 * duplicated on the `after` side counts as changed even when the first copy
 * matches, since a last-wins renderer would show the other copy.
 * @param before - canvas revision on disk.
 * @param after - canvas revision the edit would produce.
 * @returns `nodes[<id>].position` / `nodes[<id>].size` for each changed or
 *   unmatchable value, using the node's index as `<id>` when it has no usable id.
 */
function diffCanvasGeometry(before: unknown, after: unknown): string[] {
  const changed: string[] = []
  const beforeNodes = readNodes(before)
  const afterList = readMember(after, 'nodes')
  const afterNodes = Array.isArray(afterList) ? afterList.filter(isJsonObject) : undefined
  const beforeIdCounts = countIds(beforeNodes)
  const afterIdCounts = afterNodes === undefined ? new Map<string, number>() : countIds(afterNodes)
  beforeNodes.forEach((node, index) => {
    const id = node['id']
    const label = typeof id === 'string' ? id : String(index)
    const unmatchable = typeof id !== 'string' || (beforeIdCounts.get(id) ?? 0) > 1 || (afterIdCounts.get(id) ?? 0) > 1 || afterNodes === undefined
    const counterpart = unmatchable || typeof id !== 'string' ? undefined : afterNodes.find(candidate => candidate['id'] === id)
    for (const field of CANVAS_NODE_OWNED) {
      const differs = counterpart !== undefined && !jsonEqual(node[field], counterpart[field])
      if (unmatchable || differs) changed.push(`nodes[${label}].${field}`)
    }
  })
  return changed
}

/**
 * Count how many nodes claim each string id.
 * @param nodes - node objects of one revision.
 * @returns id → occurrence count; nodes without a string id are not counted.
 */
function countIds(nodes: readonly JsonObject[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const id = node['id']
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/** The owned-field differ of each bundle kind. */
const OWNED_FIELD_DIFFERS: Record<ManifestKind, (before: unknown, after: unknown) => string[]> = {
  paper: (before, after) => diffTopLevel(PAPER_OWNED, before, after),
  sciplot: (before, after) => diffTopLevel(SCIPLOT_OWNED, before, after),
  canvas: diffCanvasGeometry,
}

/**
 * List the platform-owned and user-owned fields an edit would change.
 * Neither revision needs to be a valid manifest: an unreadable side reads as
 * absent, so replacing a manifest with garbage still reports its owned fields.
 * @param kind - the bundle kind whose ownership rules apply.
 * @param before - manifest revision currently on disk.
 * @param after - manifest revision the write or edit would produce.
 * @returns the changed owned-field names; empty means the edit touches only fields the agent owns.
 */
export function diffOwnedFields(kind: ManifestKind, before: unknown, after: unknown): string[] {
  return OWNED_FIELD_DIFFERS[kind](before, after)
}
