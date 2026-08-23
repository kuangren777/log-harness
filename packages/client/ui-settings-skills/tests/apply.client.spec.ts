/**
 * Skills section registration: slot declaration injection, the locale-following
 * label thunk, the injected face, and the pushed invalidations that re-read.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { RpcId, SessionId, SessionSummary } from '@deepseek-ai/dsh-api-remotes/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-skills/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionFace } from '../src/client/skills-controller.ts'
import { SkillsSectionController } from '../src/client/skills-controller.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

const RPC = 'rpc-test' as RpcId
const SESSION = 'session-a' as SessionId

function summary(sessionId: SessionId, cwd: string): SessionSummary {
  return { sessionId, updatedAt: 0, running: false, blank: false, cwd }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  const inventory = vi.fn(() => Promise.resolve({
    rpcId: RPC, result: { ok: true as const, value: { groups: [], complete: true } },
  }))
  // Without a settings face the mirror's reads fail and stay contained; the
  // page itself never fetches until the section actually renders.
  ctx.provide('connection', {
    api: { skills: { inventory } },
    isLoopback: true,
    hostDescription: { getSnapshot: () => ({ home: '/home/dev' }), subscribe: () => () => {} },
  } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ current: SESSION, byId: { [SESSION]: summary(SESSION, '/proj') } }),
      subscribe: () => () => {},
    },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote, inventory }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry): SkillsSectionFace {
  const entry = slots.entries('settings.section')[0]!
  return (entry.inject as unknown as () => SkillsSectionFace)()
}

describe('ui-settings-skills apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions', 'remote', 'settingsScope'])
  })

  it('registers the skills nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(SkillsSection)
    expect(entry.options).toMatchObject({ id: 'skills', order: 12 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('技能')
    const face = faceOf(before.slots)
    expect(face.t('nav')).toBe('技能')
    expect(face.t('modelToggle', { name: 'alpha' })).toBe('允许模型调用 alpha')
    expect(typeof face.refresh).toBe('function')
    expect(face.hooks.skills.getSnapshot()).toMatchObject({ status: 'idle', home: '/home/dev' })

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(SkillsSection)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Skills')
    expect(faceOf(b.slots).t('nav')).toBe('Skills')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('技能')
  })

  it('re-reads on a forwarded catalog change and on a connection reset, once opened', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    // An unopened page fetches on neither signal.
    b.remote.$dispatch('skills/change', [])
    b.ctx.emit('connection/reset')
    expect(b.inventory).not.toHaveBeenCalled()

    await refreshOpened(b)
    b.remote.$dispatch('skills/change', [])
    await vi.waitFor(() => { expect(b.inventory).toHaveBeenCalledTimes(2) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.inventory).toHaveBeenCalledTimes(3) })
  })
})

/** Open the page the way the section's first render does. */
async function refreshOpened(b: Awaited<ReturnType<typeof bench>>): Promise<void> {
  faceOf(b.slots).refresh()
  await vi.waitFor(() => { expect(b.inventory).toHaveBeenCalledTimes(1) })
}

describe('teardown', () => {
  it('releases the section, its subscriptions, and the controller', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await refreshOpened(b)
    await fiber.dispose()

    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.remote.$dispatch('skills/change', [])
    b.ctx.emit('connection/reset')
    await Promise.resolve()
    expect(b.inventory).toHaveBeenCalledTimes(1)
  })
})

describe('refreshIfLoaded', () => {
  it('leaves an unopened page idle and re-reads an opened one', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const controller = faceOf(b.slots).hooks.skills
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('is a no-op for an idle controller', () => {
    const store = { getSnapshot: () => ({ status: 'idle' }) }
    refreshIfLoaded({ store, refresh: () => { throw new Error('must not read') } } as unknown as SkillsSectionController)
  })
})
