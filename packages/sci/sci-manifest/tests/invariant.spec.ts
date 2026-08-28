import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SciManifestInvariant from '@deepseek-ai/dsh-sci-manifest/invariant'

describe('sci-manifest invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(SciManifestInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-sci-manifest', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
