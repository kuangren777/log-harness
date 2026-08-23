import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AuthGateInvariant from '../src/invariant.ts'

describe('auth-gate invariant companion', () => {
  it('reserves the package name exactly once', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(AuthGateInvariant)
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-auth-gate', () => {})
    }).toThrow(/already registered/)
  })
})
