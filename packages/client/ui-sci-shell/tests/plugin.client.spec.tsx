// @vitest-environment jsdom
/**
 * The plugin body: the rail occupant and the two seats it declares inside
 * itself, the two overlay entries, and the proof that all five leave with the
 * plugin fiber. The rail seats are declared by this package's own rail
 * registration, so the suite also proves the two halves find each other
 * whichever order they install in.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import type { ThemeToggleInjected } from '../src/client/RailFooter.tsx'
import type { ProfilePopoverInjected } from '../src/client/ProfilePopover.tsx'

// The shipped Chinese copy is what this suite asserts, so it states the
// browser locale the service reads at startup.
usePinnedBrowserLanguages('zh-CN')

const RAIL = 'rail'
const ITEM = 'rail.item'
const FOOTER = 'rail.footer'
const OVERLAY = 'shell.overlay'

/** A Context carrying the four services the plugin injects, with fake theme reads. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', {} as never)
  const setTheme = vi.fn()
  ctx.provide('theme', {
    getTheme: () => ({ active: { id: 'dark', colorScheme: 'dark', tokens: {} } }),
    setTheme,
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The frame ui-layout would contribute: the rail column and the overlay
  // layer, declared by whatever occupies the built-in root slot.
  const declare = () => slots.register({
    name: 'root',
    children: {
      [RAIL]: { kind: 'single', scope: 'root' },
      [OVERLAY]: { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, declare, setTheme }
}

/** Entry ids of one list slot, in render order. */
function idsOf(slots: SlotRegistry, key: string): readonly (string | undefined)[] {
  return slots.entries(key as never).map(entry => entry.options.id)
}

describe('ui-sci-shell plugin body', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'theme'])
  })

  it('installs the rail, its two seats, and the two overlay entries', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries(RAIL as never)).toHaveLength(1)
    expect(idsOf(b.slots, ITEM)).toEqual(['conversation'])
    expect(idsOf(b.slots, FOOTER)).toEqual(['theme-toggle', 'profile'])
    expect(idsOf(b.slots, OVERLAY)).toEqual(['sci-aurora', 'sci-profile'])

    // Registry-contribution disposal proof: the fiber going down empties
    // every slot this package touched, including the seats it declared.
    await fiber.dispose()
    for (const key of [RAIL, ITEM, FOOTER, OVERLAY]) {
      expect(b.slots.entries(key as never)).toHaveLength(0)
    }
  })

  it('installs whether the frame declares the rail before or after apply', async () => {
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(RAIL as never)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    expect(after.slots.entries(RAIL as never)).toHaveLength(1)
    expect(idsOf(after.slots, FOOTER)).toEqual(['theme-toggle', 'profile'])
  })

  it('orders the aurora far below every other overlay entry', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const orders = b.slots.entries(OVERLAY as never).map(entry => entry.options.order)
    expect(orders).toEqual([-100, 50])
  })

  it('gives the avatar and the popover one shared store instance', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const footerProfile = b.slots.entries(FOOTER as never).find(entry => entry.options.id === 'profile')
    const overlayProfile = b.slots.entries(OVERLAY as never).find(entry => entry.options.id === 'sci-profile')
    expect(footerProfile?.store).toBeDefined()
    expect(footerProfile?.store).toBe(overlayProfile?.store)
  })

  it('reads the palette through the theme service and writes the other one back', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const toggle = b.slots.entries(FOOTER as never).find(entry => entry.options.id === 'theme-toggle')
    const face = (toggle?.inject as unknown as () => ThemeToggleInjected)()
    expect(face.getScheme()).toBe('dark')
    face.setTheme('light')
    expect(b.setTheme).toHaveBeenCalledWith('light')

    // The subscription is the cordis event, and it detaches on unsubscribe.
    const onChange = vi.fn()
    const off = face.subscribe(onChange)
    b.ctx.emit('theme/change', {} as never)
    expect(onChange).toHaveBeenCalledTimes(1)
    off()
    b.ctx.emit('theme/change', {} as never)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('publishes one identity per gate read, so the popover effect does not re-run', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const popover = b.slots.entries(OVERLAY as never).find(entry => entry.options.id === 'sci-profile')
    const first = (popover?.inject as unknown as () => ProfilePopoverInjected)()
    const second = (popover?.inject as unknown as () => ProfilePopoverInjected)()
    expect(first.fetchMe).toBe(second.fetchMe)
    expect(first.fetchBalance).toBe(second.fetchBalance)
    expect(first.logout).toBe(second.logout)
  })

  it('points the popover face at the three gate routes', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const popover = b.slots.entries(OVERLAY as never).find(entry => entry.options.id === 'sci-profile')
    const face = (popover?.inject as unknown as () => ProfilePopoverInjected)()

    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ email: 'a@b', vms: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(face.fetchMe()).resolves.toMatchObject({ email: 'a@b' })
    await expect(face.fetchBalance()).resolves.toMatchObject({ totalUsd: '' })
    await expect(face.logout()).resolves.toBe(true)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/gate/api/me', '/gate/api/credit/balance', '/gate/api/logout',
    ])
    vi.unstubAllGlobals()
  })

  it('labels the rail from its own dictionary', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    expect(locale.bind('sci-shell' as never)('rail.conversation' as never)).toBe('研究流')
  })
})

describe('ui-sci-shell node half', () => {
  it('is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
