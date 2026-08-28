/**
 * Configuration resolution, including the withheld-tool list this package adds
 * on top of upstream's schema. Ported from upstream `test/host-smoke.mjs`,
 * which asserted the same defaults against the published bundle.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/host/config.ts'
import { UNIVER_TOOL_NAMES } from '../src/host/tools/names.ts'

/** Where the default resource cache lands under one DSH home. */
const cacheUnder = (dshHome: string): string => join(dshHome, 'cache', 'dsh-univer-office', 'resources')

describe('resolveConfig', () => {
  it('keeps the upstream defaults', () => {
    const resolved = resolveConfig()
    expect(resolved.gatewayPort).toBe(9080)
    expect(resolved.autoStartGateway).toBe(true)
    expect(resolved.screenshotMaxPages).toBe(30)
    expect(resolved.screenshotMaxPixels).toBe(16_777_216)
    expect(resolved.tools).toBe(true)
    expect(resolved.skills).toBe(true)
    expect(resolved.resourceCacheRoot.endsWith(join('cache', 'dsh-univer-office', 'resources'))).toBe(true)
  })

  it('takes an explicit absolute resource cache root', () => {
    expect(resolveConfig({ resourceCacheRoot: join('/tmp', 'univer-cache') }).resourceCacheRoot)
      .toBe(join('/tmp', 'univer-cache'))
  })

  it('rejects configuration that cannot run', () => {
    expect(() => resolveConfig({ gatewayPort: 0 })).toThrow(/gatewayPort/)
    expect(() => resolveConfig({ screenshotMaxPages: 0 })).toThrow(/screenshotMaxPages/)
    expect(() => resolveConfig({ resourceCacheRoot: 'relative/cache' })).toThrow(/resourceCacheRoot/)
  })
})

describe('default resource cache root', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('hangs off ~/.dsh when DSH_HOME says nothing', () => {
    for (const value of ['', '   ']) {
      vi.stubEnv('DSH_HOME', value)
      expect(resolveConfig().resourceCacheRoot).toBe(cacheUnder(join(homedir(), '.dsh')))
    }
  })

  it('expands the DSH_HOME tilde forms against the real home directory', () => {
    vi.stubEnv('DSH_HOME', '~')
    expect(resolveConfig().resourceCacheRoot).toBe(cacheUnder(homedir()))
    vi.stubEnv('DSH_HOME', '~/dsh-home')
    expect(resolveConfig().resourceCacheRoot).toBe(cacheUnder(join(homedir(), 'dsh-home')))
  })

  it('resolves any other DSH_HOME as a path', () => {
    vi.stubEnv('DSH_HOME', join('/tmp', 'dsh-home'))
    expect(resolveConfig().resourceCacheRoot).toBe(cacheUnder(join('/tmp', 'dsh-home')))
    vi.stubEnv('DSH_HOME', 'relative-home')
    expect(resolveConfig().resourceCacheRoot).toBe(cacheUnder(resolve('relative-home')))
  })
})

describe('disabledTools', () => {
  it('defaults to withholding nothing', () => {
    expect(resolveConfig().disabledTools).toEqual([])
  })

  it('accepts every registrable tool name', () => {
    expect(resolveConfig({ disabledTools: [...UNIVER_TOOL_NAMES] }).disabledTools)
      .toEqual([...UNIVER_TOOL_NAMES])
  })

  it('keeps the names a deployment asked to withhold', () => {
    expect(resolveConfig({ disabledTools: ['univer_screenshot', 'univer_lint'] }).disabledTools)
      .toEqual(['univer_screenshot', 'univer_lint'])
  })

  it('fails at load on a name that matches no tool, listing the known set', () => {
    // Silently ignoring the entry would leave the deployment advertising a tool
    // it believed it had removed, which is the failure this check exists for.
    expect(() => resolveConfig({ disabledTools: ['univer_screenshots'] }))
      .toThrow(/disabledTools names no such tool: univer_screenshots/)
    expect(() => resolveConfig({ disabledTools: ['univer_screenshots'] }))
      .toThrow(/known tools: univer_new/)
    expect(() => resolveConfig({ disabledTools: ['univer_new', 'nope', 'also_nope'] }))
      .toThrow(/no such tool: nope, also_nope/)
  })
})

describe('UNIVER_TOOL_NAMES', () => {
  it('lists every univer_ tool exactly once', () => {
    expect(new Set(UNIVER_TOOL_NAMES).size).toBe(UNIVER_TOOL_NAMES.length)
    expect(UNIVER_TOOL_NAMES.every(name => name.startsWith('univer_'))).toBe(true)
  })
})
