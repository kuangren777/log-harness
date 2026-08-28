import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { UniverError } from '../service/errors.ts'
import {
  resolveExistingUniverPath,
  resolveExistingWorkspacePath,
  resolveNewUniverPath,
  resolveNewWorkspacePath,
} from '../service/workspace.ts'

/**
 * Resolve the calling agent's workspace or fail closed for detached calls.
 * @param exec - the tool execution context.
 * @returns the calling agent's working directory.
 * @throws {UniverError} when no agent or no workspace is attached.
 */
export function toolWorkspace(exec: ToolRunContext): string {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd.length === 0) {
    throw new UniverError('Univer tools require a calling agent with a workspace.', 'SESSION_SCOPE_UNAVAILABLE')
  }
  return cwd
}

/**
 * Resolve an existing Univer file for one tool execution.
 * @param exec - the tool execution context.
 * @param file - workspace-relative or absolute path the model named.
 * @returns the authorized workspace and the resolved absolute path.
 */
export function existingToolFile(exec: ToolRunContext, file: string): ReturnType<typeof resolveExistingUniverPath> {
  return resolveExistingUniverPath(toolWorkspace(exec), file)
}

/**
 * Resolve a new Univer target for one tool execution.
 * @param exec - the tool execution context.
 * @param file - workspace-relative or absolute path the model named.
 * @returns the authorized workspace and the resolved absolute path.
 */
export function newToolFile(exec: ToolRunContext, file: string): ReturnType<typeof resolveNewUniverPath> {
  return resolveNewUniverPath(toolWorkspace(exec), file)
}

/**
 * Resolve an existing non-Univer source for one tool execution.
 * @param exec - the tool execution context.
 * @param path - workspace-relative or absolute path the model named.
 * @returns the authorized workspace and the resolved absolute path.
 */
export function existingToolPath(exec: ToolRunContext, path: string): ReturnType<typeof resolveExistingWorkspacePath> {
  return resolveExistingWorkspacePath(toolWorkspace(exec), path)
}

/**
 * Resolve a new non-Univer output for one tool execution.
 * @param exec - the tool execution context.
 * @param path - workspace-relative or absolute path the model named.
 * @returns the authorized workspace and the resolved absolute path.
 */
export function newToolPath(exec: ToolRunContext, path: string): ReturnType<typeof resolveNewWorkspacePath> {
  return resolveNewWorkspacePath(toolWorkspace(exec), path)
}
