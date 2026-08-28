/**
 * Auto-locate: which file the mode shows when the user has pinned none.
 *
 * The source is the settled tool calls in the session's own conversation
 * snapshot, read as a pure derivation at render — nothing is pushed, nothing
 * is remembered, and a reloaded session lands on the same file the live one
 * did. The vocabulary is the three tools that produce a file the user is
 * meant to look at: `deliver_files` hands one over, `univer_export` writes a
 * user-facing format, and `univer_new` opens a document to work in.
 */

import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** The argument each locating tool names its produced file in. */
type ArgumentReader = (args: Record<string, unknown>) => string | undefined

/**
 * Tool name → the produced path in its call arguments. Arguments rather than
 * results because the wire carries the model-facing result as rendered text
 * only; the call's own JSON is the structured record the browser can read.
 */
const LOCATING_TOOLS: Readonly<Record<string, ArgumentReader>> = {
  // The last entry of a multi-file delivery: the user's eye lands on the
  // newest thing named, the same order the delivery card lists them in.
  deliver_files: (args) => {
    const files = args['files']
    if (!Array.isArray(files)) return undefined
    for (let index = files.length - 1; index >= 0; index -= 1) {
      const path = readPath(files[index], 'path')
      if (path !== undefined) return path
    }
    return undefined
  },
  univer_export: args => readPath(args, 'output'),
  univer_new: args => readPath(args, 'file'),
}

/** A non-blank string field of a candidate object, or undefined. */
function readPath(candidate: unknown, field: string): string | undefined {
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const value = (candidate as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * The file one settled call produced.
 * @param name - the tool's name.
 * @param argsRaw - the call's arguments exactly as the model produced them.
 * @returns the produced path, or undefined when this call locates nothing.
 */
export function locatedPath(name: string, argsRaw: string): string | undefined {
  const read = LOCATING_TOOLS[name]
  if (read === undefined) return undefined
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    // A streaming-truncated or malformed argument string locates nothing;
    // the model's own retry produces the next candidate.
    return undefined
  }
  return typeof args === 'object' && args !== null ? read(args as Record<string, unknown>) : undefined
}

/** The file one conversation node produced: only a settled successful call has one. */
function locatedInNode(node: ConversationNode): string | undefined {
  if (node.kind !== 'tool-result' || node.isError || node.call === null) return undefined
  return locatedPath(node.call.name, node.call.argsRaw)
}

/**
 * The newest produced file in one conversation window.
 * @param nodes - the snapshot's ordered conversation nodes.
 * @returns the last locating call's produced path, or undefined when the
 * window holds none.
 */
export function latestLocatedPath(nodes: readonly ConversationNode[]): string | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const path = locatedInNode(nodes[index] as ConversationNode)
    if (path !== undefined) return path
  }
  return undefined
}
