/**
 * Sign-in plugin registration: the two slot entries, the copy that follows the
 * active locale, the first read that decides whether this deployment
 * authenticates at all, and the teardown that releases the transport latch.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-auth/client'
import { AccountIndicator } from '../src/client/AccountIndicator.tsx'
import { AuthGateView } from '../src/client/AuthGateView.tsx'
import type { AuthFace } from '../src/client/auth-controller.ts'

// This lane has no jsdom `window`, so a fresh LocaleRuntime opens on the
// fallback locale (en); each bench stages the locale it asserts against.

/** Mount the plugin over a driven `/auth` channel and a controllable latch. */
async function bench(answers: Record<string, unknown> = { me: { authenticated: false } }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const listeners = new Set<() => void>()
  let refused = false
  const call = vi.fn((_channel: string, endpoint: string): Promise<RpcResult<unknown>> => {
    const answer = answers[endpoint]
    if (answer === undefined) return Promise.reject(new Error('channel unavailable'))
    return Promise.resolve({ ok: true, value: answer })
  })
  ctx.provide('connection', {
    api: {},
    isLoopback: true,
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
    authRequired: {
      getSnapshot: () => refused,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    rpc: { call },
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  return {
    ctx,
    slots,
    locale,
    call,
    listenerCount: (): number => listeners.size,
    refuse(): void {
      refused = true
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Declare the two seats this plugin registers into. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'shell.overlay': { kind: 'list', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/** The face one of the two entries injects. */
function faceOf(slots: SlotRegistry, slot: 'shell.overlay' | 'sidebar.footer.action'): AuthFace {
  const entry = slots.entries(slot)[0]!
  return (entry.inject as unknown as () => AuthFace)()
}

describe('ui-auth apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the card and the account row over one controller', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('shell.overlay')[0]?.component).toBe(AuthGateView)
    expect(b.slots.entries('shell.overlay')[0]?.options).toMatchObject({ id: 'auth-gate', order: 0 })
    expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(AccountIndicator)
    expect(b.slots.entries('sidebar.footer.action')[0]?.options).toMatchObject({ id: 'auth-account', order: 0 })

    // One controller behind both seats: the same store answers each face.
    const card = faceOf(b.slots, 'shell.overlay')
    const account = faceOf(b.slots, 'sidebar.footer.action')
    expect(card.hooks.auth).toBe(account.hooks.auth)
    expect(card.t('signIn')).toBe('登录')
  })

  it('opens the form once the Host says nobody is signed in', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.call).toHaveBeenCalledWith('/auth', 'me', {})
    await vi.waitFor(() => {
      expect(faceOf(b.slots, 'shell.overlay').hooks.auth.getSnapshot())
        .toMatchObject({ mounted: true, view: 'sign-in' })
    })
  })

  it('stays hidden in a deployment that mounts no request gate', async () => {
    const b = await bench({})
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => {
      expect(faceOf(b.slots, 'shell.overlay').hooks.auth.getSnapshot())
        .toMatchObject({ mounted: false, view: 'hidden' })
    })
  })

  it('opens the form when the transport reports a 401', async () => {
    const answers: Record<string, unknown> = { me: { authenticated: true, email: 'ada@example.test', admin: true } }
    const b = await bench(answers)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => {
      expect(faceOf(b.slots, 'shell.overlay').hooks.auth.getSnapshot().account).toBe('ada@example.test')
    })

    answers['me'] = { authenticated: false }
    b.refuse()
    await vi.waitFor(() => {
      expect(faceOf(b.slots, 'shell.overlay').hooks.auth.getSnapshot().view).toBe('sign-in')
    })
  })

  it('follows the active locale without re-registering', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(b.slots, 'shell.overlay')
    expect(face.t('signOutEverywhere')).toBe('退出全部设备')
    b.locale.setLocale('en')
    expect(faceOf(b.slots, 'shell.overlay').t('signOutEverywhere')).toBe('Sign out everywhere')
  })

  it('registers for a declaration that arrives after apply', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
  })
})

describe('the page facts the plugin reads', () => {
  it('lands on the mailed reset path and re-boots the page after a sign-out', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { pathname: '/reset-password', search: '?email=ada%40example.test&token=t', reload })
    try {
      const b = await bench({ 'password.reset': { status: 'ok' }, logout: { status: 'ok' } })
      declare(b.slots)
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const face = faceOf(b.slots, 'shell.overlay')
      await vi.waitFor(() => { expect(face.hooks.auth.getSnapshot().view).toBe('reset') })
      expect(b.call).not.toHaveBeenCalledWith('/auth', 'me', {})

      face.signOut()
      await vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1) })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('teardown', () => {
  it('removes both entries and releases the transport latch', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.listenerCount()).toBe(1)

    await fiber.dispose()
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(b.listenerCount()).toBe(0)
  })
})
