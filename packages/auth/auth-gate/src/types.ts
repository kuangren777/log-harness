/**
 * Wire vocabulary of the `/auth` channel: what a browser sends to each
 * endpoint and what it gets back. Types only — no runtime code.
 *
 * Every failure answer is deliberately shapeless. `failed` never says whether
 * the address exists, whether the password was wrong, whether the account is
 * disabled, or whether a code expired, because each of those distinctions
 * turns the sign-in form into an account oracle.
 * @module @deepseek-ai/dsh-auth-gate/types
 */

import type { GroupId, OneTimeTokenId } from '@deepseek-ai/dsh-auth'

/** `login.start` — the credentials a sign-in attempt submits. */
export interface LoginStartPayload {
  /** The submitted e-mail address. */
  email: string
  /** The submitted password. */
  password: string
}

/** `login.start` — either a second factor is now in the caller's mailbox, or nothing happened. */
export type LoginStartResult =
  | {
    status: '2fa-required'
    /** Addresses the challenge to verify against; not a credential on its own. */
    pendingId: OneTimeTokenId
  }
  | {
    status: 'failed'
    /** Present only when a rate limit is in force, in milliseconds; it says a limit was hit, never why. */
    retryAfterMs?: number
  }

/** `login.verify` — the challenge and the code that answers it. */
export interface LoginVerifyPayload {
  /** The challenge id `login.start` returned. */
  pendingId: string
  /** The six-digit code delivered by mail. */
  code: string
}

/** `login.verify` — success installs the session cookie; failure says nothing more. */
export type LoginVerifyResult = { status: 'ok' } | { status: 'failed' }

/** `logout` and `logoutEverywhere` — always succeed, so no caller can probe a session's existence. */
export interface LogoutResult {
  status: 'ok'
}

/** `password.forgot` — the address to send a reset link to. */
export interface PasswordForgotPayload {
  /** The submitted e-mail address. */
  email: string
}

/** `password.forgot` — the same answer whether or not the address has an account. */
export interface PasswordForgotResult {
  status: 'ok'
}

/** `password.reset` — the mailed token and the new password. */
export interface PasswordResetPayload {
  /** The token from the reset link. */
  token: string
  /** The new password. */
  password: string
}

/** `password.reset` — failure means the token did not redeem, which the token's holder already can tell. */
export type PasswordResetResult = { status: 'ok' } | { status: 'failed' }

/** `email.verify` — the token from a confirmation link. */
export interface EmailVerifyPayload {
  /** The token from the confirmation link. */
  token: string
}

/** `email.verify` — failure means the token did not redeem. */
export type EmailVerifyResult = { status: 'ok' } | { status: 'failed' }

/** `me` — who the request's cookie authenticates, for a client deciding what to render. */
export type MeResult =
  | { authenticated: false }
  | {
    authenticated: true
    /** The account's e-mail address, as stored. */
    email: string
    /** Whether the account is in the builtin administrator group. */
    admin: boolean
    /** Every group the account belongs to. */
    groups: readonly GroupId[]
  }
