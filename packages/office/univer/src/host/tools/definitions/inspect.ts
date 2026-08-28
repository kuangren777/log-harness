import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { unitId, worktreeId } from '../../service/identifiers.ts'
import { operationOutput, operationTitle } from '../presentation.ts'
import { existingToolFile } from '../workspace.ts'

/**
 * Create the `univer_inspect` tool definition.
 * @param ctx - Cordis context carrying the `univer` service the tool calls.
 * @param timeoutMs - execution budget for one inspection.
 * @returns the registrable tool.
 */
export function inspectTool(ctx: Context, timeoutMs: number): ToolDefinition {
  return defineTool({
    name: 'univer_inspect',
    description: 'Inspect structured content from a .univer document, optionally narrowed to a unit or range.',
    timeoutMs,
    parameters: {
      file: { type: 'string', required: true, description: 'Workspace-relative or absolute .univer path.' },
      unitId: { type: 'string', required: true, description: 'Explicit target Unit id from univer_status.' },
      range: { type: 'string', description: 'Optional unit range such as Sheet1!A1:D20.' },
      worktreeId: { type: 'string', description: 'Optional worktree scope; omit to inspect trunk.' },
    },
    output: operationOutput,
    async execute(args, exec) {
      const target = await existingToolFile(exec, args.file)
      return ctx.univer.inspectUnitContent({
        workspace: target.workspace,
        file: target.path,
        unitId: unitId(args.unitId),
        ...args.range === undefined ? {} : { range: args.range },
        ...args.worktreeId === undefined ? {} : { worktreeId: worktreeId(args.worktreeId) },
      }, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: operationTitle('inspect', args.file), kind: 'read' }),
  })
}
