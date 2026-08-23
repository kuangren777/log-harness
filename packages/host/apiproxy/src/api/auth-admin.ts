/**
 * auth.admin domain contract: the administration plane of the auth capability
 * seam (`ctx.auth`) — accounts, groups, memberships, and permission rules.
 *
 * Every method here is an `admin` policy row, and none of them reads or writes
 * a secret: a password only ever travels INTO `users.create`, and no response
 * carries a hash, a token, or a code. Groups are read whole (members and rules
 * with the group) because an administration surface renders them together and
 * a per-group round trip would let the three views disagree.
 */

import type { GroupId, PermissionDomain, UserId } from '@deepseek-ai/dsh-auth/types'
import type { AuthorizedRequest, RpcResponse } from './rpc.ts'

/** Wire view of one account, without anything that could authenticate as it. */
export interface AdminUserView {
  /** The account's durable identity. */
  userId: UserId
  /** The account's e-mail address, as stored. */
  email: string
  /** Whether the address has been confirmed. */
  emailVerified: boolean
  /** Whether the account is blocked from authenticating. */
  disabled: boolean
  /** When the account was created, in epoch milliseconds. */
  createdAt: number
}

/** Wire view of one permission rule. */
export interface AdminRuleView {
  /** The namespace this rule addresses. */
  domain: PermissionDomain
  /** Exact name, or a prefix ending in `*`. */
  pattern: string
  /** Whether a match grants or refuses access. */
  effect: 'allow' | 'deny'
}

/** Wire view of one group, with the membership and rules that make it mean something. */
export interface AdminGroupView {
  /** The group's durable identity. */
  groupId: GroupId
  /** The group's unique name. */
  name: string
  /** Whether the group ships with the schema; a builtin group refuses rename and delete. */
  builtin: boolean
  /** When the group was created, in epoch milliseconds. */
  createdAt: number
  /** Every account in the group. */
  members: UserId[]
  /** Every rule the group carries. */
  rules: AdminRuleView[]
}

/**
 * Administration-plane unary methods (the map keys `auth.admin.*` of
 * RpcMethodMap). A seam refusal — a duplicate address, a builtin group, an
 * unknown id — answers `auth-rejected` carrying the seam's own `AuthErrorCode`,
 * so a form can tell a name collision from a missing row without matching
 * message text.
 */
export interface AuthAdminApi {
  /**
   * Every account. Unpaged and unfiltered: the roster is the administration
   * surface's whole subject, and a page cursor would be state to keep for a
   * list that fits on one screen in the deployments this seam serves.
   */
  listUsers(request: AuthorizedRequest<{}>): Promise<RpcResponse<{ users: AdminUserView[] }>>

  /**
   * Register an account with an initial password. The password is hashed by
   * the seam and never returned; delivering it to its owner is the
   * administrator's problem, not this method's.
   */
  createUser(request: AuthorizedRequest<{ email: string; password: string }>): Promise<RpcResponse<{ userId: UserId }>>

  /**
   * Block or restore one account. `disabled: false` restores, because a
   * one-way block would make a misclick a database repair. Live login sessions
   * are untouched — ending them is a separate decision the seam exposes
   * separately.
   */
  disableUser(request: AuthorizedRequest<{ userId: UserId; disabled: boolean }>): Promise<RpcResponse<{}>>

  /** Every group with its membership and its rules. */
  listGroups(request: AuthorizedRequest<{}>): Promise<RpcResponse<{ groups: AdminGroupView[] }>>

  /** Create an empty permission group. */
  createGroup(request: AuthorizedRequest<{ name: string }>): Promise<RpcResponse<{ groupId: GroupId }>>

  /** Delete a group with its memberships and rules; a builtin group is refused. */
  deleteGroup(request: AuthorizedRequest<{ groupId: GroupId }>): Promise<RpcResponse<{}>>

  /** Rename a group; a builtin group is refused. */
  renameGroup(request: AuthorizedRequest<{ groupId: GroupId; name: string }>): Promise<RpcResponse<{}>>

  /**
   * Replace a group's membership with exactly `userIds`.
   *
   * Accounts that were not members before the call are mailed a notice through
   * the mounted request gate, and only those: a save that reorders or removes
   * members must not re-mail the ones who stayed. The response reports which
   * accounts were newly added, so a surface can say what the save did without
   * diffing the roster itself. A deployment whose gate cannot mail still
   * changes the membership — the mailing is a notice, not the commit.
   */
  setMembers(request: AuthorizedRequest<{ groupId: GroupId; userIds: UserId[] }>): Promise<RpcResponse<{ added: UserId[] }>>

  /** Replace a group's rules with exactly `rules`. */
  setRules(request: AuthorizedRequest<{ groupId: GroupId; rules: AdminRuleView[] }>): Promise<RpcResponse<{}>>
}
