/**
 * Reading one tool call through its binding: which operation it performs, which
 * path it acts on, and what content it would leave on disk.
 *
 * Tool arguments arrive as parsed JSON the registry has not yet matched against
 * the tool's own schema, so every read is defensive by necessity — this is a
 * model/tool JSON boundary, not a typed same-process one.
 * @module @deepseek-ai/dsh-sci-workspace/bindings
 */

import { applyReplacement } from './manifest-gate.ts'
import type { Config } from './config.ts'
import type { FsOp, FsToolBinding, ShellToolBinding } from './types.ts'

/** One mounted filesystem tool with the operation class it was declared in. */
export interface FsToolEntry {
  /** Operation applied when the binding declares no per-command mapping. */
  readonly defaultOp: FsOp
  /** Where this tool keeps the arguments the gate reads. */
  readonly binding: FsToolBinding
}

/**
 * Read one string argument of a tool call.
 * @param args - the call's parsed arguments.
 * @param field - the argument name, or `undefined` when the binding has none.
 * @returns the string value, or `undefined` when it is absent or not a string.
 */
export function readStringArg(args: unknown, field: string | undefined): string | undefined {
  if (field === undefined || typeof args !== 'object' || args === null) return undefined
  const value = (args as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read one boolean argument of a tool call.
 * @param args - the call's parsed arguments.
 * @param field - the argument name, or `undefined` when the binding has none.
 * @returns the boolean value, defaulting to `false`.
 */
export function readBooleanArg(args: unknown, field: string | undefined): boolean {
  if (field === undefined || typeof args !== 'object' || args === null) return false
  return (args as Record<string, unknown>)[field] === true
}

/**
 * Index the configured tool sets by tool name.
 * @param fsTools - the configured tools of all four classes.
 * @returns the filesystem tools and the shell tools, each keyed by tool name.
 * @throws Error when one tool name appears in more than one class, which would make its operation depend on map order.
 */
export function indexFsTools(fsTools: Config['fsTools']): {
  fs: Map<string, FsToolEntry>
  shell: Map<string, ShellToolBinding>
} {
  const fs = new Map<string, FsToolEntry>()
  const shell = new Map<string, ShellToolBinding>()
  /**
   * Refuse a tool name that two classes claim.
   * @param name - the duplicated tool name.
   */
  const rejectDuplicate = (name: string): void => {
    if (fs.has(name) || shell.has(name)) {
      throw new Error(`sci-workspace: tool ${JSON.stringify(name)} is listed in more than one fsTools class`)
    }
  }
  for (const defaultOp of ['read', 'write', 'edit'] as const) {
    for (const binding of fsTools[defaultOp]) {
      rejectDuplicate(binding.name)
      fs.set(binding.name, { defaultOp, binding })
    }
  }
  for (const binding of fsTools.shell) {
    rejectDuplicate(binding.name)
    shell.set(binding.name, binding)
  }
  return { fs, shell }
}

/**
 * The filesystem operation one call performs.
 * @param entry - the tool's indexed binding.
 * @param args - the call's parsed arguments.
 * @returns the mapped operation of the call's sub-command, else the tool's class operation.
 */
export function resolveFsOp(entry: FsToolEntry, args: unknown): FsOp {
  const command = readStringArg(args, entry.binding.commandArg)
  if (command === undefined) return entry.defaultOp
  return entry.binding.commands?.[command] ?? entry.defaultOp
}

/**
 * Reconstruct the file content one call would leave on disk.
 *
 * A whole-content argument wins over a replacement pair, because a tool
 * carrying both uses whichever its sub-command selects and only one of them is
 * ever populated per call.
 * @param binding - where the tool keeps its content arguments.
 * @param args - the call's parsed arguments.
 * @param before - the content currently on disk, or `undefined` when absent.
 * @returns the resulting content, or `undefined` when the call carries neither form.
 */
export function reconstructAfter(binding: FsToolBinding, args: unknown, before: string | undefined): string | undefined {
  const content = readStringArg(args, binding.content)
  if (content !== undefined) return content
  const oldText = readStringArg(args, binding.oldText)
  const newText = readStringArg(args, binding.newText)
  if (oldText === undefined || newText === undefined) return undefined
  return applyReplacement(before ?? '', oldText, newText, readBooleanArg(args, binding.replaceAll))
}
