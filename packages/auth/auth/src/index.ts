/**
 * Service Definition for the authentication and authorization capability seam
 * (`ctx.auth`). The seam owns three questions a multi-user deployment has to
 * answer and a single-tenant one never asks: who is this request, what may
 * they reach, and who owns this durable object.
 *
 * The vocabulary is deliberately usable without a provider. {@link Principal}
 * has a `local` kind carrying full rights, and {@link permits} bypasses rule
 * evaluation for it, so every Consumer can be written against the seam while a
 * deployment that never mounts a provider behaves exactly as it did before.
 * Password hashing, token minting, and rule evaluation are pure functions
 * exported here rather than provider methods, because they are the parts a
 * second provider must not be free to reimplement differently.
 * @module @deepseek-ai/dsh-auth
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { AuthSessionId, GroupId, OneTimeTokenId, UserId } from './brand.ts'
import type {
  AuditEntry,
  AuditRecord,
  AuthSessionMeta,
  GroupRecord,
  IssuedAuthSession,
  IssuedOneTimeToken,
  LoginOutcome,
  OneTimeTokenKind,
  PermissionDomain,
  PermissionRule,
  Principal,
  UserRecord,
} from './types.ts'

export {
  ADMIN_GROUP_ID,
  ADMIN_GROUP_NAME,
  AuthSessionId,
  GroupId,
  OneTimeTokenId,
  UserId,
} from './brand.ts'
export { AuthError } from './error.ts'
export type { AuthErrorCode } from './error.ts'
export {
  hashPassword,
  isPasswordHash,
  verifyPassword,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_COST,
  SCRYPT_HASH_BYTES,
  SCRYPT_PARALLELIZATION,
  SCRYPT_SALT_BYTES,
} from './password.ts'
import { permits } from './rbac.ts'

export { evaluate, governs, matchesPattern, permits } from './rbac.ts'
export {
  digestOf,
  digestOfCode,
  mintCode,
  mintToken,
  sameDigest,
  CODE_DIGITS,
  CODE_SALT_BYTES,
  TOKEN_BYTES,
} from './token.ts'
export type { MintedCode, MintedToken } from './token.ts'
export type {
  AuditEntry,
  AuditRecord,
  AuthSessionMeta,
  GroupRecord,
  IssuedAuthSession,
  IssuedOneTimeToken,
  LoginOutcome,
  OneTimeTokenKind,
  PermissionDomain,
  PermissionRule,
  Principal,
  UserRecord,
} from './types.ts'

/** The principal every entry point resolves to while no auth provider is mounted. */
export const LOCAL_PRINCIPAL: Principal = { kind: 'local' }

declare module '@deepseek-ai/cordis' {
  interface Context {
    auth: AuthService
  }
}

/**
 * Abstract authentication and authorization service.
 *
 * Every method is asynchronous because a provider owns durable storage, and
 * every credential-checking method answers with a value rather than an error:
 * {@link verifyLogin} returns an outcome, {@link authenticateToken} and the
 * one-time-token methods return `undefined`. A failed check is an expected
 * result, and giving it a distinct failure shape would let a caller tell an
 * unknown account from a wrong password. Deliberate refusals — a duplicate
 * address, a builtin group, a rate limit — throw `AuthError` with a code.
 *
 * Security limits are the provider's, not the caller's: rate limiting,
 * lockout, and attempt caps live inside these methods so that no call site can
 * omit them.
 */
export abstract class AuthService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'auth')
  }

  /**
   * Register an account. The address is stored as given and compared
   * case-insensitively, so one address cannot be registered twice in different
   * cases. The password is hashed before storage and never retained.
   * @param email - the account's e-mail address.
   * @param password - the plaintext password.
   * @returns the new account's id.
   * @throws AuthError `duplicate-email` when the address is already registered.
   */
  abstract createUser(email: string, password: string): Promise<UserId>

  /**
   * Look one account up by address, case-insensitively. The password hash is
   * never part of the result.
   * @param email - the address to look up.
   * @returns the account, or `undefined` when no account has that address.
   */
  abstract getUserByEmail(email: string): Promise<UserRecord | undefined>

  /**
   * Every account, without password hashes — the administration roster.
   * There is no filter or page: the deployments this seam serves administer a
   * team, and a roster small enough to render is small enough to return.
   * @returns the accounts, oldest first.
   */
  abstract listUsers(): Promise<readonly UserRecord[]>

  /**
   * Disable or restore one account. A disabled account fails
   * {@link verifyLogin} and stops authenticating, but its rows stay, so its
   * sessions, ownership, and audit history survive the block. Restoring is
   * the same operation with `false`: the alternative would make a mistaken
   * disable a database repair.
   *
   * Live login sessions are NOT revoked here. Revocation is
   * {@link revokeAllSessions}, and a caller that means to end an account's
   * access now calls both; keeping them separate is what lets an
   * administrator disable an account without deciding its sessions' fate in
   * the same click.
   * @param userId - the account to update.
   * @param disabled - whether the account is blocked from authenticating.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  abstract setUserDisabled(userId: UserId, disabled: boolean): Promise<void>

  /**
   * Resolve one account to its principal, without a credential.
   *
   * {@link authenticateToken} answers the same question for a request that
   * presents a token. This answers it for a Consumer that already knows the
   * account — the owner of an agent session — and therefore has no token to
   * present. Rule evaluation needs the whole principal, not just the id: the
   * administrator bypass in {@link permits} reads `admin`, and a Consumer that
   * reconstructed it from a group list would be free to get it wrong.
   * @param userId - the account to resolve.
   * @returns the principal, or `undefined` when the account is unknown or disabled.
   */
  abstract principalOf(userId: UserId): Promise<Principal | undefined>

  /**
   * Replace an account's password. Existing login sessions are unaffected;
   * revoke them separately when the change is a response to a compromise.
   * @param userId - the account to update.
   * @param password - the new plaintext password.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  abstract setPassword(userId: UserId, password: string): Promise<void>

  /**
   * Check a password, enforcing this seam's fixed attempt limits and lockout.
   *
   * Failure never states why. The same outcome comes back for an unknown
   * address, a wrong password, and a disabled account, and a failed attempt
   * costs the same work whether or not an account exists, so the login form
   * cannot be used to enumerate accounts. Attempts are counted durably against
   * both the submitted address and the client address, so a restart does not
   * reset a lockout.
   * @param email - the submitted address.
   * @param password - the submitted password.
   * @param ip - the client address, when the caller knows one; without it only the per-address limit applies.
   * @returns the account on success, otherwise a failure carrying any lockout deadline.
   */
  abstract verifyLogin(email: string, password: string, ip?: string): Promise<LoginOutcome>

  /**
   * Issue a login session and its bearer token. The token is returned once;
   * storage holds only its digest, so the row cannot be replayed as a
   * credential by whoever reads the database.
   * @param userId - the account to issue for.
   * @param meta - client facts recorded for the user's own session list.
   * @returns the session id, the bearer token, and its expiry.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  abstract issueAuthSession(userId: UserId, meta: AuthSessionMeta): Promise<IssuedAuthSession>

  /**
   * Resolve a bearer token to its principal, refreshing the session's
   * last-seen time. Expiry, revocation, and a disabled account all answer
   * `undefined`, indistinguishably from an unknown token.
   * @param token - the presented bearer token.
   * @returns the authenticated principal, or `undefined` when the token does not authenticate.
   */
  abstract authenticateToken(token: string): Promise<Principal | undefined>

  /**
   * Revoke one login session. Revoking an unknown or already-revoked session
   * is a no-op: the caller's intent is satisfied either way.
   * @param authSessionId - the session to revoke.
   */
  abstract revokeSession(authSessionId: AuthSessionId): Promise<void>

  /**
   * Revoke every live login session for one account — the operation a password
   * change or a compromise report calls.
   * @param userId - the account whose sessions to revoke.
   */
  abstract revokeAllSessions(userId: UserId): Promise<void>

  /**
   * Issue a single-use secret: a six-digit code for `2fa`, a bearer-strength
   * token for the link kinds. The secret is returned once and stored only as a
   * digest. Issuance is rate limited per account and, for `reset-password`,
   * per address.
   * @param kind - what the secret is for.
   * @param userId - the account it belongs to.
   * @param ttlMs - how long it stays valid, in milliseconds.
   * @returns the row id, the secret, and its expiry.
   * @throws AuthError `unknown-subject` when no such account exists, or `rate-limited` when issuance is too frequent.
   */
  abstract issueOneTimeToken(
    kind: OneTimeTokenKind,
    userId: UserId,
    ttlMs: number,
  ): Promise<IssuedOneTimeToken>

  /**
   * Redeem a link-kind secret. Redemption is single-use and atomic: two
   * concurrent presentations of one token resolve at most one of them.
   * Expired, already-consumed, and unknown tokens are indistinguishable.
   *
   * Redeeming a `verify-email` secret also confirms the account's address, in
   * the same durable operation. That is the contract, not an incidental effect
   * of consumption: the two are one fact, and moving the confirmation to a
   * separate setter would let a crash spend the single-use link without
   * recording what it proved — an account stuck unverified with no secret left
   * to prove it — and would leave a second route that spends the link and
   * records nothing. A repeat confirmation keeps the first one's timestamp, so
   * {@link UserRecord.emailVerifiedAt} is when the address was first proven.
   * @param kind - the kind the secret must have been issued for.
   * @param token - the presented secret.
   * @returns the account the secret belonged to, or `undefined` when it does not redeem.
   */
  abstract consumeOneTimeToken(kind: OneTimeTokenKind, token: string): Promise<UserId | undefined>

  /**
   * Verify a `2fa` code against one issued challenge. A wrong code counts an
   * attempt; reaching the fixed cap kills the challenge outright rather than
   * leaving it open for the rest of its lifetime, so a six-digit secret cannot
   * be ground down. Success consumes the challenge.
   * @param oneTimeTokenId - the challenge to verify against.
   * @param code - the presented code.
   * @returns the account the challenge belonged to, or `undefined` when it does not verify.
   */
  abstract verifyTotpCode(oneTimeTokenId: OneTimeTokenId, code: string): Promise<UserId | undefined>

  /**
   * Every group, builtin ones included.
   * @returns the groups, ordered by creation time.
   */
  abstract listGroups(): Promise<readonly GroupRecord[]>

  /**
   * Create a permission group.
   * @param name - the group's unique name.
   * @returns the new group's id.
   * @throws AuthError `duplicate-group-name` when a group already has that name.
   */
  abstract createGroup(name: string): Promise<GroupId>

  /**
   * Delete a group, along with its memberships and rules. A builtin group is
   * refused: the administrator group is what makes an administrator, so
   * deleting it could leave a deployment with no one able to restore it.
   * @param groupId - the group to delete.
   * @throws AuthError `builtin-group` for a builtin group, `unknown-subject` when no such group exists.
   */
  abstract deleteGroup(groupId: GroupId): Promise<void>

  /**
   * Rename a group. A builtin group is refused, for the same reason its
   * deletion is: its name is part of the schema.
   * @param groupId - the group to rename.
   * @param name - the new unique name.
   * @throws AuthError `builtin-group` for a builtin group, `unknown-subject` when no such group exists.
   */
  abstract renameGroup(groupId: GroupId, name: string): Promise<void>

  /**
   * Replace a group's membership wholesale. Passing the complete set rather
   * than adding and removing one at a time is what lets an administration UI
   * save a membership editor without a read-modify-write race.
   * @param groupId - the group to update.
   * @param userIds - the complete membership after the call.
   * @throws AuthError `unknown-subject` when the group or any listed account does not exist.
   */
  abstract setMembers(groupId: GroupId, userIds: readonly UserId[]): Promise<void>

  /**
   * One group's membership.
   * @param groupId - the group to read.
   * @returns the member accounts; an unknown group has no members.
   */
  abstract listMembers(groupId: GroupId): Promise<readonly UserId[]>

  /**
   * Replace a group's rules wholesale, for the same reason {@link setMembers}
   * replaces membership wholesale.
   * @param groupId - the group to update.
   * @param rules - the complete rule set after the call.
   * @throws AuthError `unknown-subject` when no such group exists.
   */
  abstract setRules(groupId: GroupId, rules: readonly PermissionRule[]): Promise<void>

  /**
   * One group's rules.
   * @param groupId - the group to read.
   * @returns the group's rules; an unknown group has none.
   */
  abstract listRules(groupId: GroupId): Promise<readonly PermissionRule[]>

  /**
   * Every rule that applies to one account: the union of its groups' rules.
   * The union is safe to take without ordering because {@link evaluate}'s
   * precedence is order-independent — one deny refuses regardless of which
   * group contributed it.
   * @param userId - the account to collect rules for.
   * @returns the applicable rules; an unknown account has none.
   */
  abstract rulesFor(userId: UserId): Promise<readonly PermissionRule[]>

  /**
   * Record which account owns one agent session. Ownership lives here rather
   * than in the session log because it is an access-control fact about the
   * deployment, not a model-visible fact about the conversation.
   * @param sessionId - the agent session.
   * @param userId - the owning account.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  abstract recordSessionOwner(sessionId: SessionId, userId: UserId): Promise<void>

  /**
   * Who owns one agent session.
   * @param sessionId - the agent session.
   * @returns the owning account, or `undefined` for a session recorded before auth was mounted.
   */
  abstract ownerOfSession(sessionId: SessionId): Promise<UserId | undefined>

  /**
   * Every agent session one account owns.
   * @param userId - the owning account.
   * @returns the owned session ids, most recently recorded first.
   */
  abstract listOwnedSessions(userId: UserId): Promise<readonly SessionId[]>

  /**
   * Record which account owns one workspace; the workspace twin of
   * {@link recordSessionOwner}.
   * @param workspaceId - the workspace.
   * @param userId - the owning account.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  abstract recordWorkspaceOwner(workspaceId: WorkspaceId, userId: UserId): Promise<void>

  /**
   * Who owns one workspace.
   * @param workspaceId - the workspace.
   * @returns the owning account, or `undefined` for a workspace recorded before auth was mounted.
   */
  abstract ownerOfWorkspace(workspaceId: WorkspaceId): Promise<UserId | undefined>

  /**
   * Every workspace one account owns.
   * @param userId - the owning account.
   * @returns the owned workspace ids, most recently recorded first.
   */
  abstract listOwnedWorkspaces(userId: UserId): Promise<readonly WorkspaceId[]>

  /**
   * Append one audit record. Providers also write their own records for the
   * security events they own, so a caller adds only what it alone knows.
   * @param entry - the record; it must not carry a password, code, or token.
   */
  abstract audit(entry: AuditEntry): Promise<void>

  /**
   * Read the most recent audit records. Without a read path the log would be
   * unverifiable — neither an administration view nor this seam's own
   * no-secrets test could confirm what was written.
   * @param limit - how many records to return, most recent first; a timestamp tie keeps insertion order.
   * @returns the records.
   */
  abstract readAudit(limit: number): Promise<readonly AuditRecord[]>
}

/**
 * Decide one name in one domain on behalf of some principal, with the rules
 * that principal carries already resolved. Consumers that check many names —
 * a skill catalog, a tool restriction — hold one of these instead of querying
 * per name.
 * @param domain - the namespace being addressed.
 * @param name - the name being checked.
 * @returns whether access is granted.
 */
export type PermissionCheck = (domain: PermissionDomain, name: string) => boolean

/**
 * The check for an object no rule set governs: a deployment with no auth
 * provider, or a durable object recorded before one was mounted.
 */
export const PERMITS_EVERYTHING: PermissionCheck = () => true

/**
 * The check for an owner that exists but cannot act: a deleted or disabled
 * account. Refusing everything is the only safe reading — the owner is known
 * to be governed, and the rules that would govern them are unavailable.
 */
export const PERMITS_NOTHING: PermissionCheck = () => false

/**
 * The permission check that governs one agent session, resolved from its
 * recorded owner.
 *
 * This is the non-request path into rule evaluation. A gateway request carries
 * its {@link Principal}; a session running its own turns does not, and the
 * account it belongs to is the ownership row {@link AuthService.ownerOfSession}
 * holds. Both the model-facing skill catalog and the per-agent tool
 * restriction ask this question, so resolving it once here keeps them from
 * answering it two different ways.
 *
 * A session with no recorded owner is UNGOVERNED and grants everything: it was
 * created before the deployment mounted authentication, and taking its
 * capabilities away would break a conversation nobody chose to restrict. An
 * owner that no longer resolves grants nothing.
 * @param auth - the mounted auth provider.
 * @param sessionId - the agent session whose owner decides.
 * @returns the check to apply to that session's names.
 */
export async function checkForSessionOwner(auth: AuthService, sessionId: SessionId): Promise<PermissionCheck> {
  const owner = await auth.ownerOfSession(sessionId)
  if (owner === undefined) return PERMITS_EVERYTHING
  const principal = await auth.principalOf(owner)
  if (principal === undefined) return PERMITS_NOTHING
  const rules = await auth.rulesFor(owner)
  return (domain, name) => permits(principal, rules, domain, name)
}

export default AuthService
