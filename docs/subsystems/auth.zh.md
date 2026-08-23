# 身份认证与授权

[English](auth.md) | 中文

[`dsh-auth`](../../packages/auth/auth) 拥有多用户部署需要回答三个问题的身份与权限词汇：这个请求是谁、它可以触达什么、以及谁拥有这个持久对象。[`dsh-host-apiproxy`](../../packages/host/apiproxy) 的 `authorization` 模块拥有面向传输层的另一半：请求网关，它在网关分发之前把一个请求的凭据解析成 `Principal`。该能力接缝存储账户、群组与规则并决定主体可以做什么；网关在这一决定运行之前解析出请求是谁。[`dsh-auth-sqlite`](../../packages/auth/auth-sqlite) 是被挂载的 `AuthService` 提供方；这两个包默认都不会组合进已发布的部署，因此该能力是可选启用的。

Source: [`packages/auth/auth/src/index.ts`](../../packages/auth/auth/src/index.ts)

Source: [`packages/host/apiproxy/src/authorization.ts`](../../packages/host/apiproxy/src/authorization.ts)

## 主体（Principal）

`Principal` 要么是一个已认证的 `user`，要么是 `local`。`local` 是在没有挂载认证提供方时每个入口点解析到的主体——CLI、ACP 服务器、进程内测试，以及任何从未加载 `dsh-auth-sqlite` 的组合。它拥有完整权限，这正是让该能力保持可选的原因：一个从未挂载提供方的部署，其行为与该接缝存在之前完全一致；`local` 也绝不是登录失败时的兜底——凭据未通过认证的请求会被拒绝，而不会降级为 `local`。

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

`UserId`、`GroupId`、`AuthSessionId` 与 `OneTimeTokenId` 都是[带品牌的 id](core.zh.md#branded-ids)。

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

## 权限规则

一条规则针对产品已经用字符串命名的四个命名空间之一：一个已注册的技能名、一个工具名、一条 `provider/model` 路由，或一个设置命名空间。`pattern` 是精确名称，或以 `*` 结尾的前缀。求值顺序是 **deny > allow > default-deny**：匹配到的 `deny` 直接裁定拒绝，匹配到的 `allow` 授予访问，而没有任何规则提及的名称则被拒绝——因此之后新增的技能、工具、模型或设置区块默认是安全的，而不是要等到有人记得去禁止它才安全。规则是扁平的，并在主体所属的每个群组之间取并集；因为 deny 总是优先，这个并集不需要群组之间的排序。[`dsh-auth`](../../packages/auth/auth/README.zh.md) 记录了 `evaluate`/`permits` 的确切契约，包括 `local` 与 `admin: true` 主体如何完全绕过求值。

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

## 账户、登录与一次性密钥

密码在存储前使用 node:crypto 的 **scrypt** 哈希，且明文从不保留；[`dsh-auth`](../../packages/auth/auth/README.zh.md) 记录了确切的参数与编码方式。一个登录会话的持有者令牌，或一个一次性密钥的验证码或链接令牌，都只向调用方返回一次——存储只保留摘要，因此把数据库读出来也得不到任何可重放的凭据。`verifyLogin` 强制执行该接缝固定的尝试次数上限与锁定策略，且失败原因从不外泄：未知地址、密码错误、账户被禁用，返回的都是同一个结果。

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

## 群组

群组要么是内建的（管理员群组，`ADMIN_GROUP_ID`），要么由管理员创建；内建群组拒绝重命名与删除，因为它的名称与 id 是模式（schema）的一部分。成员关系与规则都是整体替换（`setMembers`、`setRules`）而不是逐条修改，因此管理界面可以保存一次成员或规则编辑而不产生读改写竞争。

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

## 会话与工作区归属

`ctx.auth` 把每个创建了 agent [会话](session.zh.md)与每个[工作区](workspace.zh.md)的账户，记录在认证数据库本身，而不是会话日志中：归属是关于部署的访问控制事实，而不是关于对话的模型可见事实；把它与所引用的账户放在一起，意味着删除认证数据库就能干净地移除整个多用户层。一个在部署挂载 `dsh-auth-sqlite` 之前就已记录的资源没有所有者；下文的请求网关会把无主资源视为不属于任何人，管理员除外。完整原理见[认证能力设计笔记](../../.agents/notes/implemented/architecture/2026-08-23-auth-capability-design.zh.md)。

## 审计

`audit` 追加一条记录；`readAudit` 按最近优先读回最近的若干条。调用方只写入自己独有的事实——提供方为自己负责的安全事件写入自己的记录——且记录中绝不能携带密码、验证码或持有者令牌。

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

## 请求网关（`ctx.authGate`）

`RequestGate` 是传输层在放行一个请求之前要询问的对象：`authenticate` 把请求头解析为 `Principal`（若没有有效凭据则为 `undefined`），`sessionCookie`/`clearedCookie` 生成安装与清除登录会话所需的 `Set-Cookie` 值。网关本身不挂载任何认证提供方——每个未认证的入口点都解析为 `local` 主体，网关的策略表对它无条件放行，因此没有认证时的部署行为与该模块存在之前完全一致。传输层以可选方式读取网关（`ctx.get('authGate')`）；网关缺失代表单租户部署，而不是失败。策略表、三个防线位置与会话 cookie 契约见[请求网关设计笔记](../../.agents/notes/implemented/architecture/2026-08-23-auth-request-gate.zh.md)。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * replaces membership wholesale. A provider MUST keep the given order: it is
 * the order an administration page redisplays, and a set that came back
 * shuffled would read as an edit nobody made.
 * @param groupId - the group to update.
 * @param rules - the complete rule set after the call.
 * @throws AuthError `unknown-subject` when no such group exists.
 */
abstract setRules(groupId: GroupId, rules: readonly PermissionRule[]): Promise<void>

/**
 * One group's rules, in the order the last {@link setRules} supplied them.
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

Types: [SessionId](core.zh.md) · [WorkspaceId](workspace.zh.md)

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
