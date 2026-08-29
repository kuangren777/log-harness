// No jsdom pragma on purpose: this file runs in the node environment, which is
// how the browser plugin's document-less (SSR/prerender) path gets exercised.
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import * as BrandInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject, SCI_TOKENS, TOKEN_SOURCE } from '../src/client/index.ts'

describe('CaMeL Science brand invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(BrandInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

describe('browser plugin without a document', () => {
  it('still stacks the token layer and fills the brand slots', async () => {
    expect(typeof document).toBe('undefined')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const overrideTokens = vi.fn(() => () => {})
    ctx.provide('theme', { overrideTokens })
    slots.register({
      name: 'root',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(overrideTokens).toHaveBeenCalledWith(TOKEN_SOURCE, SCI_TOKENS)
    expect(slots.entries('sidebar.brand.mark')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('sidebar.brand.mark')).toHaveLength(0)
  })
})
