/**
 * The sign-in controller's state machine: what the two steps do to the
 * snapshot, what a refusal is allowed to say, which landing each mailed link
 * resolves to, how a deployment with no request gate is recognized, and what
 * happens when the transport reports a 401.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RpcResult } from '@deepseek-ai/dsh-api-remotes/client'
import {
  AuthController, AUTH_CHANNEL, RESET_PASSWORD_PATH, VERIFY_EMAIL_PATH,
  type AuthDeps, type AuthLanding, type AuthState,
} from '../src/client/auth-controller.ts'

/** One recorded `/auth` call. */
interface Call {
  endpoint: string
  payload: unknown
}

/** A driven controller plus everything a spec asserts against. */
function bench(options: {
  answers?: Record<string, unknown>
  landing?: AuthLanding
  unmounted?: boolean
} = {}) {
  const calls: Call[] = []
  const listeners = new Set<() => void>()
  let refused = false
  const reload = vi.fn()
  const deps: AuthDeps = {
    call: (channel, endpoint, payload) => {
      expect(channel).toBe(AUTH_CHANNEL)
      calls.push({ endpoint, payload })
      if (options.unmounted === true) {
        return Promise.reject(new Error(`fixture connection RPC channel "${channel}" is unavailable`))
      }
      const answer = options.answers?.[endpoint]
      if (answer === undefined) throw new Error(`spec has no answer for ${endpoint}`)
      return Promise.resolve({ ok: true, value: answer } satisfies RpcResult<unknown>)
    },
    authRequired: {
      getSnapshot: () => refused,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    landing: options.landing ?? { pathname: '/', search: '' },
    reload,
  }
  const controller = new AuthController(deps)
  const b = {
    controller,
    calls,
    reload,
    state: (): AuthState => controller.store.getSnapshot(),
    /** Report a 401 the way the transport's latch does. */
    refuse(): void {
      refused = true
      b.notify()
    },
    /** Notify subscribers without flipping the latch. */
    notify(): void {
      for (const listener of [...listeners]) listener()
    },
    listenerCount: (): number => listeners.size,
  }
  return b
}

const CHALLENGE = { status: '2fa-required', pendingId: 'challenge-1' }
const SIGNED_IN = { authenticated: true, email: 'ada@example.test', admin: true, groups: ['admin'] }

describe('the sign-in controller', () => {
  it('opens the form when the cookie authenticates nobody', async () => {
    const b = bench({ answers: { me: { authenticated: false } } })
    await b.controller.start()
    expect(b.state()).toMatchObject({ mounted: true, view: 'sign-in', pending: false, notice: 'none' })
    expect(b.calls).toEqual([{ endpoint: 'me', payload: {} }])
  })

  it('stays hidden and unmounted where no request gate serves the channel', async () => {
    const b = bench({ unmounted: true })
    await b.controller.start()
    expect(b.state()).toMatchObject({ mounted: false, view: 'hidden', pending: false })
  })

  it('names the account the cookie authenticates', async () => {
    const b = bench({ answers: { me: SIGNED_IN } })
    await b.controller.start()
    expect(b.state()).toMatchObject({ view: 'hidden', account: 'ada@example.test', admin: true })
  })

  it('carries the password step into the code step, then reloads on success', async () => {
    const b = bench({
      answers: { me: { authenticated: false }, 'login.start': CHALLENGE, 'login.verify': { status: 'ok' } },
    })
    await b.controller.start()
    await b.controller.signIn('ada@example.test', 'correct-horse-battery')
    expect(b.state()).toMatchObject({ view: 'code', pending: false, notice: 'none' })
    expect(b.calls[1]).toEqual({
      endpoint: 'login.start',
      payload: { email: 'ada@example.test', password: 'correct-horse-battery' },
    })

    await b.controller.submitCode('424242')
    expect(b.calls[2]).toEqual({ endpoint: 'login.verify', payload: { pendingId: 'challenge-1', code: '424242' } })
    // The credential changed, so the shell re-boots under it rather than
    // continuing with streams opened as nobody.
    expect(b.reload).toHaveBeenCalledTimes(1)
  })

  it('re-prompts a wrong code without saying more, and keeps the challenge', async () => {
    const b = bench({
      answers: { me: { authenticated: false }, 'login.start': CHALLENGE, 'login.verify': { status: 'failed' } },
    })
    await b.controller.start()
    await b.controller.signIn('ada@example.test', 'correct-horse-battery')
    await b.controller.submitCode('000000')
    expect(b.state()).toMatchObject({ view: 'code', pending: false, notice: 'codeFailed' })
    expect(b.reload).not.toHaveBeenCalled()

    // Leaving the step abandons the challenge; the next verify addresses none.
    b.controller.backToSignIn()
    expect(b.state()).toMatchObject({ view: 'sign-in', notice: 'none' })
    await b.controller.submitCode('424242')
    expect(b.calls.at(-1)).toEqual({ endpoint: 'login.verify', payload: { pendingId: '', code: '424242' } })
  })

  it('says the same thing about a wrong password and an address with no account', async () => {
    const b = bench({ answers: { me: { authenticated: false }, 'login.start': { status: 'failed' } } })
    await b.controller.start()
    await b.controller.signIn('ada@example.test', 'wrong')
    const wrongPassword = b.state().notice
    await b.controller.signIn('nobody@example.test', 'wrong')
    expect(b.state().notice).toBe(wrongPassword)
    expect(wrongPassword).toBe('signInFailed')
    expect(b.state().view).toBe('sign-in')
  })

  it('reports a rate-limited refusal as "later" and never as a count', async () => {
    const b = bench({
      answers: { me: { authenticated: false }, 'login.start': { status: 'failed', retryAfterMs: 60_000 } },
    })
    await b.controller.start()
    await b.controller.signIn('blocked@example.test', 'wrong')
    expect(b.state()).toMatchObject({ view: 'sign-in', notice: 'rateLimited' })
  })

  it('holds pending across a request in flight', async () => {
    let release: ((result: RpcResult<unknown>) => void) | undefined
    const controller = new AuthController({
      call: () => new Promise<RpcResult<unknown>>((resolve) => { release = resolve }),
      authRequired: { getSnapshot: () => false, subscribe: () => () => {} },
      landing: { pathname: '/', search: '' },
      reload: () => {},
    })
    const settled = controller.start()
    expect(controller.store.getSnapshot().pending).toBe(true)
    release?.({ ok: true, value: { authenticated: false } })
    await settled
    expect(controller.store.getSnapshot().pending).toBe(false)
  })

  it('acknowledges a reset request the same way for every address', async () => {
    const b = bench({ answers: { me: { authenticated: false }, 'password.forgot': { status: 'ok' } } })
    await b.controller.start()
    b.controller.beginForgot()
    expect(b.state()).toMatchObject({ view: 'forgot', notice: 'none' })
    await b.controller.requestReset('nobody@example.test')
    expect(b.state()).toMatchObject({ view: 'forgot', notice: 'forgotSent' })
    expect(b.calls.at(-1)).toEqual({ endpoint: 'password.forgot', payload: { email: 'nobody@example.test' } })
  })

  it('lands on the reset form from the mailed link and redeems it', async () => {
    const b = bench({
      landing: { pathname: RESET_PASSWORD_PATH, search: '?email=ada%40example.test&token=reset-token' },
      answers: { 'password.reset': { status: 'ok' } },
    })
    await b.controller.start()
    expect(b.state()).toMatchObject({ view: 'reset', notice: 'none' })
    expect(b.calls).toEqual([])
    await b.controller.resetPassword('next-password')
    expect(b.calls).toEqual([{
      endpoint: 'password.reset',
      payload: { email: 'ada@example.test', token: 'reset-token', password: 'next-password' },
    }])
    expect(b.state()).toMatchObject({ view: 'sign-in', notice: 'resetDone' })
  })

  it('keeps the reset form up when the link no longer redeems', async () => {
    const b = bench({
      landing: { pathname: RESET_PASSWORD_PATH, search: '?email=ada%40example.test&token=stale' },
      answers: { 'password.reset': { status: 'failed' } },
    })
    await b.controller.start()
    await b.controller.resetPassword('next-password')
    expect(b.state()).toMatchObject({ view: 'reset', notice: 'resetFailed' })
  })

  it('redeems a confirmation link and reports only whether it redeemed', async () => {
    const ok = bench({
      landing: { pathname: VERIFY_EMAIL_PATH, search: '?token=verify-token' },
      answers: { 'email.verify': { status: 'ok' } },
    })
    await ok.controller.start()
    expect(ok.calls).toEqual([{ endpoint: 'email.verify', payload: { token: 'verify-token' } }])
    expect(ok.state()).toMatchObject({ view: 'verify', notice: 'verified' })

    const stale = bench({
      landing: { pathname: VERIFY_EMAIL_PATH, search: '?token=stale' },
      answers: { 'email.verify': { status: 'failed' } },
    })
    await stale.controller.start()
    expect(stale.state()).toMatchObject({ view: 'verify', notice: 'verifyFailed' })
  })

  it('treats a link with nothing to redeem as an ordinary boot', async () => {
    const noToken = bench({
      landing: { pathname: RESET_PASSWORD_PATH, search: '' },
      answers: { me: { authenticated: false } },
    })
    await noToken.controller.start()
    expect(noToken.calls).toEqual([{ endpoint: 'me', payload: {} }])

    const noAddress = bench({
      landing: { pathname: RESET_PASSWORD_PATH, search: '?token=reset-token' },
      answers: { me: { authenticated: false } },
    })
    await noAddress.controller.start()
    expect(noAddress.state().view).toBe('sign-in')

    const otherPath = bench({
      landing: { pathname: '/somewhere', search: '?token=reset-token' },
      answers: { me: { authenticated: false } },
    })
    await otherPath.controller.start()
    expect(otherPath.state().view).toBe('sign-in')
  })

  it('ends this session and every session through their own endpoints', async () => {
    const one = bench({ answers: { me: SIGNED_IN, logout: { status: 'ok' } } })
    await one.controller.start()
    await one.controller.signOut()
    expect(one.calls.at(-1)).toEqual({ endpoint: 'logout', payload: {} })
    expect(one.reload).toHaveBeenCalledTimes(1)

    const all = bench({ answers: { me: SIGNED_IN, logoutEverywhere: { status: 'ok' } } })
    await all.controller.start()
    await all.controller.signOutEverywhere()
    expect(all.calls.at(-1)).toEqual({ endpoint: 'logoutEverywhere', payload: {} })
    expect(all.reload).toHaveBeenCalledTimes(1)
  })

  it('re-reads the account when the transport reports a refusal, and only then', async () => {
    const answers: Record<string, unknown> = { me: SIGNED_IN }
    const b = bench({ answers })
    await b.controller.start()
    expect(b.state().view).toBe('hidden')

    answers['me'] = { authenticated: false }
    b.refuse()
    await vi.waitFor(() => { expect(b.state().view).toBe('sign-in') })
    expect(b.calls).toHaveLength(2)

    // A second notification while the form is already up asks nothing again.
    b.refuse()
    await Promise.resolve()
    expect(b.calls).toHaveLength(2)
  })

  it('gives up on every action once the channel stops answering', async () => {
    const b = bench({ unmounted: true, landing: { pathname: VERIFY_EMAIL_PATH, search: '?token=t' } })
    // The confirmation landing is the one action that runs before any other.
    await b.controller.start()
    expect(b.state()).toMatchObject({ mounted: false, view: 'hidden' })

    const gone = bench({ unmounted: true })
    await Promise.all([
      gone.controller.signIn('ada@example.test', 'correct-horse-battery'),
      gone.controller.submitCode('424242'),
      gone.controller.requestReset('ada@example.test'),
      gone.controller.signOut(),
      gone.controller.signOutEverywhere(),
    ])
    expect(gone.state()).toMatchObject({ mounted: false, view: 'hidden', pending: false })
    expect(gone.reload).not.toHaveBeenCalled()

    // The reset landing keeps its link, so its action reaches the channel too.
    const reset = bench({ unmounted: true, landing: { pathname: RESET_PASSWORD_PATH, search: '?email=a%40b.test&token=t' } })
    await reset.controller.start()
    await reset.controller.resetPassword('next-password')
    expect(reset.state()).toMatchObject({ mounted: false, view: 'hidden' })
  })

  it('hands every action to the injected face', async () => {
    const answers: Record<string, unknown> = {
      me: { authenticated: false },
      'login.start': CHALLENGE,
      'login.verify': { status: 'failed' },
      'password.forgot': { status: 'ok' },
      'password.reset': { status: 'ok' },
      logout: { status: 'ok' },
      logoutEverywhere: { status: 'ok' },
    }
    const b = bench({ answers, landing: { pathname: RESET_PASSWORD_PATH, search: '?email=a%40b.test&token=t' } })
    const copy = ((key: string) => key) as Parameters<AuthController['inject']>[0]
    const face = b.controller.inject(copy)
    expect(face.hooks.auth).toBe(b.controller.store)
    expect(face.t).toBe(copy)

    face.signIn('ada@example.test', 'correct-horse-battery')
    face.submitCode('424242')
    face.beginForgot()
    face.requestReset('ada@example.test')
    face.backToSignIn()
    face.signOut()
    face.signOutEverywhere()
    await vi.waitFor(() => {
      expect(b.calls.map(entry => entry.endpoint)).toEqual([
        'login.start', 'login.verify', 'password.forgot', 'logout', 'logoutEverywhere',
      ])
    })

    await b.controller.start()
    face.resetPassword('next-password')
    await vi.waitFor(() => { expect(b.calls.at(-1)?.endpoint).toBe('password.reset') })
  })

  it('acts only on a latch that actually flipped, and releases it on dispose', async () => {
    const b = bench({ answers: { me: SIGNED_IN } })
    await b.controller.start()
    // A notification with the latch still false reads as no refusal at all.
    b.notify()
    await Promise.resolve()
    expect(b.calls).toHaveLength(1)

    b.controller.dispose()
    expect(b.listenerCount()).toBe(0)
    b.refuse()
    await Promise.resolve()
    expect(b.calls).toHaveLength(1)
  })
})
