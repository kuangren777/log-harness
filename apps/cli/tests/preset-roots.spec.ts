/**
 * The shipped-preset-root overlay: whose roots the roster ends up scanning
 * when a profile declares its own and when it declares none.
 */

import { fileURLToPath } from 'node:url'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import { resolvePresetRootPatch } from '../src/profile-boot.ts'

/** The root the launcher supplies, as `profile-boot` resolves it. */
const SHIPPED = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

/** One composed `agent-presets` row carrying `config`. */
function row(config: Record<string, unknown>): EntryOptions {
  return { id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets', config }
}

describe('resolvePresetRootPatch', () => {
  it('injects the shipped root, keeping every other configured key, when the profile declares none', () => {
    expect(resolvePresetRootPatch(row({ default: 'standard' }))).toEqual({
      id: 'agent-presets',
      config: { default: 'standard', roots: [{ path: SHIPPED, trust: 'system' }] },
    })
  })

  it('treats an empty roots list as declaring none', () => {
    expect(resolvePresetRootPatch(row({ default: 'standard', roots: [] }))?.config)
      .toEqual({ default: 'standard', roots: [{ path: SHIPPED, trust: 'system' }] })
  })

  it('injects over a row that carries no config at all', () => {
    expect(resolvePresetRootPatch({ id: 'agent-presets', name: '@deepseek-ai/dsh-agent-presets' })?.config)
      .toEqual({ roots: [{ path: SHIPPED, trust: 'system' }] })
  })

  it('leaves declared roots alone, so a bundle can ship the only preset tree', () => {
    // The sci bundle's shape: one root of its own, resolved through
    // `dshBundlePath` and still an unevaluated expression node at this point.
    const declared = row({
      default: 'sci-balanced',
      roots: [{ path: { __jsExpr: "dshBundlePath('@deepseek-ai/dsh-sci-profile', 'config/agent-presets')" }, trust: 'system' }],
    })

    expect(resolvePresetRootPatch(declared)).toBeUndefined()
  })

  it('generates nothing for a composition that mounts no roster', () => {
    expect(resolvePresetRootPatch(undefined)).toBeUndefined()
  })
})
