/**
 * Access section registration: slot declaration injection, the locale-following
 * nav label, the injected face, and the reconnect that re-reads only a page
 * somebody has opened.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { RpcId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-access/client'
import { AccessSection } from '../src/client/AccessSection.tsx'
import type { AccessController, AccessFace } from '../src/client/access-controller.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

const RPC = 'rpc-test' as RpcId
const SESSION = 'session-a' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const listUsers = vi.fn(() => Promise.resolve({ rpcId: RPC, result: { ok: true as const, value: { users: [] } } }))
  const listGroups = vi.fn(() => Promise.resolve({ rpcId: RPC, result: { ok: true as const, value: { groups: [] } } }))
  const inventory = vi.fn(() => Promise.resolve({
    rpcId: RPC, result: { ok: true as const, value: { groups: [], complete: true } },
  }))
  const call = vi.fn(() => Promise.resolve({ ok: true as const, value: { authenticated: true, admin: true } }))
  ctx.provide('connection', {
    api: { authAdmin: { listUsers, listGroups }, skills: { inventory } },
    isLoopback: true,
    rpc: { call },
  } as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: SESSION }), subscribe: () => () => {} },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, call, listUsers, inventory }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry): AccessFace {
  const entry = slots.entries('settings.section')[0]!
  return (entry.inject as unknown as () => AccessFace)()
}

describe('ui-settings-access apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions'])
  })

  it('registers the access nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AccessSection)
    expect(entry.options).toMatchObject({ id: 'access', order: 30 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('访问控制')
    const face = faceOf(before.slots)
    expect(face.t('nav')).toBe('访问控制')
    expect(face.t('memberToggle', { email: 'ada@example.test', name: '运营' })).toBe('ada@example.test 属于 运营')
    expect(face.hooks.access.getSnapshot()).toMatchObject({ status: 'idle', grant: 'unknown' })
    // Registering reads nothing: the administration plane is untouched until
    // the page renders.
    expect(before.call).not.toHaveBeenCalled()

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(AccessSection)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Access')
    expect(faceOf(b.slots).t('nav')).toBe('Access')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('访问控制')
  })

  it('re-reads on a reconnect, once the page has been opened', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.call).not.toHaveBeenCalled()

    faceOf(b.slots).refresh()
    await vi.waitFor(() => { expect(b.listUsers).toHaveBeenCalledTimes(1) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.listUsers).toHaveBeenCalledTimes(2) })
  })
})

describe('teardown', () => {
  it('releases the section and its reconnect listener', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    faceOf(b.slots).refresh()
    await vi.waitFor(() => { expect(b.listUsers).toHaveBeenCalledTimes(1) })
    await fiber.dispose()

    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.listUsers).toHaveBeenCalledTimes(1)
  })
})

describe('refreshIfLoaded', () => {
  it('is a no-op for an idle controller', () => {
    const store = { getSnapshot: () => ({ status: 'idle' }) }
    refreshIfLoaded({ store, refresh: () => { throw new Error('must not read') } } as unknown as AccessController)
  })
})
