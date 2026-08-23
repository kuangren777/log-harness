/**
 * Every durable auth operation: accounts, login checks, sessions, single-use
 * secrets, groups and rules, ownership, and the audit log.
 *
 * Rows are read as typed values without hand-written decoding. The provider
 * owns the schema, every table is STRICT, every closed vocabulary is a `CHECK`
 * constraint, and the open sequence refuses a medium stamped by another build
 * — so SQLite itself is the validation at this durable boundary.
 * @module @deepseek-ai/dsh-auth-sqlite/store
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  ADMIN_GROUP_ID,
  AuthError,
  AuthSessionId,
  GroupId,
  OneTimeTokenId,
  UserId,
  digestOf,
  digestOfCode,
  hashPassword,
  isPasswordHash,
  mintCode,
  mintToken,
  sameDigest,
  verifyPassword,
} from '@deepseek-ai/dsh-auth'
import type {
  AuditEntry,
  AuditRecord,
  AuthSessionMeta,
  GroupRecord,
  IssuedAuthSession,
  IssuedOneTimeToken,
  LoginOutcome,
  OneTimeTokenKind,
  PermissionRule,
  Principal,
  UserRecord,
} from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  CODE_ATTEMPT_CAP,
  HOUR_MS,
  PASSWORD_ATTEMPTS_PER_EMAIL,
  PASSWORD_ATTEMPTS_PER_IP,
  RESET_PER_HOUR,
  TWO_FACTOR_MIN_INTERVAL_MS,
  TWO_FACTOR_PER_HOUR,
  countAttempts,
  lockoutUntil,
  passwordEmailKey,
  passwordIpKey,
  pruneAttempts,
  recordAttempt,
  resetKey,
  twoFactorKey,
} from './limits.ts'
import { openDatabase, type JournalMode } from './schema.ts'
import { transact } from './transaction.ts'

/** Fully resolved store parameters; the service does the defaulting, never this file. */
export interface AuthStoreOptions {
  /** SQLite database file, or `:memory:`. */
  readonly path: string
  /** Journal pragma to run under. */
  readonly journalMode: JournalMode
  /** How long an issued login session stays valid, in milliseconds. */
  readonly sessionTtlMs: number
  /** Clock for every stored timestamp and every window decision. */
  readonly now: () => number
  /** Operator-facing diagnostics sink for facts a caller must not be told. */
  readonly warn: (message: string) => void
}

/** One counted issuance limit. */
interface IssuanceLimit {
  readonly key: string
  readonly windowMs: number
  readonly max: number
}

let decoyHash: Promise<string> | undefined

/**
 * A hash to check a submitted password against when no account has the
 * submitted address. Without it a login for an unknown address would return
 * before scrypt ever ran, and the difference would be measurable — an account
 * enumeration oracle that no amount of message uniformity closes.
 */
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomUUID())
  return decoyHash
}

function nullable<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function issuanceLimits(kind: OneTimeTokenKind, userId: UserId, email: string): readonly IssuanceLimit[] {
  switch (kind) {
    case '2fa':
      return [
        { key: twoFactorKey(userId), windowMs: TWO_FACTOR_MIN_INTERVAL_MS, max: 1 },
        { key: twoFactorKey(userId), windowMs: HOUR_MS, max: TWO_FACTOR_PER_HOUR },
      ]
    case 'reset-password':
      return [{ key: resetKey(email), windowMs: HOUR_MS, max: RESET_PER_HOUR }]
    case 'verify-email':
      // Confirming an address the account already claims grants nothing, so
      // the only limit worth having here is the token's own expiry.
      return []
  }
}

/** One attempt counter and the threshold that locks it out. */
interface PasswordCounter {
  readonly key: string
  readonly threshold: number
}

function passwordCounters(email: string, ip: string | undefined): readonly PasswordCounter[] {
  return [
    { key: passwordEmailKey(email), threshold: PASSWORD_ATTEMPTS_PER_EMAIL },
    ...ip === undefined ? [] : [{ key: passwordIpKey(ip), threshold: PASSWORD_ATTEMPTS_PER_IP }],
  ]
}

/** The latest deadline any of a login's counters currently imposes. */
function currentLockout(db: DatabaseSync, counters: readonly PasswordCounter[], now: number): number | undefined {
  const deadlines = counters
    .map(counter => lockoutUntil(db, counter.key, counter.threshold, now))
    .filter((value): value is number => value !== undefined)
  return deadlines.length === 0 ? undefined : Math.max(...deadlines)
}

/** Durable auth storage over one `node:sqlite` database. */
export class AuthStore {
  private readonly ready: Promise<DatabaseSync>
  private closing: Promise<void> | undefined

  /**
   * @param options - fully resolved store parameters.
   */
  constructor(private readonly options: AuthStoreOptions) {
    this.ready = openDatabase(options.path, options.journalMode, options.now)
    // Mark the rejection handled: every operation re-awaits `ready`, so an
    // open failure still reaches each caller; this only stops an unhandled
    // rejection when the failure precedes the first operation.
    this.ready.catch(() => {})
  }

  /**
   * Settle the one open operation, so a misconfigured medium fails at load
   * rather than at the first login.
   * @returns the open database.
   */
  open(): Promise<DatabaseSync> {
    return this.ready
  }

  /**
   * Release the database. Idempotent: repeated and concurrent calls resolve
   * once teardown has finished, and a store whose open failed has nothing to
   * release.
   * @returns resolution after the connection is closed.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      // The open already rejected every caller; there is no connection to close.
      return
    }
    db.close()
  }

  /**
   * Register an account.
   * @param email - the account's address.
   * @param password - the plaintext password.
   * @returns the new account's id.
   * @throws AuthError `duplicate-email` when the address is taken.
   */
  async createUser(email: string, password: string): Promise<UserId> {
    const db = await this.ready
    // Hash before the uniqueness check so the check and the insert are one
    // synchronous run: an await between them would let two concurrent
    // registrations of one address both pass the check.
    const hash = await hashPassword(password)
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email) !== undefined) {
      throw new AuthError('duplicate-email', 'an account already exists for that address')
    }
    const userId = UserId(randomUUID())
    const ts = this.options.now()
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, email, hash, ts)
    this.writeAudit(db, { event: 'auth.user-created', actorUserId: userId, subject: userId }, ts)
    return userId
  }

  /**
   * Look one account up by address, case-insensitively.
   * @param email - the address to look up.
   * @returns the account, or `undefined` when none has that address.
   */
  async getUserByEmail(email: string): Promise<UserRecord | undefined> {
    const db = await this.ready
    const row = db.prepare(
      'SELECT id, email, email_verified_at, disabled_at, created_at FROM users WHERE email = ?',
    ).get(email) as UserColumns | undefined
    return row === undefined ? undefined : toUserRecord(row)
  }

  /**
   * Every account, oldest first.
   * @returns the accounts, without password hashes.
   */
  async listUsers(): Promise<readonly UserRecord[]> {
    const db = await this.ready
    const rows = db.prepare(
      'SELECT id, email, email_verified_at, disabled_at, created_at FROM users ORDER BY created_at, id',
    ).all() as unknown as UserColumns[]
    return rows.map(toUserRecord)
  }

  /**
   * Disable or restore one account. Idempotent, and a repeat disable keeps the
   * first timestamp: `disabled_at` is when the block started.
   * @param userId - the account to update.
   * @param disabled - whether the account is blocked from authenticating.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  async setUserDisabled(userId: UserId, disabled: boolean): Promise<void> {
    const db = await this.ready
    this.requireUser(db, userId)
    const now = this.options.now()
    const result = db.prepare(
      disabled
        ? 'UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL'
        : 'UPDATE users SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT NULL',
    ).run(...disabled ? [now, userId] : [userId])
    if (result.changes === 0) return
    this.writeAudit(
      db,
      { event: disabled ? 'auth.user-disabled' : 'auth.user-restored', subject: userId },
      now,
    )
  }

  /**
   * Resolve one account to its principal without a credential.
   * @param userId - the account to resolve.
   * @returns the principal, or `undefined` when the account is unknown or disabled.
   */
  async principalOf(userId: UserId): Promise<Principal | undefined> {
    const db = await this.ready
    const row = db.prepare('SELECT email, disabled_at FROM users WHERE id = ?')
      .get(userId) as { email: string; disabled_at: number | null } | undefined
    if (row === undefined || row.disabled_at !== null) return undefined
    const groups = this.groupsOf(db, userId)
    return { kind: 'user', userId, email: row.email, groups, admin: groups.includes(ADMIN_GROUP_ID) }
  }

  /**
   * Replace an account's password.
   * @param userId - the account to update.
   * @param password - the new plaintext password.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  async setPassword(userId: UserId, password: string): Promise<void> {
    const db = await this.ready
    const hash = await hashPassword(password)
    const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
    if (result.changes === 0) throw new AuthError('unknown-subject', `no account ${userId}`)
    this.writeAudit(
      db,
      { event: 'auth.password-changed', actorUserId: userId, subject: userId },
      this.options.now(),
    )
  }

  /**
   * Check a password under this provider's fixed attempt limits.
   * @param email - the submitted address.
   * @param password - the submitted password.
   * @param ip - the client address, when known.
   * @returns the account on success, otherwise a failure carrying any lockout deadline.
   */
  async verifyLogin(email: string, password: string, ip?: string): Promise<LoginOutcome> {
    const db = await this.ready
    const now = this.options.now()
    pruneAttempts(db, now)
    const counters = passwordCounters(email, ip)
    const locked = currentLockout(db, counters, now)
    if (locked !== undefined) {
      this.writeAudit(db, { event: 'auth.login-locked-out', subject: email, ...ip === undefined ? {} : { ip } }, now)
      return { ok: false, lockedUntil: locked }
    }
    const row = db.prepare('SELECT id, password_hash, disabled_at FROM users WHERE email = ?')
      .get(email) as { id: string; password_hash: string; disabled_at: number | null } | undefined
    const stored = row === undefined ? await decoy() : row.password_hash
    if (row !== undefined && !isPasswordHash(stored)) {
      // The caller is told nothing beyond "no": a corrupt row must not be
      // distinguishable from a wrong password. An operator, however, cannot
      // fix what is never reported.
      this.options.warn(`auth: stored password hash for account ${row.id} is unreadable; the account cannot log in`)
    }
    const matched = await verifyPassword(password, stored)
    if (row === undefined || !matched || row.disabled_at !== null) {
      for (const counter of counters) recordAttempt(db, counter.key, now)
      this.writeAudit(db, { event: 'auth.login-failed', subject: email, ...ip === undefined ? {} : { ip } }, now)
      return { ok: false, lockedUntil: currentLockout(db, counters, now) }
    }
    const userId = UserId(row.id)
    this.writeAudit(
      db,
      { event: 'auth.login-succeeded', actorUserId: userId, subject: email, ...ip === undefined ? {} : { ip } },
      now,
    )
    return { ok: true, userId }
  }

  /**
   * Issue a login session and its bearer token.
   * @param userId - the account to issue for.
   * @param meta - client facts recorded with the session.
   * @returns the session id, the token, and its expiry.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  async issueAuthSession(userId: UserId, meta: AuthSessionMeta): Promise<IssuedAuthSession> {
    const db = await this.ready
    this.requireUser(db, userId)
    const { token, digest } = mintToken()
    const now = this.options.now()
    const expiresAt = now + this.options.sessionTtlMs
    const authSessionId = AuthSessionId(randomUUID())
    db.prepare(`INSERT INTO auth_sessions
        (id, token_digest, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(authSessionId, digest, userId, now, expiresAt, now, orNull(meta.ip), orNull(meta.userAgent))
    this.writeAudit(
      db,
      {
        event: 'auth.session-issued',
        actorUserId: userId,
        subject: authSessionId,
        ...meta.ip === undefined ? {} : { ip: meta.ip },
      },
      now,
    )
    return { authSessionId, token, expiresAt }
  }

  /**
   * Resolve a bearer token to its principal and refresh its last-seen time.
   *
   * The lookup is an indexed equality on the token's SHA-256 digest. There is
   * no constant-time comparison to make here: the secret behind the digest
   * carries 256 bits, so no timing signal narrows a search that no attacker
   * can run in the first place.
   * @param token - the presented bearer token.
   * @returns the principal, or `undefined` when the token does not authenticate.
   */
  async authenticateToken(token: string): Promise<Principal | undefined> {
    const db = await this.ready
    const row = db.prepare(`SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.disabled_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_digest = ?`).get(digestOf(token)) as AuthSessionColumns | undefined
    if (row === undefined) return undefined
    const now = this.options.now()
    if (row.revoked_at !== null || row.disabled_at !== null || row.expires_at <= now) return undefined
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id)
    const groups = this.groupsOf(db, UserId(row.user_id))
    return {
      kind: 'user',
      userId: UserId(row.user_id),
      email: row.email,
      groups,
      admin: groups.includes(ADMIN_GROUP_ID),
    }
  }

  /**
   * Revoke one login session; revoking an unknown or already-revoked one is a no-op.
   * @param authSessionId - the session to revoke.
   */
  async revokeSession(authSessionId: AuthSessionId): Promise<void> {
    const db = await this.ready
    const now = this.options.now()
    const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now, authSessionId)
    if (result.changes === 0) return
    this.writeAudit(db, { event: 'auth.session-revoked', subject: authSessionId }, now)
  }

  /**
   * Revoke every live login session for one account.
   * @param userId - the account whose sessions to revoke.
   */
  async revokeAllSessions(userId: UserId): Promise<void> {
    const db = await this.ready
    const now = this.options.now()
    const result = db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(now, userId)
    this.writeAudit(
      db,
      {
        event: 'auth.sessions-revoked',
        actorUserId: userId,
        subject: userId,
        detail: `${result.changes} session(s)`,
      },
      now,
    )
  }

  /**
   * Issue a single-use secret under this provider's fixed issuance limits.
   * @param kind - what the secret is for.
   * @param userId - the account it belongs to.
   * @param ttlMs - how long it stays valid.
   * @returns the row id, the secret, and its expiry.
   * @throws AuthError `unknown-subject` for an unknown account, `rate-limited` when issuance is too frequent.
   */
  async issueOneTimeToken(
    kind: OneTimeTokenKind,
    userId: UserId,
    ttlMs: number,
  ): Promise<IssuedOneTimeToken> {
    const db = await this.ready
    const user = this.requireUser(db, userId)
    const now = this.options.now()
    pruneAttempts(db, now)
    const limits = issuanceLimits(kind, userId, user.email)
    for (const limit of limits) {
      if (countAttempts(db, limit.key, limit.windowMs, now) >= limit.max) {
        throw new AuthError(
          'rate-limited',
          `too many ${kind} requests; try again later`,
          limit.windowMs,
        )
      }
    }
    for (const key of new Set(limits.map(limit => limit.key))) recordAttempt(db, key, now)

    let secret: string
    let digest: Buffer
    let salt: Buffer | null
    if (kind === '2fa') {
      const minted = mintCode()
      secret = minted.code
      digest = minted.digest
      salt = minted.salt
    } else {
      const minted = mintToken()
      secret = minted.token
      digest = minted.digest
      salt = null
    }
    const oneTimeTokenId = OneTimeTokenId(randomUUID())
    const expiresAt = now + ttlMs
    db.prepare(`INSERT INTO one_time_tokens (id, kind, user_id, digest, salt, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(oneTimeTokenId, kind, userId, digest, salt, now, expiresAt)
    this.writeAudit(
      db,
      { event: 'auth.one-time-token-issued', actorUserId: userId, subject: oneTimeTokenId, detail: kind },
      now,
    )
    return { oneTimeTokenId, secret, expiresAt }
  }

  /**
   * Redeem a link-kind secret, once and atomically, recording what a
   * `verify-email` secret proves in the same transaction.
   * @param kind - the kind the secret must have been issued for.
   * @param token - the presented secret.
   * @returns the account it belonged to, or `undefined` when it does not redeem.
   */
  async consumeOneTimeToken(kind: OneTimeTokenKind, token: string): Promise<UserId | undefined> {
    const db = await this.ready
    const now = this.options.now()
    const digest = digestOf(token)
    return transact(db, () => {
      const row = db.prepare(
        'SELECT id, user_id, expires_at, consumed_at FROM one_time_tokens WHERE digest = ? AND kind = ?',
      ).get(digest, kind) as OneTimeTokenColumns | undefined
      if (row === undefined || row.consumed_at !== null || row.expires_at <= now) return undefined
      db.prepare('UPDATE one_time_tokens SET consumed_at = ? WHERE id = ?').run(now, row.id)
      const userId = UserId(row.user_id)
      // Consumption and confirmation commit together: a crash between two
      // separate writes would spend the single-use link without recording
      // what it proved, and the account could never become verified. The
      // `IS NULL` guard keeps the FIRST confirmation's timestamp, so a second
      // token issued in a race does not move when the address was proven.
      if (kind === 'verify-email') {
        db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL')
          .run(now, userId)
      }
      this.writeAudit(
        db,
        { event: 'auth.one-time-token-consumed', actorUserId: userId, subject: row.id, detail: kind },
        now,
      )
      return userId
    })
  }

  /**
   * Verify a second-factor code against one challenge.
   * @param oneTimeTokenId - the challenge to verify against.
   * @param code - the presented code.
   * @returns the account it belonged to, or `undefined` when it does not verify.
   */
  async verifyTotpCode(oneTimeTokenId: OneTimeTokenId, code: string): Promise<UserId | undefined> {
    const db = await this.ready
    const now = this.options.now()
    return transact(db, () => {
      // A NULL salt cannot occur on a `2fa` row this provider wrote; coalescing
      // in SQL keeps a hand-edited row on the ordinary "does not verify" path.
      const row = db.prepare(`SELECT id, user_id, expires_at, consumed_at, attempts, digest, COALESCE(salt, x'') AS salt
        FROM one_time_tokens WHERE id = ? AND kind = '2fa'`).get(oneTimeTokenId) as CodeColumns | undefined
      if (row === undefined || row.consumed_at !== null || row.expires_at <= now) return undefined
      const userId = UserId(row.user_id)
      if (sameDigest(digestOfCode(Buffer.from(row.salt), code), Buffer.from(row.digest))) {
        db.prepare('UPDATE one_time_tokens SET consumed_at = ? WHERE id = ?').run(now, row.id)
        this.writeAudit(
          db,
          { event: 'auth.second-factor-verified', actorUserId: userId, subject: row.id },
          now,
        )
        return userId
      }
      const attempts = row.attempts + 1
      // Reaching the cap kills the challenge instead of merely refusing this
      // guess: six digits are only safe while the number of guesses is.
      const exhausted = attempts >= CODE_ATTEMPT_CAP
      db.prepare('UPDATE one_time_tokens SET attempts = ?, consumed_at = ? WHERE id = ?')
        .run(attempts, exhausted ? now : null, row.id)
      this.writeAudit(
        db,
        {
          event: exhausted ? 'auth.second-factor-exhausted' : 'auth.second-factor-failed',
          actorUserId: userId,
          subject: row.id,
          detail: `${attempts} attempt(s)`,
        },
        now,
      )
      return undefined
    })
  }

  /**
   * Every group, builtin ones included.
   * @returns the groups, oldest first.
   */
  async listGroups(): Promise<readonly GroupRecord[]> {
    const db = await this.ready
    const rows = db.prepare('SELECT id, name, builtin, created_at FROM groups ORDER BY created_at, name')
      .all() as unknown as GroupColumns[]
    return rows.map(row => ({
      groupId: GroupId(row.id),
      name: row.name,
      builtin: row.builtin === 1,
      createdAt: row.created_at,
    }))
  }

  /**
   * Create a permission group.
   * @param name - the group's unique name.
   * @returns the new group's id.
   * @throws AuthError `duplicate-group-name` when the name is taken.
   */
  async createGroup(name: string): Promise<GroupId> {
    const db = await this.ready
    this.requireFreeGroupName(db, name)
    const groupId = GroupId(randomUUID())
    const now = this.options.now()
    db.prepare('INSERT INTO groups (id, name, builtin, created_at) VALUES (?, ?, 0, ?)')
      .run(groupId, name, now)
    this.writeAudit(db, { event: 'auth.group-created', subject: groupId, detail: name }, now)
    return groupId
  }

  /**
   * Delete a group with its memberships and rules.
   * @param groupId - the group to delete.
   * @throws AuthError `unknown-subject` for an unknown group, `builtin-group` for a builtin one.
   */
  async deleteGroup(groupId: GroupId): Promise<void> {
    const db = await this.ready
    this.requireMutableGroup(db, groupId)
    const now = this.options.now()
    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId)
    this.writeAudit(db, { event: 'auth.group-deleted', subject: groupId }, now)
  }

  /**
   * Rename a group.
   * @param groupId - the group to rename.
   * @param name - the new unique name.
   * @throws AuthError `unknown-subject`, `builtin-group`, or `duplicate-group-name`.
   */
  async renameGroup(groupId: GroupId, name: string): Promise<void> {
    const db = await this.ready
    this.requireMutableGroup(db, groupId)
    this.requireFreeGroupName(db, name)
    const now = this.options.now()
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, groupId)
    this.writeAudit(db, { event: 'auth.group-renamed', subject: groupId, detail: name }, now)
  }

  /**
   * Replace a group's membership wholesale.
   * @param groupId - the group to update.
   * @param userIds - the complete membership after the call.
   * @throws AuthError `unknown-subject` when the group or any listed account is unknown.
   */
  async setMembers(groupId: GroupId, userIds: readonly UserId[]): Promise<void> {
    const db = await this.ready
    this.requireGroup(db, groupId)
    for (const userId of userIds) this.requireUser(db, userId)
    const now = this.options.now()
    transact(db, () => {
      db.prepare('DELETE FROM memberships WHERE group_id = ?').run(groupId)
      const insert = db.prepare('INSERT INTO memberships (user_id, group_id) VALUES (?, ?)')
      for (const userId of userIds) insert.run(userId, groupId)
      this.writeAudit(
        db,
        { event: 'auth.members-set', subject: groupId, detail: `${userIds.length} member(s)` },
        now,
      )
    })
  }

  /**
   * One group's membership.
   * @param groupId - the group to read.
   * @returns its member accounts.
   */
  async listMembers(groupId: GroupId): Promise<readonly UserId[]> {
    const db = await this.ready
    const rows = db.prepare('SELECT user_id FROM memberships WHERE group_id = ? ORDER BY user_id')
      .all(groupId) as Array<{ user_id: string }>
    return rows.map(row => UserId(row.user_id))
  }

  /**
   * Replace a group's rules wholesale.
   * @param groupId - the group to update.
   * @param rules - the complete rule set after the call.
   * @throws AuthError `unknown-subject` when no such group exists.
   */
  async setRules(groupId: GroupId, rules: readonly PermissionRule[]): Promise<void> {
    const db = await this.ready
    this.requireGroup(db, groupId)
    const now = this.options.now()
    transact(db, () => {
      db.prepare('DELETE FROM rules WHERE group_id = ?').run(groupId)
      const insert = db.prepare('INSERT INTO rules (id, group_id, domain, pattern, effect) VALUES (?, ?, ?, ?, ?)')
      for (const rule of rules) insert.run(randomUUID(), groupId, rule.domain, rule.pattern, rule.effect)
      this.writeAudit(
        db,
        { event: 'auth.rules-set', subject: groupId, detail: `${rules.length} rule(s)` },
        now,
      )
    })
  }

  /**
   * One group's rules.
   * @param groupId - the group to read.
   * @returns its rules.
   */
  async listRules(groupId: GroupId): Promise<readonly PermissionRule[]> {
    const db = await this.ready
    return db.prepare('SELECT domain, pattern, effect FROM rules WHERE group_id = ? ORDER BY id')
      .all(groupId) as unknown as PermissionRule[]
  }

  /**
   * Every rule that applies to one account.
   * @param userId - the account to collect rules for.
   * @returns the union of its groups' rules.
   */
  async rulesFor(userId: UserId): Promise<readonly PermissionRule[]> {
    const db = await this.ready
    return db.prepare(`SELECT r.domain, r.pattern, r.effect FROM rules r
      JOIN memberships m ON m.group_id = r.group_id
      WHERE m.user_id = ? ORDER BY r.id`).all(userId) as unknown as PermissionRule[]
  }

  /**
   * Record which account owns one agent session; recording again transfers ownership.
   * @param sessionId - the agent session.
   * @param userId - the owning account.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  async recordSessionOwner(sessionId: SessionId, userId: UserId): Promise<void> {
    const db = await this.ready
    this.requireUser(db, userId)
    const now = this.options.now()
    db.prepare(`INSERT INTO session_owners (session_id, user_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at`)
      .run(sessionId, userId, now)
    this.writeAudit(db, { event: 'auth.session-owner-recorded', actorUserId: userId, subject: sessionId }, now)
  }

  /**
   * Who owns one agent session.
   * @param sessionId - the agent session.
   * @returns the owning account, or `undefined` when none is recorded.
   */
  async ownerOfSession(sessionId: SessionId): Promise<UserId | undefined> {
    const db = await this.ready
    const row = db.prepare('SELECT user_id FROM session_owners WHERE session_id = ?')
      .get(sessionId) as { user_id: string } | undefined
    return row === undefined ? undefined : UserId(row.user_id)
  }

  /**
   * Every agent session one account owns.
   * @param userId - the owning account.
   * @returns the owned session ids, most recently recorded first.
   */
  async listOwnedSessions(userId: UserId): Promise<readonly SessionId[]> {
    const db = await this.ready
    const rows = db.prepare(
      'SELECT session_id FROM session_owners WHERE user_id = ? ORDER BY created_at DESC, session_id',
    ).all(userId) as Array<{ session_id: string }>
    return rows.map(row => row.session_id as SessionId)
  }

  /**
   * Record which account owns one workspace; recording again transfers ownership.
   * @param workspaceId - the workspace.
   * @param userId - the owning account.
   * @throws AuthError `unknown-subject` when no such account exists.
   */
  async recordWorkspaceOwner(workspaceId: WorkspaceId, userId: UserId): Promise<void> {
    const db = await this.ready
    this.requireUser(db, userId)
    const now = this.options.now()
    db.prepare(`INSERT INTO workspace_owners (workspace_id, user_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at`)
      .run(workspaceId, userId, now)
    this.writeAudit(db, { event: 'auth.workspace-owner-recorded', actorUserId: userId, subject: workspaceId }, now)
  }

  /**
   * Who owns one workspace.
   * @param workspaceId - the workspace.
   * @returns the owning account, or `undefined` when none is recorded.
   */
  async ownerOfWorkspace(workspaceId: WorkspaceId): Promise<UserId | undefined> {
    const db = await this.ready
    const row = db.prepare('SELECT user_id FROM workspace_owners WHERE workspace_id = ?')
      .get(workspaceId) as { user_id: string } | undefined
    return row === undefined ? undefined : UserId(row.user_id)
  }

  /**
   * Every workspace one account owns.
   * @param userId - the owning account.
   * @returns the owned workspace ids, most recently recorded first.
   */
  async listOwnedWorkspaces(userId: UserId): Promise<readonly WorkspaceId[]> {
    const db = await this.ready
    const rows = db.prepare(
      'SELECT workspace_id FROM workspace_owners WHERE user_id = ? ORDER BY created_at DESC, workspace_id',
    ).all(userId) as Array<{ workspace_id: string }>
    return rows.map(row => row.workspace_id as WorkspaceId)
  }

  /**
   * Append one audit record.
   * @param entry - the record; it must not carry a password, code, or token.
   */
  async audit(entry: AuditEntry): Promise<void> {
    const db = await this.ready
    this.writeAudit(db, entry, this.options.now())
  }

  /**
   * Read the most recent audit records.
   * @param limit - how many to return.
   * @returns the records, most recent first.
   */
  async readAudit(limit: number): Promise<readonly AuditRecord[]> {
    const db = await this.ready
    // Insertion order breaks a timestamp tie: several security events of one
    // operation land in the same millisecond, and ordering them by id would
    // shuffle a flow's records against the order they actually happened in.
    const rows = db.prepare(
      'SELECT id, ts, actor_user_id, event, subject, detail, ip FROM audit_log ORDER BY ts DESC, rowid DESC LIMIT ?',
    ).all(limit) as unknown as AuditColumns[]
    return rows.map(row => ({
      auditId: row.id,
      ts: row.ts,
      event: row.event,
      ...row.actor_user_id === null ? {} : { actorUserId: UserId(row.actor_user_id) },
      ...row.subject === null ? {} : { subject: row.subject },
      ...row.detail === null ? {} : { detail: row.detail },
      ...row.ip === null ? {} : { ip: row.ip },
    }))
  }

  private writeAudit(db: DatabaseSync, entry: AuditEntry, ts: number): void {
    db.prepare(`INSERT INTO audit_log (id, ts, actor_user_id, event, subject, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        randomUUID(),
        ts,
        orNull(entry.actorUserId),
        entry.event,
        orNull(entry.subject),
        orNull(entry.detail),
        orNull(entry.ip),
      )
  }

  private groupsOf(db: DatabaseSync, userId: UserId): readonly GroupId[] {
    const rows = db.prepare('SELECT group_id FROM memberships WHERE user_id = ? ORDER BY group_id')
      .all(userId) as Array<{ group_id: string }>
    return rows.map(row => GroupId(row.group_id))
  }

  private requireUser(db: DatabaseSync, userId: UserId): { email: string } {
    const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
    if (row === undefined) throw new AuthError('unknown-subject', `no account ${userId}`)
    return row
  }

  private requireGroup(db: DatabaseSync, groupId: GroupId): { builtin: number } {
    const row = db.prepare('SELECT builtin FROM groups WHERE id = ?').get(groupId) as { builtin: number } | undefined
    if (row === undefined) throw new AuthError('unknown-subject', `no group ${groupId}`)
    return row
  }

  private requireMutableGroup(db: DatabaseSync, groupId: GroupId): void {
    if (this.requireGroup(db, groupId).builtin === 1) {
      throw new AuthError('builtin-group', `group ${groupId} ships with the schema and cannot be changed`)
    }
  }

  private requireFreeGroupName(db: DatabaseSync, name: string): void {
    if (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) !== undefined) {
      throw new AuthError('duplicate-group-name', `a group named "${name}" already exists`)
    }
  }
}

interface UserColumns {
  readonly id: string
  readonly email: string
  readonly email_verified_at: number | null
  readonly disabled_at: number | null
  readonly created_at: number
}

interface AuthSessionColumns {
  readonly id: string
  readonly user_id: string
  readonly expires_at: number
  readonly revoked_at: number | null
  readonly email: string
  readonly disabled_at: number | null
}

interface OneTimeTokenColumns {
  readonly id: string
  readonly user_id: string
  readonly expires_at: number
  readonly consumed_at: number | null
}

interface CodeColumns extends OneTimeTokenColumns {
  readonly attempts: number
  readonly digest: Uint8Array
  readonly salt: Uint8Array
}

interface GroupColumns {
  readonly id: string
  readonly name: string
  readonly builtin: number
  readonly created_at: number
}

interface AuditColumns {
  readonly id: string
  readonly ts: number
  readonly actor_user_id: string | null
  readonly event: string
  readonly subject: string | null
  readonly detail: string | null
  readonly ip: string | null
}

function toUserRecord(row: UserColumns): UserRecord {
  return {
    userId: UserId(row.id),
    email: row.email,
    emailVerifiedAt: nullable(row.email_verified_at),
    disabledAt: nullable(row.disabled_at),
    createdAt: row.created_at,
  }
}
