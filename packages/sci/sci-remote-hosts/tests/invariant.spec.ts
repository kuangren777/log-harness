// This package owns no session state and no projection, so its companion
// registers ownership and installs nothing; the test pins that the empty
// installer is still a real registration against the registry.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SciRemoteHostsInvariant from '@deepseek-ai/dsh-sci-remote-hosts/invariant'

describe('sci-remote-hosts invariant companion', () => {
  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciRemoteHostsInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
