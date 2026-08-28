import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '../service/univer-service.ts'
import { apiTool } from './definitions/api.ts'
import { compileSvgTool } from './definitions/compile-svg.ts'
import { executeTool } from './definitions/execute.ts'
import { exportTool } from './definitions/export.ts'
import { importTool } from './definitions/import.ts'
import { inspectTool } from './definitions/inspect.ts'
import { lintTool } from './definitions/lint.ts'
import { newTool } from './definitions/new.ts'
import { resourcesTool } from './definitions/resources.ts'
import { screenshotTool } from './definitions/screenshot.ts'
import { statusTool } from './definitions/status.ts'
import { unitTool } from './definitions/unit.ts'
import { worktreeTool } from './definitions/worktree.ts'
import { withUniverErrorContent } from './presentation.ts'

export const inject = ['univer', 'tools']
export const name = 'univer-tools'

/**
 * What the tool Consumer owns on its own.
 *
 * Everything else it needs — the timeouts each tool budgets and the resource
 * operation limit — is read from `ctx.univer.config`, so mounting this Consumer
 * from a separate cordis.yml row cannot restate a value the Provider already
 * holds.
 */
export interface UniverToolsConfig {
  /** Tool names withheld from registration; already validated against `UNIVER_TOOL_NAMES`. */
  readonly disabledTools: readonly string[]
}

/**
 * Register model-facing domain tools over `ctx.univer`.
 * @param ctx - Cordis context carrying the `univer` and `tools` services.
 * @param config - the names this deployment withholds.
 */
export function apply(ctx: Context, config: UniverToolsConfig): void {
  const univer = ctx.univer.config
  const gatewayReadTimeoutMs = univer.gatewayStartupTimeoutMs + univer.gatewayRequestTimeoutMs
  const gatewayWriteTimeoutMs = univer.gatewayStartupTimeoutMs + univer.gatewayMutationTimeoutMs
  const unitContentTimeoutMs = univer.gatewayStartupTimeoutMs + univer.unitContentOperationTimeoutMs
  const screenshotTimeoutMs = univer.gatewayStartupTimeoutMs + univer.screenshotOperationTimeoutMs
  // Withholding happens here, in the operation that registers, so a disabled
  // name cannot reach the tool registry by any other caller's path.
  const disabled = new Set(config.disabledTools)
  const register = (toolCtx: Context, tool: ToolDefinition): void => {
    if (disabled.has(tool.name)) return
    toolCtx.tools.register(withUniverErrorContent(tool))
  }
  register(ctx, newTool(ctx, gatewayWriteTimeoutMs))
  register(ctx, statusTool(ctx, gatewayReadTimeoutMs))
  register(ctx, worktreeTool(ctx, gatewayWriteTimeoutMs))
  register(ctx, unitTool(ctx, gatewayWriteTimeoutMs))
  register(ctx, importTool(ctx, unitContentTimeoutMs))
  register(ctx, inspectTool(ctx, unitContentTimeoutMs))
  register(ctx, executeTool(ctx, unitContentTimeoutMs))
  register(ctx, exportTool(ctx, unitContentTimeoutMs))
  register(ctx, lintTool(ctx, unitContentTimeoutMs))
  register(ctx, compileSvgTool(ctx, unitContentTimeoutMs))
  // A screenshot result must durably reference image bytes; advertise the tool only while
  // the deployment has an attachment store, and keep the execution-time re-check defensive.
  // The nested fiber restates `tools`: an inject list replaces the parent's, and reading
  // `imageCtx.tools` without declaring it throws inside the fiber, which would drop this
  // one registration while every other tool still appeared.
  ctx.inject(['attachments', 'tools'], (imageCtx) => {
    register(imageCtx, screenshotTool(imageCtx, screenshotTimeoutMs))
  })
  register(ctx, apiTool(ctx))
  register(ctx, resourcesTool(ctx, univer.resourceOperationTimeoutMs))
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'univer_worktree' || !isRecord(exec.arguments)) return next()
    const action = exec.arguments.action
    if (action !== 'merge' && action !== 'discard') return next()
    return Promise.resolve({
      kind: 'ask',
      reason: action === 'merge'
        ? 'Merging publishes the selected Univer worktree into trunk.'
        : 'Discarding permanently removes the selected Univer worktree changes.',
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
