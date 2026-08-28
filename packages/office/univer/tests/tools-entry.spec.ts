/**
 * The `@deepseek-ai/dsh-office-univer/tools` row as an agent preset mounts it:
 * one shared host-plane Provider, one tool registry per agent scope, and a
 * per-row `disabledTools` list. What is asserted is what the agent ends up
 * being able to call, read from the live registry.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Fiber } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { resolveConfig } from '../src/host/config.ts'
import type { Config as UniverConfig } from '../src/host/config.ts'
import { UNIVER_TOOL_NAMES } from '../src/host/tools/names.ts'
import { UniverService } from '../src/host/service/univer-service.ts'
import * as toolsEntry from '../src/tools.ts'

/** Nothing here reaches a document operation; only registration is observed. */
function unreachable(): never {
  throw new Error('univer service operation is not exercised by a registration test')
}

/**
 * A Provider that publishes the resolved configuration and refuses every
 * document operation. Registration never calls one, so a throwing body is the
 * honest body: a silent stub would let a wrong call pass unnoticed.
 */
class StubUniverService extends UniverService {
  gatewayStatus = (): never => unreachable()
  ensureGateway = (): never => unreachable()
  unitContentStatus = (): never => unreachable()
  fileState = (): never => unreachable()
  worktreeAction = (): never => unreachable()
  newFile = (): never => unreachable()
  status = (): never => unreachable()
  worktree = (): never => unreachable()
  unit = (): never => unreachable()
  inspectUnitContent = (): never => unreachable()
  executeUnitContent = (): never => unreachable()
  importUnitContent = (): never => unreachable()
  exportUnitContent = (): never => unreachable()
  lintUnitLayout = (): never => unreachable()
  screenshotUnit = (): never => unreachable()
  compileSvg = (): never => unreachable()
  apiReference = (): never => unreachable()
  resources = (): never => unreachable()
}

/**
 * An attachment store that only has to exist. `univer_screenshot` is advertised
 * on the presence of the service, and no test here executes it, so a throwing
 * body keeps a wrong call visible.
 */
class StubAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 1,
    mediaTypes: ['image/png'],
  }

  validateImage = (): never => unreachable()
  saveImage = (): never => unreachable()
  readImage = (): never => unreachable()
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** Host plane: the Provider one deployment shares across every agent. */
async function hostPlane(config: UniverConfig = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(StubUniverService, resolveConfig(config))
  return ctx
}

/**
 * One agent scope: its own tool registry behind an `isolate` realm, over the
 * shared Provider, with the `./tools` row mounted into it.
 */
async function agentScope(host: Context, config?: toolsEntry.Config): Promise<{ ctx: Context; fiber: Fiber }> {
  const ctx = host.isolate('tools')
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(toolsEntry, config)
  // `univer_screenshot` registers from a nested `ctx.inject(['attachments'])`,
  // one scheduler pass behind its parent row.
  await fiber.await()
  return { ctx, fiber }
}

/** Names this scope's registry advertises out of the package's tool set. */
function registered(ctx: Context): string[] {
  return UNIVER_TOOL_NAMES.filter(name => ctx.tools.get(name) !== undefined)
}

describe('mountable tools row', () => {
  it('advertises every tool the row did not withhold', async () => {
    const { ctx } = await agentScope(await hostPlane())
    // `univer_screenshot` needs an attachment store to hold its image bytes,
    // so a scope without one never sees it — that gate is the tool's own.
    expect(registered(ctx)).toEqual(UNIVER_TOOL_NAMES.filter(name => name !== 'univer_screenshot'))
  })

  it('withholds exactly the configured names', async () => {
    const disabledTools = ['univer_screenshot', 'univer_lint']
    const { ctx } = await agentScope(await hostPlane(), { disabledTools })
    const advertised = registered(ctx)
    expect(advertised).not.toContain('univer_lint')
    expect(advertised).toHaveLength(UNIVER_TOOL_NAMES.length - disabledTools.length)
  })

  it('refuses to load when a withheld name matches no tool', async () => {
    const host = await hostPlane()
    await expect(agentScope(host, { disabledTools: ['univer_lint', 'univer_typo'] }))
      .rejects.toThrow(/univer_typo/)
  })

  it('reads its timeouts from the Provider rather than from the row', async () => {
    // The row carries no timeout key at all, so a tool's deadline can only have
    // come from the shared Provider's resolved configuration.
    const host = await hostPlane({ gatewayStartupTimeoutMs: 11, gatewayRequestTimeoutMs: 22 })
    const { ctx } = await agentScope(host)
    expect(ctx.tools.get('univer_status')?.timeoutMs).toBe(33)
  })

  it('gives two agent scopes independent tool sets over one Provider', async () => {
    const host = await hostPlane()
    const permissive = await agentScope(host, { disabledTools: ['univer_lint'] })
    const restricted = await agentScope(host, { disabledTools: ['univer_export', 'univer_api'] })

    expect(registered(permissive.ctx)).toContain('univer_export')
    expect(registered(permissive.ctx)).not.toContain('univer_lint')
    expect(registered(restricted.ctx)).toContain('univer_lint')
    expect(registered(restricted.ctx)).not.toContain('univer_export')

    // Disposing one agent leaves the other's registry untouched.
    await permissive.fiber.dispose()
    expect(registered(permissive.ctx)).toEqual([])
    expect(registered(restricted.ctx)).toContain('univer_lint')
  })

  it('removes its tools when its own fiber is disposed', async () => {
    const { ctx, fiber } = await agentScope(await hostPlane())
    expect(registered(ctx).length).toBeGreaterThan(0)
    await fiber.dispose()
    expect(registered(ctx)).toEqual([])
  })
})

describe('univer_screenshot admission', () => {
  it('advertises the tool once the scope has an attachment store', async () => {
    const host = await hostPlane()
    await host.plugin(StubAttachmentStore)
    const { ctx } = await agentScope(host)
    expect(registered(ctx)).toEqual([...UNIVER_TOOL_NAMES])
  })

  it('still withholds it when the row disabled it, attachment store or not', async () => {
    const host = await hostPlane()
    await host.plugin(StubAttachmentStore)
    const { ctx } = await agentScope(host, { disabledTools: ['univer_screenshot'] })
    expect(registered(ctx)).not.toContain('univer_screenshot')
  })
})

describe('worktree approval gate', () => {
  /** Run one execution past the row's `tools/pre-execute` listener. */
  async function gate(ctx: Context, name: string, args: unknown): Promise<PreToolDecision> {
    const exec = { name, arguments: args } as unknown as ToolExecution
    return ctx.waterfall('tools/pre-execute', exec, () => Promise.resolve<PreToolDecision>({ kind: 'allow' }))
  }

  it('asks before a merge and before a discard', async () => {
    const { ctx } = await agentScope(await hostPlane())
    // The reason reaches the person approving, so it is pinned verbatim.
    await expect(gate(ctx, 'univer_worktree', { action: 'merge' })).resolves.toEqual({
      kind: 'ask',
      reason: 'Merging publishes the selected Univer worktree into trunk.',
    })
    await expect(gate(ctx, 'univer_worktree', { action: 'discard' })).resolves.toEqual({
      kind: 'ask',
      reason: 'Discarding permanently removes the selected Univer worktree changes.',
    })
  })

  it('delegates every other execution', async () => {
    const { ctx } = await agentScope(await hostPlane())
    // Another tool, a non-reviewable worktree action, and arguments that are not
    // an object at all: none of the three is the decision this gate makes.
    await expect(gate(ctx, 'univer_status', { action: 'merge' })).resolves.toEqual({ kind: 'allow' })
    await expect(gate(ctx, 'univer_worktree', { action: 'create' })).resolves.toEqual({ kind: 'allow' })
    await expect(gate(ctx, 'univer_worktree', ['merge'])).resolves.toEqual({ kind: 'allow' })
  })
})
