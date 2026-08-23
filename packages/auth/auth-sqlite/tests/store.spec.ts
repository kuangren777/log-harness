import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_GROUP_ID,
  AuthError,
  AuthSessionId,
  GroupId,
  OneTimeTokenId,
  UserId,
  evaluate,
  type PermissionRule,
} from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { AUTH_SCHEMA_VERSION } from '../src/schema.ts'
import {
  CODE_ATTEMPT_CAP,
  HOUR_MS,
  PASSWORD_ATTEMPTS_PER_EMAIL,
  PASSWORD_ATTEMPTS_PER_IP,
  PASSWORD_WINDOW_MS,
  RATE_EVENT_RETENTION_MS,
  RESET_PER_HOUR,
  TWO_FACTOR_MIN_INTERVAL_MS,
  TWO_FACTOR_PER_HOUR,
} from '../src/limits.ts'
import { AuthStore } from '../src/store.ts'

const EPOCH = 1_700_000_000_000
const TTL = 7 * 24 * 60 * 60_000

interface Harness {
  store: AuthStore
  warnings: string[]
  advance: (ms: number) => void
  at: () => number
}

const stores: AuthStore[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function freshPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-sqlite-'))
  dirs.push(dir)
  return join(dir, 'auth.db')
}

function harness(path = ':memory:', startAt = EPOCH): Harness {
  let clock = startAt
  const warnings: string[] = []
  const store = new AuthStore({
    path,
    journalMode: 'wal',
    sessionTtlMs: TTL,
    now: () => clock,
    warn: message => warnings.push(message),
  })
  stores.push(store)
  return { store, warnings, advance: (ms) => { clock += ms }, at: () => clock }
}

describe('opening the medium', () => {
  it('materializes the schema with an undeletable builtin admin group', async () => {
    const { store } = harness()
    const groups = await store.listGroups()
    expect(groups).toEqual([
      { groupId: ADMIN_GROUP_ID, name: 'admin', builtin: true, createdAt: EPOCH },
    ])
    await expect(store.deleteGroup(ADMIN_GROUP_ID)).rejects.toMatchObject({ code: 'builtin-group' })
    await expect(store.renameGroup(ADMIN_GROUP_ID, 'root')).rejects.toMatchObject({ code: 'builtin-group' })
    expect(await store.listGroups()).toHaveLength(1)
  })

  it('creates the database owner-only and stamps its schema version', async () => {
    const path = await freshPath()
    const { store } = harness(path)
    await store.open()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const db = new DatabaseSync(path)
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: AUTH_SCHEMA_VERSION })
    db.close()
  })

  it('refuses a medium another build stamped, and disposing it is inert', async () => {
    const path = await freshPath()
    const seeded = new DatabaseSync(path)
    seeded.exec('PRAGMA user_version = 99')
    seeded.close()
    const { store } = harness(path)
    await expect(store.open()).rejects.toBeInstanceOf(AuthError)
    await expect(store.open()).rejects.toMatchObject({ code: 'schema-version' })
    await expect(store.close()).resolves.toBeUndefined()
    await expect(store.close()).resolves.toBeUndefined()
  })

  it('reopens a medium it already materialized', async () => {
    const path = await freshPath()
    const first = harness(path)
    const userId = await first.store.createUser('a@example.test', 'pw')
    await first.store.close()
    const second = harness(path)
    expect(await second.store.getUserByEmail('a@example.test')).toMatchObject({ userId })
  })

  it('propagates a filesystem failure other than an existing database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-sqlite-'))
    dirs.push(dir)
    const { store } = harness(join(dir, 'x'.repeat(300)))
    await expect(store.open()).rejects.toMatchObject({ code: 'ENAMETOOLONG' })
  })

  it('closes once, however many times it is asked', async () => {
    const { store } = harness()
    await store.open()
    await store.close()
    await expect(store.close()).resolves.toBeUndefined()
  })
})

describe('accounts', () => {
  it('registers an account and finds it case-insensitively', async () => {
    const { store } = harness()
    const userId = await store.createUser('Ada@Example.test', 'pw')
    expect(await store.getUserByEmail('ada@EXAMPLE.TEST')).toEqual({
      userId,
      email: 'Ada@Example.test',
      emailVerifiedAt: undefined,
      disabledAt: undefined,
      createdAt: EPOCH,
    })
    expect(await store.getUserByEmail('nobody@example.test')).toBeUndefined()
  })

  it('refuses a second registration of one address in any case', async () => {
    const { store } = harness()
    await store.createUser('ada@example.test', 'pw')
    await expect(store.createUser('ADA@example.test', 'other')).rejects.toMatchObject({
      code: 'duplicate-email',
    })
  })

  it('reports verification and disablement timestamps once they are set', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const db = await store.open()
    db.prepare('UPDATE users SET email_verified_at = ?, disabled_at = ? WHERE id = ?')
      .run(EPOCH + 1, EPOCH + 2, userId)
    expect(await store.getUserByEmail('ada@example.test')).toMatchObject({
      emailVerifiedAt: EPOCH + 1,
      disabledAt: EPOCH + 2,
    })
  })

  it('replaces a password, and refuses to for an account that does not exist', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'old')
    await store.setPassword(userId, 'new')
    await expect(store.verifyLogin('ada@example.test', 'old')).resolves.toMatchObject({ ok: false })
    await expect(store.verifyLogin('ada@example.test', 'new')).resolves.toMatchObject({ ok: true, userId })
    await expect(store.setPassword(UserId('missing'), 'x')).rejects.toMatchObject({ code: 'unknown-subject' })
  })

  it('rosters every account oldest first', async () => {
    const { store, advance } = harness()
    const first = await store.createUser('first@example.test', 'pw')
    advance(1000)
    const second = await store.createUser('second@example.test', 'pw')
    expect((await store.listUsers()).map(user => user.userId)).toEqual([first, second])
    expect(await store.listUsers()).toMatchObject([
      { email: 'first@example.test', createdAt: EPOCH },
      { email: 'second@example.test', createdAt: EPOCH + 1000 },
    ])
  })

  it('disables an account, restores it, and audits only a real change', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    advance(5)
    await store.setUserDisabled(userId, true)
    expect(await store.getUserByEmail('ada@example.test')).toMatchObject({ disabledAt: EPOCH + 5 })
    await expect(store.verifyLogin('ada@example.test', 'pw')).resolves.toMatchObject({ ok: false })
    advance(5)
    // Idempotent: a repeat disable keeps the timestamp the block started at.
    await store.setUserDisabled(userId, true)
    expect(await store.getUserByEmail('ada@example.test')).toMatchObject({ disabledAt: EPOCH + 5 })
    await store.setUserDisabled(userId, false)
    expect(await store.getUserByEmail('ada@example.test')).toMatchObject({ disabledAt: undefined })
    await store.setUserDisabled(userId, false)
    await expect(store.verifyLogin('ada@example.test', 'pw')).resolves.toMatchObject({ ok: true, userId })
    const events = (await store.readAudit(50)).map(record => record.event)
    expect(events.filter(event => event === 'auth.user-disabled')).toHaveLength(1)
    expect(events.filter(event => event === 'auth.user-restored')).toHaveLength(1)
    await expect(store.setUserDisabled(UserId('missing'), true)).rejects.toMatchObject({ code: 'unknown-subject' })
  })

  it('resolves an account to its principal without a credential', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    expect(await store.principalOf(userId)).toEqual({
      kind: 'user', userId, email: 'ada@example.test', groups: [], admin: false,
    })
    await store.setMembers(ADMIN_GROUP_ID, [userId])
    expect(await store.principalOf(userId)).toMatchObject({ groups: [ADMIN_GROUP_ID], admin: true })
    await store.setUserDisabled(userId, true)
    expect(await store.principalOf(userId)).toBeUndefined()
    expect(await store.principalOf(UserId('missing'))).toBeUndefined()
  })
})

describe('password checks', () => {
  it('accepts the right password and refuses everything else identically', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    expect(await store.verifyLogin('ada@example.test', 'pw')).toEqual({ ok: true, userId })
    expect(await store.verifyLogin('ada@example.test', 'nope')).toEqual({ ok: false, lockedUntil: undefined })
    expect(await store.verifyLogin('nobody@example.test', 'pw')).toEqual({ ok: false, lockedUntil: undefined })
  })

  it('refuses a disabled account without saying so', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const db = await store.open()
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(EPOCH, userId)
    expect(await store.verifyLogin('ada@example.test', 'pw')).toEqual({ ok: false, lockedUntil: undefined })
  })

  it('warns an operator about an unreadable stored hash while still answering only "no"', async () => {
    const { store, warnings } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const db = await store.open()
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('corrupted', userId)
    expect(await store.verifyLogin('ada@example.test', 'pw')).toEqual({ ok: false, lockedUntil: undefined })
    expect(warnings).toEqual([expect.stringContaining(userId)])
    expect(warnings[0]).toContain('unreadable')
  })

  it('locks an address out after its attempt budget and releases it when the window slides', async () => {
    const { store, advance, at } = harness()
    await store.createUser('ada@example.test', 'pw')
    for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_EMAIL - 1; attempt += 1) {
      expect(await store.verifyLogin('ada@example.test', 'nope')).toMatchObject({ lockedUntil: undefined })
      advance(1)
    }
    const last = at()
    expect(await store.verifyLogin('ada@example.test', 'nope')).toEqual({
      ok: false,
      lockedUntil: last + PASSWORD_WINDOW_MS,
    })
    // The right password does not get through a lockout either.
    expect(await store.verifyLogin('ada@example.test', 'pw')).toEqual({
      ok: false,
      lockedUntil: last + PASSWORD_WINDOW_MS,
    })
    advance(PASSWORD_WINDOW_MS + 1)
    expect(await store.verifyLogin('ada@example.test', 'pw')).toMatchObject({ ok: true })
  }, 30_000)

  it('locks a client address out across the accounts it tried', async () => {
    const { store, advance } = harness()
    for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_IP; attempt += 1) {
      await store.verifyLogin(`user${attempt}@example.test`, 'nope', '10.0.0.9')
      advance(1)
    }
    const outcome = await store.verifyLogin('fresh@example.test', 'nope', '10.0.0.9')
    expect(outcome).toMatchObject({ ok: false })
    expect(outcome.ok ? undefined : outcome.lockedUntil).toBeGreaterThan(0)
    // Another client is unaffected by that address's lockout.
    expect(await store.verifyLogin('fresh@example.test', 'nope', '10.0.0.10'))
      .toEqual({ ok: false, lockedUntil: undefined })
  }, 60_000)

  it('keeps a lockout across a restart', async () => {
    const path = await freshPath()
    const first = harness(path)
    await first.store.createUser('ada@example.test', 'pw')
    for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_EMAIL; attempt += 1) {
      await first.store.verifyLogin('ada@example.test', 'nope')
    }
    await first.store.close()
    const second = harness(path)
    expect(await second.store.verifyLogin('ada@example.test', 'pw')).toMatchObject({
      ok: false,
      lockedUntil: EPOCH + PASSWORD_WINDOW_MS,
    })
  }, 30_000)

  it('drops attempt rows once they can no longer change an answer', async () => {
    const { store, advance } = harness()
    await store.verifyLogin('ada@example.test', 'nope')
    const db = await store.open()
    expect(db.prepare('SELECT COUNT(*) AS n FROM rate_events').get()).toMatchObject({ n: 1 })
    advance(RATE_EVENT_RETENTION_MS + 1)
    await store.verifyLogin('bob@example.test', 'nope')
    expect(db.prepare('SELECT COUNT(*) AS n FROM rate_events').get()).toMatchObject({ n: 1 })
  })
})

describe('login sessions', () => {
  it('issues a token that authenticates and refreshes its last-seen time', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueAuthSession(userId, { ip: '10.0.0.1', userAgent: 'probe/1' })
    expect(issued.expiresAt).toBe(EPOCH + TTL)
    advance(1_000)
    expect(await store.authenticateToken(issued.token)).toEqual({
      kind: 'user',
      userId,
      email: 'ada@example.test',
      groups: [],
      admin: false,
    })
    const db = await store.open()
    expect(db.prepare('SELECT last_seen_at, ip, user_agent FROM auth_sessions WHERE id = ?').get(issued.authSessionId))
      .toMatchObject({ last_seen_at: EPOCH + 1_000, ip: '10.0.0.1', user_agent: 'probe/1' })
  })

  it('records absent client facts as absent', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueAuthSession(userId, {})
    const db = await store.open()
    expect(db.prepare('SELECT ip, user_agent FROM auth_sessions WHERE id = ?').get(issued.authSessionId))
      .toMatchObject({ ip: null, user_agent: null })
  })

  it('marks a member of the builtin group as an admin', async () => {
    const { store } = harness()
    const userId = await store.createUser('root@example.test', 'pw')
    await store.setMembers(ADMIN_GROUP_ID, [userId])
    const issued = await store.issueAuthSession(userId, {})
    expect(await store.authenticateToken(issued.token)).toMatchObject({
      groups: [ADMIN_GROUP_ID],
      admin: true,
    })
  })

  it('confirms the address in the transaction that spends the link, once', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    expect((await store.getUserByEmail('ada@example.test'))?.emailVerifiedAt).toBeUndefined()
    const issued = await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    expect(await store.consumeOneTimeToken('verify-email', issued.secret)).toBe(userId)
    expect((await store.getUserByEmail('ada@example.test'))?.emailVerifiedAt).toBe(EPOCH)
    // A replayed link neither redeems again nor moves the confirmation.
    advance(HOUR_MS)
    expect(await store.consumeOneTimeToken('verify-email', issued.secret)).toBeUndefined()
    const second = await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    expect(await store.consumeOneTimeToken('verify-email', second.secret)).toBe(userId)
    expect((await store.getUserByEmail('ada@example.test'))?.emailVerifiedAt).toBe(EPOCH)
  })

  it('confirms no address when the redeemed link was a password reset', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('reset-password', userId, HOUR_MS)
    expect(await store.consumeOneTimeToken('reset-password', issued.secret)).toBe(userId)
    expect((await store.getUserByEmail('ada@example.test'))?.emailVerifiedAt).toBeUndefined()
  })

  it('spends the link and confirms the address together or not at all', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    const db = await store.open()
    // Fail the transaction after both writes, where a crash would otherwise
    // leave a spent link behind an unverified account.
    db.exec('DROP TABLE audit_log')
    await expect(store.consumeOneTimeToken('verify-email', issued.secret)).rejects.toThrow()
    expect(db.prepare('SELECT consumed_at FROM one_time_tokens WHERE user_id = ?').get(userId))
      .toMatchObject({ consumed_at: null })
    expect(db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(userId))
      .toMatchObject({ email_verified_at: null })
  })

  it('refuses to issue for an account that does not exist', async () => {
    const { store } = harness()
    await expect(store.issueAuthSession(UserId('missing'), {})).rejects.toMatchObject({
      code: 'unknown-subject',
    })
  })

  it('refuses an unknown, expired, revoked, or disabled-owner token', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    expect(await store.authenticateToken('not-a-token')).toBeUndefined()

    const revoked = await store.issueAuthSession(userId, {})
    await store.revokeSession(revoked.authSessionId)
    expect(await store.authenticateToken(revoked.token)).toBeUndefined()

    const disabledOwner = await store.issueAuthSession(userId, {})
    const db = await store.open()
    db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(EPOCH, userId)
    expect(await store.authenticateToken(disabledOwner.token)).toBeUndefined()
    db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(userId)

    const expiring = await store.issueAuthSession(userId, {})
    advance(TTL)
    expect(await store.authenticateToken(expiring.token)).toBeUndefined()
  })

  it('revokes one session, revokes them all, and treats an unknown revocation as done', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const first = await store.issueAuthSession(userId, {})
    const second = await store.issueAuthSession(userId, {})
    await store.revokeSession(AuthSessionId('missing'))
    await store.revokeSession(first.authSessionId)
    expect(await store.authenticateToken(first.token)).toBeUndefined()
    expect(await store.authenticateToken(second.token)).toMatchObject({ userId })
    await store.revokeAllSessions(userId)
    expect(await store.authenticateToken(second.token)).toBeUndefined()
    const events = (await store.readAudit(100)).map(record => record.event)
    expect(events).toContain('auth.session-revoked')
    expect(events).toContain('auth.sessions-revoked')
    expect(events.filter(event => event === 'auth.session-revoked')).toHaveLength(1)
  })
})

describe('single-use secrets', () => {
  it('issues and redeems a link token exactly once', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    expect(issued.expiresAt).toBe(EPOCH + HOUR_MS)
    expect(await store.consumeOneTimeToken('verify-email', issued.secret)).toBe(userId)
    expect(await store.consumeOneTimeToken('verify-email', issued.secret)).toBeUndefined()
  })

  it('refuses a token presented as the wrong kind, unknown, or expired', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    expect(await store.consumeOneTimeToken('reset-password', issued.secret)).toBeUndefined()
    expect(await store.consumeOneTimeToken('verify-email', 'made-up')).toBeUndefined()
    advance(HOUR_MS)
    expect(await store.consumeOneTimeToken('verify-email', issued.secret)).toBeUndefined()
  })

  it('refuses to issue for an account that does not exist', async () => {
    const { store } = harness()
    await expect(store.issueOneTimeToken('verify-email', UserId('missing'), HOUR_MS))
      .rejects.toMatchObject({ code: 'unknown-subject' })
  })

  it('verifies a second-factor code and consumes the challenge', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    expect(issued.secret).toMatch(/^\d{6}$/)
    expect(await store.verifyTotpCode(issued.oneTimeTokenId, issued.secret)).toBe(userId)
    expect(await store.verifyTotpCode(issued.oneTimeTokenId, issued.secret)).toBeUndefined()
  })

  it('kills a challenge at the attempt cap instead of letting it be ground down', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    const wrong = issued.secret === '000000' ? '111111' : '000000'
    for (let attempt = 1; attempt < CODE_ATTEMPT_CAP; attempt += 1) {
      expect(await store.verifyTotpCode(issued.oneTimeTokenId, wrong)).toBeUndefined()
    }
    expect(await store.verifyTotpCode(issued.oneTimeTokenId, wrong)).toBeUndefined()
    // The cap consumed the challenge, so even the right code no longer verifies.
    expect(await store.verifyTotpCode(issued.oneTimeTokenId, issued.secret)).toBeUndefined()
    const events = (await store.readAudit(100)).map(record => record.event)
    expect(events).toContain('auth.second-factor-exhausted')
    expect(events).toContain('auth.second-factor-failed')

    advance(TWO_FACTOR_MIN_INTERVAL_MS)
    const expiring = await store.issueOneTimeToken('2fa', userId, 1_000)
    advance(1_000)
    expect(await store.verifyTotpCode(expiring.oneTimeTokenId, expiring.secret)).toBeUndefined()
    expect(await store.verifyTotpCode(OneTimeTokenId('missing'), '000000')).toBeUndefined()
  })

  it('never verifies a code row whose salt was removed', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    const issued = await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    const db = await store.open()
    db.prepare('UPDATE one_time_tokens SET salt = NULL WHERE id = ?').run(issued.oneTimeTokenId)
    expect(await store.verifyTotpCode(issued.oneTimeTokenId, issued.secret)).toBeUndefined()
  })

  it('spaces second-factor challenges out and caps them hourly', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    await expect(store.issueOneTimeToken('2fa', userId, HOUR_MS)).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterMs: TWO_FACTOR_MIN_INTERVAL_MS,
    })
    for (let issued = 1; issued < TWO_FACTOR_PER_HOUR; issued += 1) {
      advance(TWO_FACTOR_MIN_INTERVAL_MS + 1)
      await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    }
    advance(TWO_FACTOR_MIN_INTERVAL_MS + 1)
    await expect(store.issueOneTimeToken('2fa', userId, HOUR_MS)).rejects.toMatchObject({
      code: 'rate-limited',
      retryAfterMs: HOUR_MS,
    })
  })

  it('caps password resets per address per hour', async () => {
    const { store, advance } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    for (let issued = 0; issued < RESET_PER_HOUR; issued += 1) {
      await store.issueOneTimeToken('reset-password', userId, HOUR_MS)
      advance(1)
    }
    await expect(store.issueOneTimeToken('reset-password', userId, HOUR_MS)).rejects.toMatchObject({
      code: 'rate-limited',
    })
    advance(HOUR_MS)
    expect((await store.issueOneTimeToken('reset-password', userId, HOUR_MS)).secret).toMatch(/^[\w-]+$/)
  })

  it('does not limit address confirmations, whose token grants nothing new', async () => {
    const { store } = harness()
    const userId = await store.createUser('ada@example.test', 'pw')
    for (let issued = 0; issued < 10; issued += 1) {
      await store.issueOneTimeToken('verify-email', userId, HOUR_MS)
    }
    const db = await store.open()
    expect(db.prepare("SELECT COUNT(*) AS n FROM one_time_tokens WHERE kind = 'verify-email'").get())
      .toMatchObject({ n: 10 })
  })
})

describe('groups, members, and rules', () => {
  it('creates, renames, and deletes a group', async () => {
    const { store } = harness()
    const groupId = await store.createGroup('reviewers')
    expect(await store.listGroups()).toHaveLength(2)
    await store.renameGroup(groupId, 'auditors')
    expect((await store.listGroups()).map(group => group.name)).toEqual(['admin', 'auditors'])
    await store.deleteGroup(groupId)
    expect(await store.listGroups()).toHaveLength(1)
  })

  it('refuses a duplicate name and an unknown group', async () => {
    const { store } = harness()
    const groupId = await store.createGroup('reviewers')
    await expect(store.createGroup('reviewers')).rejects.toMatchObject({ code: 'duplicate-group-name' })
    await store.createGroup('editors')
    await expect(store.renameGroup(groupId, 'editors')).rejects.toMatchObject({ code: 'duplicate-group-name' })
    await expect(store.deleteGroup(GroupId('missing'))).rejects.toMatchObject({ code: 'unknown-subject' })
    await expect(store.setRules(GroupId('missing'), [])).rejects.toMatchObject({ code: 'unknown-subject' })
    await expect(store.setMembers(GroupId('missing'), [])).rejects.toMatchObject({ code: 'unknown-subject' })
  })

  it('replaces membership wholesale and refuses an account that does not exist', async () => {
    const { store } = harness()
    const groupId = await store.createGroup('reviewers')
    const ada = await store.createUser('ada@example.test', 'pw')
    const bob = await store.createUser('bob@example.test', 'pw')
    await store.setMembers(groupId, [ada, bob])
    expect(await store.listMembers(groupId)).toEqual([ada, bob].sort())
    await store.setMembers(groupId, [bob])
    expect(await store.listMembers(groupId)).toEqual([bob])
    await expect(store.setMembers(groupId, [UserId('missing')])).rejects.toMatchObject({
      code: 'unknown-subject',
    })
    expect(await store.listMembers(groupId)).toEqual([bob])
  })

  it('replaces rules wholesale and unions them across a user’s groups', async () => {
    const { store } = harness()
    const readers = await store.createGroup('readers')
    const blocked = await store.createGroup('blocked')
    const ada = await store.createUser('ada@example.test', 'pw')
    await store.setMembers(readers, [ada])
    await store.setMembers(blocked, [ada])
    const allowAll: PermissionRule[] = [{ domain: 'tool', pattern: '*', effect: 'allow' }]
    const denyBash: PermissionRule[] = [{ domain: 'tool', pattern: 'bash', effect: 'deny' }]
    await store.setRules(readers, allowAll)
    await store.setRules(blocked, denyBash)
    expect(await store.listRules(readers)).toEqual(allowAll)
    const rules = await store.rulesFor(ada)
    expect(rules).toHaveLength(2)
    expect(evaluate(rules, 'tool', 'grep')).toBe(true)
    expect(evaluate(rules, 'tool', 'bash')).toBe(false)

    await store.setRules(readers, [])
    expect(await store.listRules(readers)).toEqual([])
    expect(await store.rulesFor(ada)).toEqual(denyBash)
    expect(await store.rulesFor(UserId('missing'))).toEqual([])
  })

  it('takes a group’s memberships and rules down with it', async () => {
    const { store } = harness()
    const groupId = await store.createGroup('reviewers')
    const ada = await store.createUser('ada@example.test', 'pw')
    await store.setMembers(groupId, [ada])
    await store.setRules(groupId, [{ domain: 'skill', pattern: '*', effect: 'allow' }])
    await store.deleteGroup(groupId)
    expect(await store.rulesFor(ada)).toEqual([])
    expect(await store.listMembers(groupId)).toEqual([])
  })
})

describe('ownership', () => {
  it('records, transfers, and lists owned sessions and workspaces', async () => {
    const { store, advance } = harness()
    const ada = await store.createUser('ada@example.test', 'pw')
    const bob = await store.createUser('bob@example.test', 'pw')
    const first = 'session-1' as SessionId
    const second = 'session-2' as SessionId
    const space = 'workspace-1' as WorkspaceId

    await store.recordSessionOwner(first, ada)
    advance(10)
    await store.recordSessionOwner(second, ada)
    await store.recordWorkspaceOwner(space, ada)
    expect(await store.ownerOfSession(first)).toBe(ada)
    expect(await store.ownerOfWorkspace(space)).toBe(ada)
    expect(await store.listOwnedSessions(ada)).toEqual([second, first])
    expect(await store.listOwnedWorkspaces(ada)).toEqual([space])

    await store.recordSessionOwner(first, bob)
    await store.recordWorkspaceOwner(space, bob)
    expect(await store.ownerOfSession(first)).toBe(bob)
    expect(await store.listOwnedSessions(ada)).toEqual([second])
    expect(await store.listOwnedWorkspaces(ada)).toEqual([])
  })

  it('answers for objects recorded before auth was mounted, and refuses an unknown owner', async () => {
    const { store } = harness()
    expect(await store.ownerOfSession('unrecorded' as SessionId)).toBeUndefined()
    expect(await store.ownerOfWorkspace('unrecorded' as WorkspaceId)).toBeUndefined()
    expect(await store.listOwnedSessions(UserId('missing'))).toEqual([])
    expect(await store.listOwnedWorkspaces(UserId('missing'))).toEqual([])
    await expect(store.recordSessionOwner('s' as SessionId, UserId('missing'))).rejects.toMatchObject({
      code: 'unknown-subject',
    })
    await expect(store.recordWorkspaceOwner('w' as WorkspaceId, UserId('missing'))).rejects.toMatchObject({
      code: 'unknown-subject',
    })
  })
})

describe('audit log', () => {
  it('appends a caller record and reads it back with only the fields it carried', async () => {
    const { store, advance } = harness()
    const ada = await store.createUser('ada@example.test', 'pw')
    advance(1)
    await store.audit({ event: 'app.custom', actorUserId: ada, subject: 'thing', detail: 'why', ip: '10.0.0.1' })
    advance(1)
    await store.audit({ event: 'app.bare' })
    const [bare, custom] = await store.readAudit(2)
    expect(custom).toMatchObject({
      event: 'app.custom',
      actorUserId: ada,
      subject: 'thing',
      detail: 'why',
      ip: '10.0.0.1',
      ts: EPOCH + 1,
    })
    expect(custom?.auditId).toMatch(/\w/)
    expect(bare).toMatchObject({ ts: EPOCH + 2, event: 'app.bare' })
    expect(Object.keys(bare ?? {}).sort()).toEqual(['auditId', 'event', 'ts'])
  })

  it('holds no password, code, or token after a complete flow', async () => {
    const { store, advance } = harness()
    const password = 'a-very-distinctive-password'
    const userId = await store.createUser('ada@example.test', password)
    await store.verifyLogin('ada@example.test', password, '10.0.0.1')
    await store.verifyLogin('ada@example.test', 'wrong', '10.0.0.1')
    const session = await store.issueAuthSession(userId, { ip: '10.0.0.1', userAgent: 'probe/1' })
    await store.authenticateToken(session.token)
    const link = await store.issueOneTimeToken('reset-password', userId, HOUR_MS)
    await store.consumeOneTimeToken('reset-password', link.secret)
    const challenge = await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    await store.verifyTotpCode(challenge.oneTimeTokenId, challenge.secret)
    advance(TWO_FACTOR_MIN_INTERVAL_MS + 1)
    const failing = await store.issueOneTimeToken('2fa', userId, HOUR_MS)
    await store.verifyTotpCode(failing.oneTimeTokenId, failing.secret === '000000' ? '111111' : '000000')
    await store.setPassword(userId, `${password}-2`)
    await store.revokeSession(session.authSessionId)

    const records = await store.readAudit(1_000)
    expect(records.length).toBeGreaterThan(8)
    const secrets = [password, `${password}-2`, session.token, link.secret, challenge.secret, failing.secret]

    // Provider-authored text: event names, counts, and the client address.
    // A six-digit code needs this narrow surface rather than a scan of the
    // whole serialized log, where random hexadecimal ids and the millisecond
    // timestamps contain digit runs of their own.
    const authored = records.map(record => [record.event, record.detail ?? '', record.ip ?? ''].join('|')).join('\n')
    for (const secret of secrets) expect(authored).not.toContain(secret)

    // Every `subject` is an identifier the caller already holds, so the column
    // cannot be smuggling a secret in id position.
    const known = [userId, session.authSessionId, link.oneTimeTokenId, challenge.oneTimeTokenId,
      failing.oneTimeTokenId, 'ada@example.test']
    for (const record of records) {
      if (record.subject !== undefined) expect(known).toContain(record.subject)
      if (record.actorUserId !== undefined) expect(record.actorUserId).toBe(userId)
    }

    // The high-entropy secrets appear nowhere in the database at all.
    const db = await store.open()
    const dumped = ['audit_log', 'users', 'auth_sessions', 'one_time_tokens']
      .map(table => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).join('\n')
    for (const secret of [password, `${password}-2`, session.token, link.secret]) {
      expect(dumped).not.toContain(secret)
    }
  }, 30_000)
})
