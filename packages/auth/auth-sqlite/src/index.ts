/**
 * SQLite provider for the auth capability seam: one database file holds
 * accounts, groups and rules, login sessions, single-use secrets, ownership,
 * durable rate-limit accounting, and the audit log.
 *
 * The database is separate from the session store on purpose. Access control
 * outlives any one conversation, has to be readable before a session is
 * opened, and must not put its schema changes behind `SESSION_FORMAT_VERSION`.
 * @module @deepseek-ai/dsh-auth-sqlite
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AuthError,
  AuthService,
  type AuditEntry,
  type AuditRecord,
  type AuthSessionId,
  type AuthSessionMeta,
  type GroupId,
  type GroupRecord,
  type IssuedAuthSession,
  type IssuedOneTimeToken,
  type LoginOutcome,
  type OneTimeTokenId,
  type OneTimeTokenKind,
  type PermissionRule,
  type Principal,
  type UserId,
  type UserRecord,
} from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { JournalMode } from './schema.ts'
import { AuthStore, type AuthStoreOptions } from './store.ts'

export { AUTH_SCHEMA_VERSION, type JournalMode } from './schema.ts'
export { AuthStore, type AuthStoreOptions } from './store.ts'
export {
  CODE_ATTEMPT_CAP,
  PASSWORD_ATTEMPTS_PER_EMAIL,
  PASSWORD_ATTEMPTS_PER_IP,
  PASSWORD_WINDOW_MS,
  RESET_PER_HOUR,
  TWO_FACTOR_MIN_INTERVAL_MS,
  TWO_FACTOR_PER_HOUR,
} from './limits.ts'

/** Default login-session lifetime: thirty days, the usual "stay signed in" window. */
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000

/** Plugin configuration. */
export interface Config {
  /**
   * SQLite database file, or `:memory:` for an in-process database. Missing
   * directories and databases are created owner-only; existing modes are
   * preserved. The file mode protects the contents, not the directory entry.
   */
  path: string
  /**
   * `journal_mode` pragma. `wal` (the default) suits local disks; a
   * rollback-journal mode suits filesystems where WAL's shared-memory files do
   * not work. Non-durable modes are not offered.
   */
  journalMode?: JournalMode
  /** Login-session lifetime in milliseconds; defaults to thirty days. */
  sessionTtlMs?: number
}

/**
 * Resolve plugin configuration into complete store parameters. Defaulting
 * happens here and nowhere else, and a `path` this provider cannot use is
 * refused at load rather than at the first login.
 * @param config - the plugin's configuration.
 * @param now - clock for every stored timestamp and window decision.
 * @param warn - operator-facing diagnostics sink.
 * @returns the fully resolved store parameters.
 * @throws AuthError `invalid-config` when `path` is empty.
 */
export function resolveStoreOptions(
  config: Config,
  now: () => number,
  warn: (message: string) => void,
): AuthStoreOptions {
  if (config.path.length === 0) {
    throw new AuthError('invalid-config', 'auth-sqlite requires a non-empty path (use ":memory:" for an in-process database)')
  }
  return {
    path: config.path,
    journalMode: config.journalMode ?? 'wal',
    sessionTtlMs: config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    now,
    warn,
  }
}

/** SQLite-backed {@link AuthService}. Every method delegates to the store that owns the database. */
export class SqliteAuthService extends AuthService {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    sessionTtlMs: z.number().step(1).min(1).default(DEFAULT_SESSION_TTL_MS),
  })

  private readonly store: AuthStore

  /**
   * @param ctx - the plugin context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Programmatic construction may bypass Schemastery normalization; resolve
    // the same defaults in one explicit step either way.
    this.store = new AuthStore(resolveStoreOptions(config, Date.now, (message) => {
      this.ctx.logger.warn(message)
    }))
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    // Yield the disposer before awaiting the open, so a medium that rejects
    // still has its half-built connection released.
    yield () => this.store.close()
    await this.store.open()
  }

  createUser(email: string, password: string): Promise<UserId> {
    return this.store.createUser(email, password)
  }

  getUserByEmail(email: string): Promise<UserRecord | undefined> {
    return this.store.getUserByEmail(email)
  }

  setPassword(userId: UserId, password: string): Promise<void> {
    return this.store.setPassword(userId, password)
  }

  listUsers(): Promise<readonly UserRecord[]> {
    return this.store.listUsers()
  }

  setUserDisabled(userId: UserId, disabled: boolean): Promise<void> {
    return this.store.setUserDisabled(userId, disabled)
  }

  principalOf(userId: UserId): Promise<Principal | undefined> {
    return this.store.principalOf(userId)
  }

  verifyLogin(email: string, password: string, ip?: string): Promise<LoginOutcome> {
    return this.store.verifyLogin(email, password, ip)
  }

  issueAuthSession(userId: UserId, meta: AuthSessionMeta): Promise<IssuedAuthSession> {
    return this.store.issueAuthSession(userId, meta)
  }

  authenticateToken(token: string): Promise<Principal | undefined> {
    return this.store.authenticateToken(token)
  }

  revokeSession(authSessionId: AuthSessionId): Promise<void> {
    return this.store.revokeSession(authSessionId)
  }

  revokeAllSessions(userId: UserId): Promise<void> {
    return this.store.revokeAllSessions(userId)
  }

  issueOneTimeToken(kind: OneTimeTokenKind, userId: UserId, ttlMs: number): Promise<IssuedOneTimeToken> {
    return this.store.issueOneTimeToken(kind, userId, ttlMs)
  }

  consumeOneTimeToken(kind: OneTimeTokenKind, token: string): Promise<UserId | undefined> {
    return this.store.consumeOneTimeToken(kind, token)
  }

  verifyTotpCode(oneTimeTokenId: OneTimeTokenId, code: string): Promise<UserId | undefined> {
    return this.store.verifyTotpCode(oneTimeTokenId, code)
  }

  listGroups(): Promise<readonly GroupRecord[]> {
    return this.store.listGroups()
  }

  createGroup(name: string): Promise<GroupId> {
    return this.store.createGroup(name)
  }

  deleteGroup(groupId: GroupId): Promise<void> {
    return this.store.deleteGroup(groupId)
  }

  renameGroup(groupId: GroupId, name: string): Promise<void> {
    return this.store.renameGroup(groupId, name)
  }

  setMembers(groupId: GroupId, userIds: readonly UserId[]): Promise<void> {
    return this.store.setMembers(groupId, userIds)
  }

  listMembers(groupId: GroupId): Promise<readonly UserId[]> {
    return this.store.listMembers(groupId)
  }

  setRules(groupId: GroupId, rules: readonly PermissionRule[]): Promise<void> {
    return this.store.setRules(groupId, rules)
  }

  listRules(groupId: GroupId): Promise<readonly PermissionRule[]> {
    return this.store.listRules(groupId)
  }

  rulesFor(userId: UserId): Promise<readonly PermissionRule[]> {
    return this.store.rulesFor(userId)
  }

  recordSessionOwner(sessionId: SessionId, userId: UserId): Promise<void> {
    return this.store.recordSessionOwner(sessionId, userId)
  }

  ownerOfSession(sessionId: SessionId): Promise<UserId | undefined> {
    return this.store.ownerOfSession(sessionId)
  }

  listOwnedSessions(userId: UserId): Promise<readonly SessionId[]> {
    return this.store.listOwnedSessions(userId)
  }

  recordWorkspaceOwner(workspaceId: WorkspaceId, userId: UserId): Promise<void> {
    return this.store.recordWorkspaceOwner(workspaceId, userId)
  }

  ownerOfWorkspace(workspaceId: WorkspaceId): Promise<UserId | undefined> {
    return this.store.ownerOfWorkspace(workspaceId)
  }

  listOwnedWorkspaces(userId: UserId): Promise<readonly WorkspaceId[]> {
    return this.store.listOwnedWorkspaces(userId)
  }

  audit(entry: AuditEntry): Promise<void> {
    return this.store.audit(entry)
  }

  readAudit(limit: number): Promise<readonly AuditRecord[]> {
    return this.store.readAudit(limit)
  }
}

export default SqliteAuthService
