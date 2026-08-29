// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, SCI_TOKENS, TOKEN_SOURCE } from '../src/client/index.ts'
import { BRAND_NAME, MARK_TEST_ID, NAME_TEST_ID, SciBrandMark, SciBrandName } from '../src/client/Brand.tsx'

afterEach(() => {
  cleanup()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

/** Workbench surface tokens the sci shell packages read by name. */
const WORKBENCH_TOKENS = [
  '--dsw-sci-accent-a',
  '--dsw-sci-accent-b',
  '--dsw-sci-glass-bg',
  '--dsw-sci-glass-border',
  '--dsw-sci-card-bg',
  '--dsw-sci-chip-bg',
  '--dsw-sci-hover-bg',
  '--dsw-sci-user-bubble-bg',
  '--dsw-sci-aurora-opacity',
  '--dsw-sci-radius-card',
  '--dsw-sci-radius-pill',
] as const

/** Minimal stand-in for the theme runtime: records layers and their disposers. */
function fakeTheme() {
  const layers = new Map<string, Record<string, { light: string; dark: string }>>()
  const overrideTokens = vi.fn((source: string, tokens: Record<string, { light: string; dark: string }>) => {
    layers.set(source, tokens)
    return () => { layers.delete(source) }
  })
  return { layers, overrideTokens }
}

async function bench(declare = true) {
  // Earlier benches in this file may still hold a live plugin (and its style
  // tag); each test therefore reasons about deltas, never absolute counts.
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const theme = fakeTheme()
  ctx.provide('theme', theme)
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, theme, declareHoles, disposeHoles }
}

describe('CaMeL Science browser-brand plugin', () => {
  it('declares the slot and theme services it uses', () => {
    expect(inject).toEqual(['slots', 'theme'])
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('stacks one token layer under its package id and tears it down with the plugin', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(subject.theme.overrideTokens).toHaveBeenCalledTimes(1)
    expect(subject.theme.overrideTokens).toHaveBeenCalledWith(TOKEN_SOURCE, SCI_TOKENS)
    expect(subject.theme.layers.has(TOKEN_SOURCE)).toBe(true)
    await fiber.dispose()
    expect(subject.theme.layers.has(TOKEN_SOURCE)).toBe(false)
  })

  it('ships the workbench surface tokens in the stacked layer', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const layer = subject.theme.layers.get(TOKEN_SOURCE)!
    expect(layer['--dsw-sci-accent-a']).toEqual({ light: '#0a68ff', dark: '#0a68ff' })
    for (const name of WORKBENCH_TOKENS) {
      const value = layer[name]
      expect(value?.light.length).toBeGreaterThan(0)
      expect(value?.dark.length).toBeGreaterThan(0)
    }
    await fiber.dispose()
  })

  it('supplies both palette modes for every overridden token', () => {
    const names = Object.keys(SCI_TOKENS)
    expect(names.length).toBeGreaterThan(40)
    for (const name of names) {
      expect(name.startsWith('--dsw-')).toBe(true)
      const value = SCI_TOKENS[name]!
      expect(value.light.length).toBeGreaterThan(0)
      expect(value.dark.length).toBeGreaterThan(0)
    }
    expect(SCI_TOKENS['--dsw-alias-bg-base']).toEqual({ light: '#f5f5f7', dark: '#000000' })
  })

  it('mounts the motion/type sheet for the plugin lifetime only', async () => {
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const tags = () => document.querySelectorAll(`style[data-plugin-css="${TOKEN_SOURCE}/sci.css"]`)
    const mounted = tags()
    expect(mounted.length).toBeGreaterThan(0)
    expect(mounted[mounted.length - 1]?.getAttribute('data-plugin')).toBe(TOKEN_SOURCE)
    await fiber.dispose()
    expect(tags().length).toBe(mounted.length - 1)
  })

  it('renders the mark at the requested size and the wordmark text', () => {
    const mark = render(<SciBrandMark size={32} />)
    const tile = mark.getByTestId(MARK_TEST_ID)
    expect(tile.style.width).toBe('32px')
    expect(tile.style.height).toBe('32px')
    const name = render(<SciBrandName />)
    expect(name.getByTestId(NAME_TEST_ID).textContent).toBe(BRAND_NAME)
  })
})
