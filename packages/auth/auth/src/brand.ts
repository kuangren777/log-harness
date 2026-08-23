/**
 * dsh-auth's owned branded ids. Every one of them crosses a package boundary
 * as an opaque string — a provider writes it to durable storage, a Consumer
 * carries it on a `Principal`, and a transport surface may echo it back — so
 * the brand keeps a user id from being accepted where a group id is expected.
 *
 * The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; see that
 * package's README for the nominal-typing policy.
 *
 * @module @deepseek-ai/dsh-auth/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identity of one authenticated human account. */
export type UserId = Branded<'UserId'>

/**
 * Brand a user identifier.
 * @param id - the opaque user identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function UserId(id: string): UserId {
  return id as UserId
}

/** Durable identity of one permission group. */
export type GroupId = Branded<'GroupId'>

/**
 * Brand a group identifier.
 * @param id - the opaque group identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function GroupId(id: string): GroupId {
  return id as GroupId
}

/**
 * Durable identity of one login session — the row a bearer token authenticates
 * against. Distinct from `SessionId`, which identifies an agent conversation:
 * one logged-in user holds many agent sessions across several auth sessions.
 */
export type AuthSessionId = Branded<'AuthSessionId'>

/**
 * Brand an auth-session identifier.
 * @param id - the opaque auth-session identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function AuthSessionId(id: string): AuthSessionId {
  return id as AuthSessionId
}

/**
 * Durable identity of one issued single-use secret. The secret itself is never
 * stored, so a caller that must address the row later — a 2FA challenge
 * verifying an attempted code — addresses it by this id.
 */
export type OneTimeTokenId = Branded<'OneTimeTokenId'>

/**
 * Brand a one-time-token identifier.
 * @param id - the opaque one-time-token identifier.
 * @returns the same string, branded; no validation is performed.
 */
export function OneTimeTokenId(id: string): OneTimeTokenId {
  return id as OneTimeTokenId
}

/**
 * The builtin administrator group's fixed id. Membership in it is what makes a
 * {@link UserId} an admin, so the id cannot be provider-generated: a provider
 * materializing a fresh database must reach the same group as one opening a
 * database another build created.
 */
export const ADMIN_GROUP_ID: GroupId = GroupId('admin')

/** The builtin administrator group's fixed name; renaming and deleting it are both refused. */
export const ADMIN_GROUP_NAME = 'admin'
