import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  E2B_RUNTIME_DIRECTORY,
  E2BRuntime,
  e2bControlEnvs,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import * as E2BInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/**
 * Minimal concrete provider: the seam owns path reservation and helpers, so a
 * hand-built handle is all an implementation owes the abstract class.
 */
class StubE2BRuntime extends E2BRuntime {
  constructor(ctx: Context, config: { cwd?: string } = {}) {
    super(ctx, config.cwd ?? '/home/user/workspace')
  }

  async getSandbox(): Promise<Sandbox> {
    return { sandboxId: 'stub-sandbox' } as unknown as Sandbox
  }
}

describe('E2BRuntime seam', () => {
  it('a concrete subclass registers as ctx.e2b and reserves the shared paths', async () => {
    const ctx = new Context()
    await ctx.plugin(StubE2BRuntime, { cwd: '/workspace/project' })

    expect(ctx.e2b.cwd).toBe('/workspace/project')
    expect(ctx.e2b.runtimeRoot).toBe(`/workspace/project/${E2B_RUNTIME_DIRECTORY}`)
    await expect(ctx.e2b.getSandbox()).resolves.toMatchObject({ sandboxId: 'stub-sandbox' })
  })

  it('loading a second implementation throws (one e2b service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubE2BRuntime)
    class SecondService extends StubE2BRuntime {}
    await expect(ctx.plugin(SecondService)).rejects.toThrow(/service "e2b" has been registered/)
  })

  it('rejects a working directory that is not an absolute Linux path', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(StubE2BRuntime, { cwd: 'relative' })).rejects.toThrow(
      'dsh-e2b: cwd must be an absolute Linux path: relative',
    )
  })
})

describe('E2B helpers and invariant companion', () => {
  it('gives each SDK login shell a fresh non-overridable control home', () => {
    const first = e2bControlEnvs({ HOME: '/hostile', NPM_TOKEN: '' })
    const second = e2bControlEnvs()

    expect(first.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(first).toEqual({ HOME: first.HOME, NPM_TOKEN: '' })
    expect(first.HOME).not.toBe(second.HOME)
  })

  it('quotes opaque shell arguments without interpolation', () => {
    expect(quoteE2BShellArg("a'b $HOME")).toBe("'a'\"'\"'b $HOME'")
  })

  it('registers the package-owned empty invariant installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(E2BInvariant).await()
    await fiber.dispose()
  })
})
