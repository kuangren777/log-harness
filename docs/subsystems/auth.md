# Authentication and Authorization

English | [中文](auth.zh.md)

[`dsh-auth`](../../packages/auth/auth) owns the identity and permission vocabulary that a multi-user deployment answers three questions with: who is this request, what may they reach, and who owns this durable object. [`dsh-host-apiproxy`](../../packages/host/apiproxy)'s `authorization` module owns the transport-facing half, the request gate that turns one request's credentials into a `Principal` before the gateway dispatches it. The seam stores accounts, groups, and rules and decides what a principal may do; the gate resolves who a request is before that decision runs. [`dsh-auth-sqlite`](../../packages/auth/auth-sqlite) is the mounted `AuthService` provider; neither package composes into a shipped deployment by default, so the capability is opt-in.

Source: [`packages/auth/auth/src/index.ts`](../../packages/auth/auth/src/index.ts)

Source: [`packages/host/apiproxy/src/authorization.ts`](../../packages/host/apiproxy/src/authorization.ts)

## Principal

`Principal` is either an authenticated `user` or `local`. `local` is the principal every entry point resolves to while no auth provider is mounted — the CLI, the ACP server, in-process tests, and any composition that never loads `dsh-auth-sqlite`. It carries full rights, which is what keeps the capability optional: a deployment that never mounts a provider behaves exactly as it did before this seam existed, and `local` is never a fallback for a failed login — a request whose credentials do not authenticate is rejected, never downgraded to `local`.

```ts type-equiv
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
type Principal =
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
```

`UserId`, `GroupId`, `AuthSessionId`, and `OneTimeTokenId` are [branded ids](core.md#branded-ids).

```ts type-equiv
/** Durable identity of one authenticated human account. */
type UserId = Branded<'UserId'>
```

```ts type-equiv
/** Durable identity of one permission group. */
type GroupId = Branded<'GroupId'>
```

```ts type-equiv
/**
 * Durable identity of one login session — the row a bearer token authenticates
 * against. Distinct from `SessionId`, which identifies an agent conversation:
 * one logged-in user holds many agent sessions across several auth sessions.
 */
type AuthSessionId = Branded<'AuthSessionId'>
```

```ts type-equiv
/**
 * Durable identity of one issued single-use secret. The secret itself is never
 * stored, so a caller that must address the row later — a 2FA challenge
 * verifying an attempted code — addresses it by this id.
 */
type OneTimeTokenId = Branded<'OneTimeTokenId'>
```

## Permission rules

A rule addresses one of four namespaces the product already names by string: a registered skill name, a tool name, a `provider/model` route, or a settings namespace. `pattern` is an exact name or a prefix ending in `*`. Evaluation is **deny > allow > default-deny**: a matching `deny` settles the question outright, a matching `allow` grants it, and a name no rule mentions is refused — a skill, tool, model, or settings section added later is therefore safe on arrival rather than exposed until someone remembers to forbid it. Rules are flat and unioned across every group a principal belongs to; because deny always wins, the union needs no ordering between groups. [`dsh-auth`](../../packages/auth/auth/README.md) documents the exact `evaluate`/`permits` contracts, including how `local` and `admin: true` principals bypass evaluation entirely.

```ts type-equiv
/**
 * The namespaces a permission rule can address. Each names a resource the
 * product already addresses by string: a registered skill name, a tool name, a
 * `provider/model` route, or a settings namespace.
 */
type PermissionDomain = 'skill' | 'tool' | 'model' | 'settings-section'
```

```ts type-equiv
/** One rule: what it addresses, which names it covers, and whether it grants or refuses. */
interface PermissionRule {
  /** The namespace this rule addresses. */
  readonly domain: PermissionDomain
  /** Exact name, or a prefix ending in `*`. */
  readonly pattern: string
  /** Whether a match grants or refuses access. */
  readonly effect: 'allow' | 'deny'
}
```

## Accounts, login, and one-time secrets

Passwords are hashed with node:crypto **scrypt** before storage and never retained in plaintext; [`dsh-auth`](../../packages/auth/auth/README.md) documents the exact parameters and encoding. A login session's bearer token and a one-time secret's code or link token are each returned to the caller exactly once — storage keeps only a digest, so reading the database back yields nothing replayable. `verifyLogin` enforces this seam's fixed attempt limits and lockout durably, and a failure never states why: the same outcome comes back for an unknown address, a wrong password, and a disabled account.

```ts type-equiv
/** One stored account, without its password hash. */
interface UserRecord {
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
```

```ts type-equiv
/**
 * The result of a password check. A failure never states why: the same value
 * comes back for an unknown address, a wrong password, and a disabled account,
 * so a caller cannot use the login form to enumerate accounts.
 *
 * `lockedUntil` is the one exception, and it leaks nothing: attempts are
 * counted against the submitted address whether or not an account has it, so a
 * lockout says only that this address was tried too often.
 */
type LoginOutcome =
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
```

```ts type-equiv
/** Request-side facts recorded with a login session, for the user's own session list. */
interface AuthSessionMeta {
  /** Client address the session was issued to, when the caller knows one. */
  readonly ip?: string
  /** Client user-agent string the session was issued to, when the caller knows one. */
  readonly userAgent?: string
}
```

```ts type-equiv
/** One issued login session: the bearer secret and when it stops working. */
interface IssuedAuthSession {
  /** The session row's durable identity. */
  readonly authSessionId: AuthSessionId
  /** The bearer token, returned exactly once; only its digest is stored. */
  readonly token: string
  /** Epoch milliseconds after which the token no longer authenticates. */
  readonly expiresAt: number
}
```

```ts type-equiv
/** What a single-use secret is for. */
type OneTimeTokenKind = '2fa' | 'verify-email' | 'reset-password'
```

```ts type-equiv
/** One issued single-use secret. */
interface IssuedOneTimeToken {
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
```

## Groups

A group is either builtin (the administrator group, `ADMIN_GROUP_ID`) or created by an administrator; a builtin group refuses rename and delete because its name and id are part of the schema. Membership and rules are each replaced wholesale (`setMembers`, `setRules`) rather than mutated one entry at a time, so an administration UI can save a membership or rule editor without a read-modify-write race.

```ts type-equiv
/** One stored permission group. */
interface GroupRecord {
  /** The group's durable identity. */
  readonly groupId: GroupId
  /** The group's unique name. */
  readonly name: string
  /** Whether the group ships with the schema; a builtin group refuses rename and delete. */
  readonly builtin: boolean
  /** When the group was created. */
  readonly createdAt: number
}
```

## Session and workspace ownership

`ctx.auth` records which account created each agent [session](session.md) and each [workspace](workspace.md) in the auth database itself, not in the session log: ownership is an access-control fact about the deployment, not a model-visible fact about the conversation, and keeping it beside the accounts it references means deleting the auth database removes the whole multi-user layer cleanly. A resource recorded before a deployment ever mounted `dsh-auth-sqlite` has no owner; the request gate below treats an unowned resource as belonging to nobody but an administrator. See [the auth capability design note](../../.agents/notes/implemented/architecture/2026-08-23-auth-capability-design.md) for the full rationale.

## Audit

`audit` appends one record; `readAudit` reads the most recent ones back, most recent first. A caller writes only the facts it alone knows — providers write their own records for the security events they own — and an entry must never carry a password, code, or bearer token.

```ts type-equiv
/** One audit record, as written by a caller. */
interface AuditEntry {
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
```

```ts type-equiv
/** One audit record, as read back. */
interface AuditRecord extends AuditEntry {
  /** The record's durable identity. */
  readonly auditId: string
  /** When the record was written. */
  readonly ts: number
}
```

## The request gate (`ctx.authGate`)

`RequestGate` is what a transport asks before it admits a request: `authenticate` resolves a request's headers to a `Principal` (or `undefined` for no valid credential), and `sessionCookie`/`clearedCookie` produce the `Set-Cookie` values that install and remove a login session. The gateway itself mounts no auth provider — every entry point that does not authenticate resolves to the `local` principal, which the gateway's policy table passes unconditionally, so a deployment without authentication behaves exactly as it did before this module existed. A transport reads the gate optionally (`ctx.get('authGate')`); an absent gate is a single-tenant deployment, not a failure. See [the request-gate design note](../../.agents/notes/implemented/architecture/2026-08-23-auth-request-gate.md) for the policy table, the three fence sites, and the session-cookie contract.

```ts type-equiv
/**
 * Request headers as either HTTP representation the host serves: the Node
 * `IncomingMessage` view for a raw route or an upgrade, the WHATWG view once a
 * bridge has built a `Request`.
 */
type RequestHeaders = IncomingHttpHeaders | Headers
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauth--authservice-abstract-seam"></a>

### `ctx.auth` — `AuthService` (abstract seam)

Abstract authentication and authorization service.

Every method is asynchronous because a provider owns durable storage, and every credential-checking method answers with a value rather than an error: verifyLogin returns an outcome, authenticateToken and the one-time-token methods return `undefined`. A failed check is an expected result, and giving it a distinct failure shape would let a caller tell an unknown account from a wrong password. Deliberate refusals — a duplicate address, a builtin group, a rate limit — throw `AuthError` with a code.

Security limits are the provider's, not the caller's: rate limiting, lockout, and attempt caps live inside these methods so that no call site can omit them.

```ts cordis-catalog
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
abstract issueOneTimeToken( kind: OneTimeTokenKind, userId: UserId, ttlMs: number, ): Promise<IssuedOneTimeToken>

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
```

Types: [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/auth/auth/src/index.ts`](../../packages/auth/auth/src/index.ts)

<a id="ctxauthgate--requestgate"></a>

### `ctx.authGate` — `RequestGate`

The authentication a transport asks for before it admits a request.

Declared here rather than in the package that implements it because both sides of the question live below that package: the gateway needs the Principal to dispatch, and the transport that admits the request needs to resolve one before it does. A transport reads it optionally (`ctx.get('authGate')`) — an absent gate is a single-tenant deployment, not a failure.

```ts cordis-catalog
/**
 * Resolve one request's credentials to its principal.
 * @param headers - the request's headers, in either HTTP representation.
 * @returns the authenticated principal, or `undefined` when the request carries no valid credential.
 */
authenticate(headers: RequestHeaders): Promise<Principal | undefined>

/**
 * The `Set-Cookie` value that installs one freshly issued login session.
 * @param authSessionId - the issued session's id, carried so a logout can revoke exactly this session.
 * @param token - the issued bearer token.
 * @param expiresAt - epoch milliseconds at which the token stops authenticating.
 * @returns the header value to send.
 */
sessionCookie(authSessionId: string, token: string, expiresAt: number): string

/**
 * The `Set-Cookie` value that removes the login session cookie. Sent on
 * logout and on any answer that establishes the caller has no usable
 * session, so a stale cookie stops being resent.
 * @returns the header value to send.
 */
clearedCookie(): string

/**
 * Tell one account it was added to a permission group.
 *
 * Declared here because the gateway is the caller: `auth.admin.members.set`
 * is what knows which accounts a save newly added, while the message itself
 * belongs to the gate that already owns every other message this deployment
 * sends. The notice is refused for an address with no account, so it cannot
 * be used to mail a stranger.
 * @param email - the account's address.
 * @param groupName - the group the account was added to.
 */
notifyAddedToGroup(email: string, groupName: string): Promise<void>
```

Source: [`packages/host/apiproxy/src/authorization.ts`](../../packages/host/apiproxy/src/authorization.ts)
<!-- END GENERATED cordis-surface -->
