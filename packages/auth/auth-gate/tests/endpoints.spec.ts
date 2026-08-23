/**
 * Every `/auth` endpoint against the real SQLite provider and a real mailbox
 * double: what a caller learns, what it never learns, and what the durable
 * record holds afterwards.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AuthError, OneTimeTokenId, UserId, type AuthService, type UserId as UserIdType } from '@deepseek-ai/dsh-auth'
import SqliteAuthService, {
  CODE_ATTEMPT_CAP, PASSWORD_ATTEMPTS_PER_EMAIL, TWO_FACTOR_MIN_INTERVAL_MS,
} from '@deepseek-ai/dsh-auth-sqlite'
import { MailService, type MailMessage } from '@deepseek-ai/dsh-mail'
import type { ConnectionRpcCaller, ConnectionRpcReply } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { readCookie, splitCredential } from '../src/cookie.ts'
import {
  authenticatedRequest, emailVerify, loginStart, loginVerify, logout, logoutEverywhere, me,
  passwordForgot, passwordReset, SESSION_ISSUED_EVENT, type GateContext,
} from '../src/endpoints.ts'
import { resolveSettings } from '../src/settings.ts'

const EMAIL = 'owner@example.test'
const PASSWORD = 'correct horse battery staple'

/** In-memory mail provider that can be told to fail, for the outage path. */
class Outbox extends MailService {
  readonly sent: MailMessage[] = []
  failing = false

  override send(message: MailMessage): Promise<void> {
    if (this.failing) return Promise.reject(new Error('transport down'))
    this.sent.push(message)
    return Promise.resolve()
  }
}

let ctx: Context
let dispose: () => Promise<void>
let auth: AuthService
let outbox: Outbox
let warnings: string[]
let gate: GateContext
let userId: UserIdType
/**
 * How far this test's clock has been pushed past the real one. The provider
 * allows one second factor per account per minute, so a suite that signs in
 * twice has to move time rather than wait it out.
 */
let clockOffset = 0

/** One request's caller facts. */
function caller(headers: Record<string, string> = {}, ip = '10.0.0.1'): ConnectionRpcCaller {
  return { headers: new Headers(headers), ip }
}

/** The success value of an endpoint answer, or the reply's own result. */
function resultOf(reply: RpcResult<unknown> | ConnectionRpcReply): RpcResult<unknown> {
  return 'ok' in reply ? reply : reply.result
}

function valueOf<T>(reply: RpcResult<unknown> | ConnectionRpcReply): T {
  const result = resultOf(reply)
  if (!result.ok) throw new Error(`expected a success value, got ${result.error.code}`)
  return result.value as T
}

function cookieOf(reply: RpcResult<unknown> | ConnectionRpcReply): string {
  if ('ok' in reply) throw new Error('expected a reply carrying a cookie')
  return reply.setCookie
}

/** The six-digit code out of the most recent sign-in message. */
function deliveredCode(): string {
  const message = [...outbox.sent].reverse().find(candidate => candidate.subject === 'Your sign-in code')
  const code = message?.text.match(/is (\d{6})\./)?.[1]
  if (code === undefined) throw new Error('no sign-in code was delivered')
  return code
}

/** The token out of the most recent link message. */
function deliveredToken(subject: string): string {
  const message = [...outbox.sent].reverse().find(candidate => candidate.subject === subject)
  const token = message?.text.match(/token=([^\s]+)/)?.[1]
  if (token === undefined) throw new Error(`no ${subject} link was delivered`)
  return decodeURIComponent(token)
}

/** Drive a complete sign-in and return the cookie header it installed. */
async function signIn(headers: Record<string, string> = { 'user-agent': 'Firefox' }): Promise<string> {
  clockOffset += TWO_FACTOR_MIN_INTERVAL_MS + 1_000
  const started = valueOf<{ status: string; pendingId: string }>(
    await loginStart({ email: EMAIL, password: PASSWORD }, caller(headers), gate),
  )
  expect(started.status).toBe('2fa-required')
  const verified = await loginVerify({ pendingId: started.pendingId, code: deliveredCode() }, caller(headers), gate)
  expect(valueOf(verified)).toEqual({ status: 'ok' })
  return cookieOf(verified)
}

/** The `Cookie` request header for a `Set-Cookie` value. */
function asRequestCookie(setCookie: string): Record<string, string> {
  const pair = setCookie.split(';', 1)[0] as string
  return { cookie: pair }
}

beforeEach(async () => {
  clockOffset = 0
  const realNow = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset)
  ctx = new Context()
  const fiber = ctx.plugin(SqliteAuthService, { path: ':memory:' })
  dispose = async () => { await fiber.dispose() }
  await fiber
  const provider = ctx.get('auth')
  if (provider === undefined) throw new Error('the auth provider did not activate')
  auth = provider
  outbox = new Outbox(ctx)
  warnings = []
  gate = {
    auth,
    mail: outbox,
    settings: resolveSettings({ baseUrl: 'https://harness.example', cookieSecure: false }),
    warn: message => warnings.push(message),
  }
  userId = await auth.createUser(EMAIL, PASSWORD)
})

afterEach(async () => {
  await dispose()
  vi.restoreAllMocks()
})

describe('login.start', () => {
  it('mails a code and answers with the challenge it can be verified against', async () => {
    const started = valueOf<{ status: string; pendingId: string }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate),
    )
    expect(started.status).toBe('2fa-required')
    expect(OneTimeTokenId(started.pendingId)).toBeTruthy()
    expect(outbox.sent.map(message => message.to)).toEqual([EMAIL])
  })

  it('answers identically for an unknown address and a wrong password, and mails nothing', async () => {
    const unknown = valueOf(await loginStart({ email: 'nobody@example.test', password: PASSWORD }, caller(), gate))
    const wrong = valueOf(await loginStart({ email: EMAIL, password: 'wrong' }, caller(), gate))
    expect(unknown).toEqual({ status: 'failed' })
    expect(wrong).toEqual({ status: 'failed' })
    expect(outbox.sent).toEqual([])
  })

  it('refuses a payload that is not a sign-in', async () => {
    const result = resultOf(await loginStart({ email: EMAIL }, caller(), gate))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.code).toBe('bad-request')
  })

  it('reports a lockout deadline once the address has been tried too often', async () => {
    for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_EMAIL; attempt++) {
      await loginStart({ email: EMAIL, password: 'wrong' }, caller(), gate)
    }
    const locked = valueOf<{ status: string; retryAfterMs: number }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate),
    )
    expect(locked.status).toBe('failed')
    expect(locked.retryAfterMs).toBeGreaterThan(0)
    expect(outbox.sent).toEqual([])
  })

  it('reports the provider\'s issuance limit as the same generic failure', async () => {
    await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate)
    const throttled = valueOf<{ status: string; retryAfterMs?: number }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate),
    )
    expect(throttled.status).toBe('failed')
    expect(outbox.sent).toHaveLength(1)
  })

  it('reports a mail outage as a failure to the caller and as a warning to the operator', async () => {
    outbox.failing = true
    expect(valueOf(await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate)))
      .toEqual({ status: 'failed' })
    expect(warnings).toEqual([expect.stringContaining('delivering the sign-in code message failed')])
  })

  it('lets a provider failure that is not a rate limit escape', async () => {
    const broken: GateContext = {
      ...gate,
      auth: Object.assign(Object.create(Object.getPrototypeOf(auth) as object), auth, {
        issueOneTimeToken: () => Promise.reject(new AuthError('unknown-subject', 'gone')),
        verifyLogin: auth.verifyLogin.bind(auth),
        getUserByEmail: auth.getUserByEmail.bind(auth),
      }) as AuthService,
    }
    await expect(loginStart({ email: EMAIL, password: PASSWORD }, caller(), broken)).rejects.toThrow('gone')
  })
})

describe('login.verify', () => {
  it('installs a credential that authenticates, and only after the code is right', async () => {
    const setCookie = await signIn()
    expect(setCookie).toContain('HttpOnly; SameSite=Strict; Path=/')
    const credential = splitCredential(readCookie({ cookie: setCookie.split(';', 1)[0] }, 'dsh_session') ?? '')
    expect(credential).toBeDefined()
    const principal = await auth.authenticateToken(credential?.token ?? '')
    expect(principal).toMatchObject({ kind: 'user', userId, email: EMAIL })
  })

  it('refuses a wrong code, a replayed code, and an unknown challenge', async () => {
    const started = valueOf<{ pendingId: string }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate),
    )
    const code = deliveredCode()
    expect(valueOf(await loginVerify({ pendingId: started.pendingId, code: '000000' }, caller(), gate)))
      .toEqual({ status: 'failed' })
    expect(valueOf(await loginVerify({ pendingId: started.pendingId, code }, caller(), gate)))
      .toEqual({ status: 'ok' })
    // Replay of the consumed challenge.
    expect(valueOf(await loginVerify({ pendingId: started.pendingId, code }, caller(), gate)))
      .toEqual({ status: 'failed' })
    expect(valueOf(await loginVerify({ pendingId: 'no-such-challenge', code }, caller(), gate)))
      .toEqual({ status: 'failed' })
  })

  it('kills a challenge that has been guessed at too often, even with the right code', async () => {
    const started = valueOf<{ pendingId: string }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), gate),
    )
    const code = deliveredCode()
    for (let attempt = 0; attempt < CODE_ATTEMPT_CAP; attempt++) {
      await loginVerify({ pendingId: started.pendingId, code: '000000' }, caller(), gate)
    }
    expect(valueOf(await loginVerify({ pendingId: started.pendingId, code }, caller(), gate)))
      .toEqual({ status: 'failed' })
  })

  it('refuses an expired challenge', async () => {
    const brief: GateContext = { ...gate, settings: { ...gate.settings, codeTtlMs: 1 } }
    const started = valueOf<{ pendingId: string }>(
      await loginStart({ email: EMAIL, password: PASSWORD }, caller(), brief),
    )
    const code = deliveredCode()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(valueOf(await loginVerify({ pendingId: started.pendingId, code }, caller(), brief)))
      .toEqual({ status: 'failed' })
  })

  it('never adopts a cookie the request already carried', async () => {
    const planted = 'sess-attacker.token-attacker'
    const setCookie = await signIn({ 'user-agent': 'Firefox', cookie: `dsh_session=${planted}` })
    expect(setCookie).not.toContain(planted)
    expect(await auth.authenticateToken('token-attacker')).toBeUndefined()
  })

  it('refuses a payload that is not a verification', async () => {
    const result = resultOf(await loginVerify({ pendingId: 'x' }, caller(), gate))
    expect(result.ok).toBe(false)
  })

  it('mails a confirmation link on the first sign-in and a notice on the next unrecognized client', async () => {
    await signIn({ 'user-agent': 'Firefox' })
    expect(outbox.sent.map(message => message.subject))
      .toEqual(['Your sign-in code', 'Confirm your e-mail address'])
    outbox.sent.length = 0
    // Same client: recognized, so nothing is announced.
    await signIn({ 'user-agent': 'Firefox' })
    expect(outbox.sent.map(message => message.subject)).toEqual(['Your sign-in code'])
    outbox.sent.length = 0
    await signIn({ 'user-agent': 'Chrome' })
    expect(outbox.sent.map(message => message.subject))
      .toEqual(['Your sign-in code', 'New sign-in to your account'])
  })

  it('records one audit entry per issued session and no secret with it', async () => {
    await signIn()
    const issued = (await auth.readAudit(50)).filter(record => record.event === SESSION_ISSUED_EVENT)
    expect(issued).toHaveLength(1)
    expect(issued[0]?.detail).toMatch(/^device:[0-9a-f]{16}$/)
  })
})

describe('me, logout, and logoutEverywhere', () => {
  it('reports the account behind a credential and nothing behind none', async () => {
    const setCookie = await signIn()
    expect(valueOf(await me({}, caller(asRequestCookie(setCookie)), gate)))
      .toEqual({ authenticated: true, email: EMAIL, admin: false, groups: [] })
    expect(valueOf(await me({}, caller(), gate))).toEqual({ authenticated: false })
    expect(valueOf(await me({}, caller({ cookie: 'dsh_session=garbage' }), gate)))
      .toEqual({ authenticated: false })
  })

  it('ends exactly the session the credential names, leaving the account\'s other one working', async () => {
    const first = await signIn({ 'user-agent': 'Firefox' })
    const second = await signIn({ 'user-agent': 'Chrome' })
    const reply = await logout({}, caller(asRequestCookie(first)), gate)
    expect(valueOf(reply)).toEqual({ status: 'ok' })
    expect(cookieOf(reply)).toContain('Max-Age=0')
    expect(valueOf(await me({}, caller(asRequestCookie(first)), gate))).toEqual({ authenticated: false })
    expect(valueOf(await me({}, caller(asRequestCookie(second)), gate)))
      .toMatchObject({ authenticated: true })
  })

  it('answers success and clears the cookie even for a request with no session', async () => {
    expect(valueOf(await logout({}, caller(), gate))).toEqual({ status: 'ok' })
    expect(valueOf(await logoutEverywhere({}, caller(), gate))).toEqual({ status: 'ok' })
  })

  it('ends every session the account has', async () => {
    const first = await signIn({ 'user-agent': 'Firefox' })
    const second = await signIn({ 'user-agent': 'Chrome' })
    await logoutEverywhere({}, caller(asRequestCookie(second)), gate)
    expect(valueOf(await me({}, caller(asRequestCookie(first)), gate))).toEqual({ authenticated: false })
    expect(valueOf(await me({}, caller(asRequestCookie(second)), gate))).toEqual({ authenticated: false })
  })
})

describe('password.forgot and password.reset', () => {
  it('answers the same for an address with an account and one without', async () => {
    expect(valueOf(await passwordForgot({ email: EMAIL }, caller(), gate))).toEqual({ status: 'ok' })
    expect(valueOf(await passwordForgot({ email: 'nobody@example.test' }, caller(), gate)))
      .toEqual({ status: 'ok' })
    expect(outbox.sent.map(message => message.to)).toEqual([EMAIL])
  })

  it('refuses a payload that is not an address', async () => {
    expect(resultOf(await passwordForgot({}, caller(), gate)).ok).toBe(false)
    expect(resultOf(await passwordReset({ token: 't' }, caller(), gate)).ok).toBe(false)
  })

  it('swallows the provider\'s reset limit without telling the caller', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(valueOf(await passwordForgot({ email: EMAIL }, caller(), gate))).toEqual({ status: 'ok' })
    }
    expect(warnings.some(message => message.includes('refused by the provider rate limit'))).toBe(true)
  })

  it('sets the new password, ends every session, and says so by mail', async () => {
    const cookie = await signIn()
    await passwordForgot({ email: EMAIL }, caller(), gate)
    const token = deliveredToken('Reset your password')
    const reply = await passwordReset({ email: EMAIL, token, password: 'a whole new password' }, caller(), gate)
    expect(valueOf(reply)).toEqual({ status: 'ok' })
    expect(cookieOf(reply)).toContain('Max-Age=0')
    expect(valueOf(await me({}, caller(asRequestCookie(cookie)), gate))).toEqual({ authenticated: false })
    expect(await auth.verifyLogin(EMAIL, 'a whole new password')).toMatchObject({ ok: true })
    expect(outbox.sent.at(-1)?.subject).toBe('Your password was changed')
  })

  it('refuses a replayed, forged, or mismatched reset', async () => {
    await passwordForgot({ email: EMAIL }, caller(), gate)
    const token = deliveredToken('Reset your password')
    const other = await auth.createUser('other@example.test', PASSWORD)
    expect(other).toBeTruthy()
    expect(valueOf(await passwordReset({ email: 'other@example.test', token, password: 'x' }, caller(), gate)))
      .toEqual({ status: 'failed' })
    // The token was consumed by the refused attempt, so the right address
    // cannot replay it either: redemption is single-use, not conditional.
    expect(valueOf(await passwordReset({ email: EMAIL, token, password: 'x' }, caller(), gate)))
      .toEqual({ status: 'failed' })
    expect(valueOf(await passwordReset({ email: EMAIL, token: 'forged', password: 'x' }, caller(), gate)))
      .toEqual({ status: 'failed' })
  })
})

describe('email.verify', () => {
  it('redeems a mailed confirmation once and refuses everything else', async () => {
    await signIn()
    const token = deliveredToken('Confirm your e-mail address')
    expect(valueOf(await emailVerify({ token }, caller(), gate))).toEqual({ status: 'ok' })
    expect(valueOf(await emailVerify({ token }, caller(), gate))).toEqual({ status: 'failed' })
    expect(valueOf(await emailVerify({ token: 'forged' }, caller(), gate))).toEqual({ status: 'failed' })
    expect(resultOf(await emailVerify({}, caller(), gate)).ok).toBe(false)
    expect((await auth.readAudit(50)).some(record => record.event === 'auth.email-verified')).toBe(true)
  })
})

describe('the durable record after a full flow', () => {
  it('holds no password, code, or token anywhere in the audit log', async () => {
    const cookie = await signIn()
    const code = deliveredCode()
    await passwordForgot({ email: EMAIL }, caller(), gate)
    const resetToken = deliveredToken('Reset your password')
    await logout({}, caller(asRequestCookie(cookie)), gate)
    const secrets = [PASSWORD, code, resetToken, splitCredential(cookie.split(';', 1)[0]?.split('=')[1] ?? '')?.token]
    const log = JSON.stringify(await auth.readAudit(500))
    for (const secret of secrets) {
      if (secret === undefined || secret.length === 0) continue
      expect(log).not.toContain(secret)
    }
  })

  it('never authenticates a request whose cookie is not a credential', async () => {
    expect(await authenticatedRequest(new Headers(), gate)).toBeUndefined()
    expect(await authenticatedRequest(new Headers({ cookie: 'dsh_session=nodot' }), gate)).toBeUndefined()
    expect(await authenticatedRequest(new Headers({ cookie: 'dsh_session=a.b' }), gate)).toBeUndefined()
  })

  it('brands the account id it was created under', () => {
    expect(UserId(String(userId))).toBe(userId)
  })
})
