/**
 * The `/auth` channel's endpoints.
 *
 * Two rules run through all of them. A failure answer never distinguishes an
 * unknown address from a wrong password, an expired code from a wrong one, or
 * a consumed link from a forged one, so no endpoint can be used to enumerate
 * accounts. And a bearer token is minted in exactly one place — the second
 * factor's verification — so a cookie a caller already holds can never be
 * upgraded into an authenticated one.
 * @module @deepseek-ai/dsh-auth-gate/endpoints
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  AuthError,
  OneTimeTokenId,
  type AuditRecord,
  type AuthService,
  type AuthSessionId,
  type Principal,
  type UserRecord,
} from '@deepseek-ai/dsh-auth'
import type { ConnectionRpcCaller, ConnectionRpcReply } from '@deepseek-ai/dsh-client-connection'
import type { RequestHeaders } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { MailService } from '@deepseek-ai/dsh-mail'
import { joinCredential, readCookie, sessionCookie, splitCredential } from './cookie.ts'
import {
  emailVerificationMessage,
  newSignInMessage,
  passwordChangedMessage,
  passwordResetMessage,
  twoFactorCodeMessage,
} from './messages.ts'
import type { GateSettings } from './settings.ts'
import type {
  EmailVerifyResult, LoginStartResult, LoginVerifyResult, LogoutResult, MeResult,
  PasswordForgotResult, PasswordResetResult,
} from './types.ts'

/**
 * How far back the sign-in history is read when deciding whether a client is
 * new. A fixed security constant, not a tunable: a deployment that could
 * shorten it could turn the unrecognized-client notice off without saying so.
 */
export const SIGN_IN_HISTORY_LIMIT = 500

/**
 * Audit event this gate writes for one browser sign-in; the sign-in history is
 * the set of these. Distinct from the provider's own `auth.session-issued`,
 * which records every issued session including ones no browser asked for, and
 * carries no client fingerprint to compare against.
 */
export const SESSION_ISSUED_EVENT = 'auth.gate-sign-in'

/** Everything an endpoint acts through. */
export interface GateContext {
  /** The mounted auth provider. */
  readonly auth: AuthService
  /** The mounted mail provider. */
  readonly mail: MailService
  /** Resolved gate parameters. */
  readonly settings: GateSettings
  /** Operator-facing diagnostics sink; a failure a caller must not be told about still reaches an operator. */
  readonly warn: (message: string) => void
}

/** One authenticated request: its principal and the session its cookie names. */
export interface AuthenticatedRequest {
  /** The authenticated account. */
  readonly principal: Extract<Principal, { kind: 'user' }>
  /** The session the presented cookie names, so a sign-out can revoke exactly it. */
  readonly authSessionId: AuthSessionId
}

const loginStartSchema = z.object({ email: z.string(), password: z.string() })
const loginVerifySchema = z.object({ pendingId: z.string(), code: z.string() })
const passwordForgotSchema = z.object({ email: z.string() })
const passwordResetSchema = z.object({ email: z.string(), token: z.string(), password: z.string() })
const emailVerifySchema = z.object({ token: z.string() })

/** Wrap one endpoint value as a successful business result. */
function value<T>(result: T): RpcResult<T> {
  return { ok: true, value: result }
}

/** The one refusal an endpoint makes: a payload that is not the endpoint's own. */
function malformed(endpoint: string, issues: z.core.$ZodIssue[]): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message: `invalid payload for ${endpoint}`, details: { issues } } }
}

/**
 * A stable, non-reversible name for one client, used to tell a recognized
 * sign-in from a new one. The digest keeps the audit log free of a full
 * user-agent string while still comparing exactly.
 */
function deviceDigest(ip: string | undefined, userAgent: string | undefined): string {
  return `device:${createHash('sha256').update(`${ip ?? ''}\n${userAgent ?? ''}`).digest('hex').slice(0, 16)}`
}

/** The user-agent the caller sent, if any. */
function userAgentOf(caller: ConnectionRpcCaller): string | undefined {
  return caller.headers.get('user-agent') ?? undefined
}

/**
 * Resolve one request's cookie to its account and session.
 * @param headers - the request's headers.
 * @param gate - the gate's dependencies.
 * @returns the authenticated request, or `undefined` when the cookie is absent, malformed, or no longer authenticates.
 */
export async function authenticatedRequest(
  headers: RequestHeaders,
  gate: GateContext,
): Promise<AuthenticatedRequest | undefined> {
  const cookie = readCookie(headers, gate.settings.cookieName)
  if (cookie === undefined) return undefined
  const credential = splitCredential(cookie)
  if (credential === undefined) return undefined
  const principal = await gate.auth.authenticateToken(credential.token)
  // A provider only ever answers a token with the account it belongs to; the
  // `local` kind is minted by entry points that present no token at all.
  if (principal === undefined || principal.kind !== 'user') return undefined
  return { principal, authSessionId: credential.authSessionId }
}

/** Deliver one message, keeping a transport failure away from the caller's answer. */
async function deliver(gate: GateContext, message: Parameters<MailService['send']>[0], purpose: string): Promise<boolean> {
  try {
    await gate.mail.send(message)
    return true
  } catch (error: unknown) {
    // Telling the caller would turn a mail outage into an account oracle: the
    // failure can only happen for an address that has an account.
    gate.warn(`auth-gate: delivering the ${purpose} message failed: ${String(error)}`)
    return false
  }
}

/** One absolute link into this deployment, carrying a one-time token. */
function link(gate: GateContext, path: string, params: Record<string, string>): string {
  const url = new URL(path, gate.settings.baseUrl)
  for (const [key, entry] of Object.entries(params)) url.searchParams.set(key, entry)
  return url.href
}

/**
 * `login.start` — check the password and put a second factor in the account's
 * mailbox. The answer carries no evidence about the address either way.
 * @param payload - the submitted credentials.
 * @param caller - the request's client facts, for the provider's per-address limits.
 * @param gate - the gate's dependencies.
 * @returns the challenge to verify against, or the generic failure.
 */
export async function loginStart(
  payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<LoginStartResult>> {
  const parsed = loginStartSchema.safeParse(payload)
  if (!parsed.success) return malformed('login.start', parsed.error.issues)
  const outcome = await gate.auth.verifyLogin(parsed.data.email, parsed.data.password, caller.ip)
  if (!outcome.ok) {
    return value<LoginStartResult>({
      status: 'failed',
      // A lockout deadline is the one fact a failure may carry: attempts are
      // counted against the submitted address whether or not it has an
      // account, so it says only that this address was tried too often.
      ...outcome.lockedUntil === undefined ? {} : { retryAfterMs: Math.max(0, outcome.lockedUntil - Date.now()) },
    })
  }
  const user = await gate.auth.getUserByEmail(parsed.data.email)
  // The address just authenticated, so its account exists; a disappearance
  // between the two reads is a deletion racing the sign-in.
  if (user === undefined) return value<LoginStartResult>({ status: 'failed' })
  let challenge
  try {
    challenge = await gate.auth.issueOneTimeToken('2fa', user.userId, gate.settings.codeTtlMs)
  } catch (error: unknown) {
    if (error instanceof AuthError && error.code === 'rate-limited') {
      return value<LoginStartResult>({
        status: 'failed',
        ...error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs },
      })
    }
    throw error
  }
  const delivered = await deliver(
    gate,
    twoFactorCodeMessage(user.email, challenge.secret, gate.settings.codeTtlMs),
    'sign-in code',
  )
  if (!delivered) return value<LoginStartResult>({ status: 'failed' })
  return value<LoginStartResult>({ status: '2fa-required', pendingId: challenge.oneTimeTokenId })
}

/** Every session this account has been issued, most recent first, within the fixed history window. */
async function signInHistory(gate: GateContext, userId: string): Promise<AuditRecord[]> {
  const records = await gate.auth.readAudit(SIGN_IN_HISTORY_LIMIT)
  return records.filter(record => record.event === SESSION_ISSUED_EVENT && record.actorUserId === userId)
}

/** Mail the notices one freshly issued session earns, if any. */
async function announceSignIn(
  gate: GateContext,
  user: UserRecord,
  history: readonly AuditRecord[],
  device: string,
  caller: ConnectionRpcCaller,
): Promise<void> {
  if (history.length === 0) {
    // First sign-in ever. An unconfirmed address gets its confirmation link
    // here rather than an unrecognized-client notice, which would be every
    // account's first message and mean nothing.
    if (user.emailVerifiedAt === undefined) {
      const confirmation = await gate.auth.issueOneTimeToken('verify-email', user.userId, gate.settings.linkTtlMs)
      await deliver(
        gate,
        emailVerificationMessage(user.email, link(gate, '/verify-email', { token: confirmation.secret }), gate.settings.linkTtlMs),
        'address confirmation',
      )
    }
    return
  }
  if (history.some(record => record.detail === device)) return
  await deliver(gate, newSignInMessage(user.email, caller.ip, userAgentOf(caller)), 'new sign-in notice')
}

/**
 * `login.verify` — redeem the second factor and install the session cookie.
 *
 * This is the only place a bearer token is minted. Any cookie the request
 * already carries is ignored rather than adopted, so a value an attacker
 * planted in the browser before the sign-in cannot become the session that
 * sign-in produces.
 * @param payload - the challenge id and the code answering it.
 * @param caller - the request's client facts, recorded with the session.
 * @param gate - the gate's dependencies.
 * @returns the reply, carrying the credential cookie on success.
 */
export async function loginVerify(
  payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<LoginVerifyResult> | ConnectionRpcReply> {
  const parsed = loginVerifySchema.safeParse(payload)
  if (!parsed.success) return malformed('login.verify', parsed.error.issues)
  const userId = await gate.auth.verifyTotpCode(OneTimeTokenId(parsed.data.pendingId), parsed.data.code)
  if (userId === undefined) return value<LoginVerifyResult>({ status: 'failed' })
  const issued = await gate.auth.issueAuthSession(userId, {
    ...caller.ip === undefined ? {} : { ip: caller.ip },
    ...userAgentOf(caller) === undefined ? {} : { userAgent: userAgentOf(caller) as string },
  })
  const device = deviceDigest(caller.ip, userAgentOf(caller))
  const history = await signInHistory(gate, userId)
  await gate.auth.audit({
    event: SESSION_ISSUED_EVENT,
    actorUserId: userId,
    subject: issued.authSessionId,
    detail: device,
    ...caller.ip === undefined ? {} : { ip: caller.ip },
  })
  const principal = await gate.auth.authenticateToken(issued.token)
  // The session was issued for this account one statement ago; only a
  // concurrent revocation or account disable can make it fail to authenticate.
  if (principal === undefined || principal.kind !== 'user') return value<LoginVerifyResult>({ status: 'failed' })
  const user = await gate.auth.getUserByEmail(principal.email)
  if (user !== undefined) await announceSignIn(gate, user, history, device, caller)
  return {
    result: value<LoginVerifyResult>({ status: 'ok' }),
    setCookie: cookieOf(
      gate,
      joinCredential(issued.authSessionId, issued.token),
      // The browser's copy expires exactly when the provider's row does, so
      // one lifetime governs both sides instead of two that can disagree.
      Math.round((issued.expiresAt - Date.now()) / 1000),
    ),
  }
}

/** Serialize one cookie with this gate's configured name and `Secure` stance. */
function cookieOf(gate: GateContext, credential: string, maxAgeSeconds: number): string {
  return sessionCookie(gate.settings.cookieName, credential, gate.settings.cookieSecure, maxAgeSeconds)
}

/**
 * `logout` — end the session this request's cookie names.
 *
 * Only the account the cookie authenticates can reach the revocation, so the
 * session id the cookie carries cannot be swapped for another account's.
 * @param _payload - no payload; the cookie is the whole request.
 * @param caller - the request's headers, carrying the credential.
 * @param gate - the gate's dependencies.
 * @returns the reply, always clearing the cookie.
 */
export async function logout(
  _payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<ConnectionRpcReply> {
  const authenticated = await authenticatedRequest(caller.headers, gate)
  if (authenticated !== undefined) {
    await gate.auth.revokeSession(authenticated.authSessionId)
    await gate.auth.audit({ event: 'auth.logged-out', actorUserId: authenticated.principal.userId, subject: authenticated.authSessionId })
  }
  return { result: value<LogoutResult>({ status: 'ok' }), setCookie: cookieOf(gate, '', 0) }
}

/**
 * `logoutEverywhere` — end every session this account has. The operation a
 * compromise report calls, so it answers success whether or not the caller's
 * own cookie still worked.
 * @param _payload - no payload; the cookie is the whole request.
 * @param caller - the request's headers, carrying the credential.
 * @param gate - the gate's dependencies.
 * @returns the reply, always clearing the cookie.
 */
export async function logoutEverywhere(
  _payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<ConnectionRpcReply> {
  const authenticated = await authenticatedRequest(caller.headers, gate)
  if (authenticated !== undefined) {
    await gate.auth.revokeAllSessions(authenticated.principal.userId)
    await gate.auth.audit({ event: 'auth.logged-out-everywhere', actorUserId: authenticated.principal.userId })
  }
  return { result: value<LogoutResult>({ status: 'ok' }), setCookie: cookieOf(gate, '', 0) }
}

/**
 * `password.forgot` — mail a reset link to an address that has an account.
 *
 * The answer is the same either way, and so is the work an attacker can
 * observe: the provider's own per-address issuance limit decides whether a
 * link is sent, and its refusal is never reported.
 * @param payload - the submitted address.
 * @param _caller - unused; the request's client facts play no part.
 * @param gate - the gate's dependencies.
 * @returns the uniform acknowledgement.
 */
export async function passwordForgot(
  payload: unknown,
  _caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<PasswordForgotResult>> {
  const parsed = passwordForgotSchema.safeParse(payload)
  if (!parsed.success) return malformed('password.forgot', parsed.error.issues)
  const user = await gate.auth.getUserByEmail(parsed.data.email)
  if (user !== undefined) {
    try {
      const reset = await gate.auth.issueOneTimeToken('reset-password', user.userId, gate.settings.linkTtlMs)
      await deliver(
        gate,
        passwordResetMessage(user.email, link(gate, '/reset-password', { email: user.email, token: reset.secret }), gate.settings.linkTtlMs),
        'password reset',
      )
    } catch (error: unknown) {
      if (!(error instanceof AuthError && error.code === 'rate-limited')) throw error
      gate.warn('auth-gate: a password reset was refused by the provider rate limit')
    }
  }
  return value<PasswordForgotResult>({ status: 'ok' })
}

/**
 * `password.reset` — redeem a mailed link and set a new password.
 *
 * The address is part of the request because the notice this sends has to go
 * to the account's own stored address, which the seam offers no way to look up
 * from an account id. It is never trusted: the token decides whose password
 * changes, and a submitted address naming a different account refuses.
 * @param payload - the address, the mailed token, and the new password.
 * @param _caller - unused; the request's client facts play no part.
 * @param gate - the gate's dependencies.
 * @returns the reply, clearing the cookie because every session was revoked.
 */
export async function passwordReset(
  payload: unknown,
  _caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<PasswordResetResult> | ConnectionRpcReply> {
  const parsed = passwordResetSchema.safeParse(payload)
  if (!parsed.success) return malformed('password.reset', parsed.error.issues)
  const userId = await gate.auth.consumeOneTimeToken('reset-password', parsed.data.token)
  if (userId === undefined) return value<PasswordResetResult>({ status: 'failed' })
  const user = await gate.auth.getUserByEmail(parsed.data.email)
  if (user === undefined || user.userId !== userId) return value<PasswordResetResult>({ status: 'failed' })
  await gate.auth.setPassword(userId, parsed.data.password)
  // A reset is the response to a lost or stolen password, so every session it
  // could have been used to open ends with it.
  await gate.auth.revokeAllSessions(userId)
  await gate.auth.audit({ event: 'auth.password-reset', actorUserId: userId })
  await deliver(gate, passwordChangedMessage(user.email), 'password change notice')
  return { result: value<PasswordResetResult>({ status: 'ok' }), setCookie: cookieOf(gate, '', 0) }
}

/**
 * `email.verify` — redeem a mailed confirmation link.
 * @param payload - the mailed token.
 * @param _caller - unused; the request's client facts play no part.
 * @param gate - the gate's dependencies.
 * @returns whether the token redeemed.
 */
export async function emailVerify(
  payload: unknown,
  _caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<EmailVerifyResult>> {
  const parsed = emailVerifySchema.safeParse(payload)
  if (!parsed.success) return malformed('email.verify', parsed.error.issues)
  const userId = await gate.auth.consumeOneTimeToken('verify-email', parsed.data.token)
  if (userId === undefined) return value<EmailVerifyResult>({ status: 'failed' })
  await gate.auth.audit({ event: 'auth.email-verified', actorUserId: userId })
  return value<EmailVerifyResult>({ status: 'ok' })
}

/**
 * `me` — who this request's cookie authenticates.
 *
 * It reads no payload at all: the credential is the whole request, so there is
 * nothing a caller could send that would change the answer.
 * @param _payload - ignored.
 * @param caller - the request's headers, carrying the credential.
 * @param gate - the gate's dependencies.
 * @returns the account behind the cookie, or that there is none.
 */
export async function me(
  _payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
): Promise<RpcResult<MeResult>> {
  const authenticated = await authenticatedRequest(caller.headers, gate)
  if (authenticated === undefined) return value<MeResult>({ authenticated: false })
  const { principal } = authenticated
  return value<MeResult>({
    authenticated: true,
    email: principal.email,
    admin: principal.admin,
    groups: principal.groups,
  })
}

/** One endpoint of the `/auth` channel. */
export type EndpointHandler = (
  payload: unknown,
  caller: ConnectionRpcCaller,
  gate: GateContext,
) => Promise<RpcResult<unknown> | ConnectionRpcReply>

/**
 * The channel's complete endpoint set. An endpoint absent from this record is
 * not served, so a name reaches a handler only by being listed here.
 */
export const AUTH_ENDPOINTS: Readonly<Record<string, EndpointHandler>> = {
  'login.start': loginStart,
  'login.verify': loginVerify,
  'logout': logout,
  'logoutEverywhere': logoutEverywhere,
  'password.forgot': passwordForgot,
  'password.reset': passwordReset,
  'email.verify': emailVerify,
  'me': me,
}
