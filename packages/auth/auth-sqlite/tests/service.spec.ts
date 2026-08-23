import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ADMIN_GROUP_ID, AuthError, UserId } from '@deepseek-ai/dsh-auth'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import SqliteAuthService, {
  DEFAULT_SESSION_TTL_MS,
  resolveStoreOptions,
  type Config,
} from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function mount(config: Config): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = ctx.plugin(SqliteAuthService, config)
  const dispose = async (): Promise<void> => { await fiber.dispose() }
  cleanups.push(dispose)
  await fiber
  return { ctx, dispose }
}

describe('configuration', () => {
  it('applies the same defaults whether or not Schemastery normalized them', () => {
    const normalized = new SqliteAuthService.Config({ path: ':memory:' })
    expect(normalized).toMatchObject({
      journalMode: 'wal',
      sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    })
    expect(resolveStoreOptions({ path: ':memory:' }, () => 1, () => {})).toMatchObject({
      path: ':memory:',
      journalMode: 'wal',
      sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    })
    expect(resolveStoreOptions(
      { path: '/tmp/auth.db', journalMode: 'delete', sessionTtlMs: 5 },
      () => 1,
      () => {},
    )).toMatchObject({ journalMode: 'delete', sessionTtlMs: 5 })
  })

  it('refuses an empty path loudly', () => {
    expect(() => resolveStoreOptions({ path: '' }, () => 1, () => {}))
      .toThrow(AuthError)
    expect(() => resolveStoreOptions({ path: '' }, () => 1, () => {}))
      .toThrow(/non-empty path/)
  })
})

describe('mounted service', () => {
  it('serves the seam and forwards every operation to its database', async () => {
    const { ctx } = await mount({ path: ':memory:' })
    const auth = ctx.auth
    expect(auth).toBeInstanceOf(SqliteAuthService)

    const ada = await auth.createUser('ada@example.test', 'pw')
    const bob = await auth.createUser('bob@example.test', 'pw')
    expect(await auth.getUserByEmail('ada@example.test')).toMatchObject({ userId: ada })
    await auth.setPassword(bob, 'pw2')
    expect(await auth.verifyLogin('bob@example.test', 'pw2')).toEqual({ ok: true, userId: bob })

    expect((await auth.listUsers()).map(user => user.userId)).toEqual([ada, bob])
    expect(await auth.principalOf(ada)).toMatchObject({ kind: 'user', userId: ada, admin: false })
    await auth.setUserDisabled(bob, true)
    expect(await auth.principalOf(bob)).toBeUndefined()
    await auth.setUserDisabled(bob, false)
    expect(await auth.principalOf(bob)).toMatchObject({ userId: bob })

    const session = await auth.issueAuthSession(ada, { ip: '10.0.0.1' })
    expect(await auth.authenticateToken(session.token)).toMatchObject({ userId: ada })
    await auth.revokeSession(session.authSessionId)
    await auth.revokeAllSessions(ada)
    expect(await auth.authenticateToken(session.token)).toBeUndefined()

    const link = await auth.issueOneTimeToken('verify-email', ada, 60_000)
    expect(await auth.consumeOneTimeToken('verify-email', link.secret)).toBe(ada)
    const challenge = await auth.issueOneTimeToken('2fa', ada, 60_000)
    expect(await auth.verifyTotpCode(challenge.oneTimeTokenId, challenge.secret)).toBe(ada)

    const reviewers = await auth.createGroup('reviewers')
    await auth.renameGroup(reviewers, 'auditors')
    await auth.setMembers(reviewers, [ada])
    expect(await auth.listMembers(reviewers)).toEqual([ada])
    await auth.setRules(reviewers, [{ domain: 'tool', pattern: 'grep', effect: 'allow' }])
    expect(await auth.listRules(reviewers)).toHaveLength(1)
    expect(await auth.rulesFor(ada)).toHaveLength(1)
    expect((await auth.listGroups()).map(group => group.name)).toEqual(['admin', 'auditors'])
    expect((await auth.listGroups()).map(group => group.groupId)).toContain(ADMIN_GROUP_ID)
    await auth.deleteGroup(reviewers)

    const sessionId = 'agent-session-1' as SessionId
    const workspaceId = 'workspace-1' as WorkspaceId
    await auth.recordSessionOwner(sessionId, ada)
    await auth.recordWorkspaceOwner(workspaceId, ada)
    expect(await auth.ownerOfSession(sessionId)).toBe(ada)
    expect(await auth.ownerOfWorkspace(workspaceId)).toBe(ada)
    expect(await auth.listOwnedSessions(ada)).toEqual([sessionId])
    expect(await auth.listOwnedWorkspaces(ada)).toEqual([workspaceId])

    await auth.audit({ event: 'app.checked', actorUserId: ada })
    // A tie on the wall clock resolves to insertion order, so the record just
    // written is the first one back even when its millisecond holds others.
    expect((await auth.readAudit(1)).at(0)).toMatchObject({ event: 'app.checked' })
  }, 60_000)

  it('logs a warning through the plugin logger when a stored hash is unreadable', async () => {
    const { ctx } = await mount({ path: ':memory:' })
    const auth = ctx.auth
    const ada = await auth.createUser('ada@example.test', 'pw')
    // Corrupt the stored hash through the service's own database handle.
    const store = Reflect.get(auth, 'store') as { open: () => Promise<DatabaseSync> }
    const live = await store.open()
    live.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('corrupted', ada)
    // The built-in buffer exporter keeps the default INFO threshold, which is
    // below WARN; this sink raises it for the assertion below.
    const logged: string[] = []
    ctx.logger.exporter({ levels: { default: 3 }, export: message => logged.push(String(message.args[0])) })
    expect(await auth.verifyLogin('ada@example.test', 'pw')).toMatchObject({ ok: false })
    expect(logged.join('\n')).toContain('unreadable')
  })

  it('releases the database on disposal, and a second disposal is inert', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-service-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const path = join(dir, 'auth.db')
    const { ctx, dispose } = await mount({ path })
    const auth = ctx.auth
    await auth.createUser('ada@example.test', 'pw')
    await dispose()
    await expect(dispose()).resolves.toBeUndefined()
    // The medium survives its service and reopens cleanly.
    const reopened = new DatabaseSync(path)
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 1 })
    reopened.close()
  })

  it('fails at load when the medium was stamped by another build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-auth-service-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
    const path = join(dir, 'auth.db')
    const seeded = new DatabaseSync(path)
    seeded.exec('PRAGMA user_version = 42')
    seeded.close()
    const ctx = new Context()
    const fiber = ctx.plugin(SqliteAuthService, { path })
    await expect(fiber).rejects.toMatchObject({ code: 'schema-version' })
    await fiber.dispose()
  })

  it('refuses an unknown account through the mounted seam', async () => {
    const { ctx } = await mount({ path: ':memory:' })
    await expect(ctx.auth.issueAuthSession(UserId('missing'), {}))
      .rejects.toMatchObject({ code: 'unknown-subject' })
  })
})
