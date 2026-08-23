/**
 * Types-only vocabulary of the auth capability seam: who is acting, what a
 * permission rule says, and the records a provider returns.
 * @module @deepseek-ai/dsh-auth/types
 */

import type { AuthSessionId, GroupId, OneTimeTokenId, UserId } from './brand.ts'

/**
 * Who is acting. Two kinds, because a deployment either has accounts or does not.
 *
 * `user` is one authenticated account: its `groups` are the groups whose rules
 * apply, and `admin` restates membership in the builtin administrator group so
 * a Consumer does not have to know that group's id to make the bypass check.
 *
 * `local` is the in-process principal used by the CLI, the ACP server, tests,
 * and every other single-tenant entry point. It carries full rights, which is
 * what makes the capability opt-in: a deployment that never mounts an auth
 * provider resolves every request to `local` and behaves exactly as it did
 * before the seam existed. It is not a fallback for a failed login — a request
 * whose credentials do not authenticate is rejected, never downgraded to `local`.
 */
export type Principal =
  | {
    readonly kind: 'user'
    /** The authenticated account. */
    readonly userId: UserId
    /** The account's e-mail address, as stored. */
    readonly email: string
    /** Every group the account belongs to; rule evaluation unions their rules. */
    readonly groups: readonly GroupId[]
    /** Whether `groups` contains the builtin administrator group. */
    readonly admin: boolean
  }
  | {
    readonly kind: 'local'
  }

/**
 * The namespaces a permission rule can address. Each names a resource the
 * product already addresses by string: a registered skill name, a tool name, a
 * `provider/model` route, or a settings namespace.
 */
export type PermissionDomain = 'skill' | 'tool' | 'model' | 'settings-section'

/** One rule: what it addresses, which names it covers, and whether it grants or refuses. */
export interface PermissionRule {
  /** The namespace this rule addresses. */
  readonly domain: PermissionDomain
  /** Exact name, or a prefix ending in `*`. */
  readonly pattern: string
  /** Whether a match grants or refuses access. */
  readonly effect: 'allow' | 'deny'
}

/** One stored account, without its password hash. */
export interface UserRecord {
  /** The account's durable identity. */
  readonly userId: UserId
  /** The account's e-mail address, as stored (comparison is case-insensitive). */
  readonly email: string
  /** When the address was confirmed, or `undefined` while unconfirmed. */
  readonly emailVerifiedAt: number | undefined
  /** When the account was disabled, or `undefined` while active. */
  readonly disabledAt: number | undefined
  /** When the account was created. */
  readonly createdAt: number
}

/** One stored permission group. */
export interface GroupRecord {
  /** The group's durable identity. */
  readonly groupId: GroupId
  /** The group's unique name. */
  readonly name: string
  /** Whether the group ships with the schema; a builtin group refuses rename and delete. */
  readonly builtin: boolean
  /** When the group was created. */
  readonly createdAt: number
}

/** Request-side facts recorded with a login session, for the user's own session list. */
export interface AuthSessionMeta {
  /** Client address the session was issued to, when the caller knows one. */
  readonly ip?: string
  /** Client user-agent string the session was issued to, when the caller knows one. */
  readonly userAgent?: string
}

/** One issued login session: the bearer secret and when it stops working. */
export interface IssuedAuthSession {
  /** The session row's durable identity. */
  readonly authSessionId: AuthSessionId
  /** The bearer token, returned exactly once; only its digest is stored. */
  readonly token: string
  /** Epoch milliseconds after which the token no longer authenticates. */
  readonly expiresAt: number
}

/** What a single-use secret is for. */
export type OneTimeTokenKind = '2fa' | 'verify-email' | 'reset-password'

/** One issued single-use secret. */
export interface IssuedOneTimeToken {
  /** The row's durable identity, used to address a `2fa` challenge on verification. */
  readonly oneTimeTokenId: OneTimeTokenId
  /**
   * The secret, returned exactly once: a six-digit numeric code for `2fa`, a
   * base64url token for the link kinds. Only its digest is stored.
   */
  readonly secret: string
  /** Epoch milliseconds after which the secret no longer verifies. */
  readonly expiresAt: number
}

/**
 * The result of a password check. A failure never states why: the same value
 * comes back for an unknown address, a wrong password, and a disabled account,
 * so a caller cannot use the login form to enumerate accounts.
 *
 * `lockedUntil` is the one exception, and it leaks nothing: attempts are
 * counted against the submitted address whether or not an account has it, so a
 * lockout says only that this address was tried too often.
 */
export type LoginOutcome =
  | {
    readonly ok: true
    /** The authenticated account. */
    readonly userId: UserId
  }
  | {
    readonly ok: false
    /** Epoch milliseconds until which further attempts are refused, or `undefined` when none is in force. */
    readonly lockedUntil: number | undefined
  }

/** One audit record, as written by a caller. */
export interface AuditEntry {
  /** Stable event name, such as `auth.login-succeeded`. */
  readonly event: string
  /** The account that performed the action, when one is known. */
  readonly actorUserId?: UserId
  /** The entity the action addressed, such as a group or session id. */
  readonly subject?: string
  /** Non-secret supporting detail; never a password, code, or bearer token. */
  readonly detail?: string
  /** Client address the action arrived from, when the caller knows one. */
  readonly ip?: string
}

/** One audit record, as read back. */
export interface AuditRecord extends AuditEntry {
  /** The record's durable identity. */
  readonly auditId: string
  /** When the record was written. */
  readonly ts: number
}
