import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_GROUP_ID } from '@deepseek-ai/dsh-auth'
import {
  AUTH_DB_FILE,
  BOOTSTRAP_AUDIT_EVENT,
  BOOTSTRAP_PASSWORD_ENV,
  MIN_PASSWORD_LENGTH,
  processBootstrapIo,
  runAuthBootstrap,
  type AuthBootstrapIo,
} from '../src/auth-cli.ts'

const PASSWORD = 'correct-horse-battery-staple'
const EMAIL = 'admin@example.com'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-auth-bootstrap-'))
  homes.push(home)
  return home
}

/** Captured output plus the injected IO the command ran against. */
interface Harness {
  readonly io: AuthBootstrapIo
  readonly out: string[]
  readonly err: string[]
  /** Everything the command printed, on either stream. */
  readonly printed: () => string
}

function harness(overrides: Partial<AuthBootstrapIo> = {}): Harness {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    printed: () => [...out, ...err].join(''),
    io: {
      env: {},
      write: text => void out.push(text),
      writeError: text => void err.push(text),
      interactive: false,
      readPassword: () => Promise.reject(new Error('readPassword must not be called')),
      ...overrides,
    },
  }
}

/** Read one table's rows straight from the database the command wrote. */
function rows(home: string, sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(join(home, AUTH_DB_FILE))
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

/** Every value the database holds, as one string, for a secret scan. */
function dump(home: string): string {
  return JSON.stringify([
    rows(home, 'SELECT * FROM users'),
    rows(home, 'SELECT * FROM memberships'),
    rows(home, 'SELECT * FROM audit_log'),
  ])
}

describe('dsh auth bootstrap', () => {
  it('creates the first administrator, its membership, and its audit record', async () => {
    const home = await tempHome()
    const { io, out, err } = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).resolves.toBe(0)

    expect(err).toEqual([])
    expect(out.join('')).toContain(EMAIL)
    expect(out.join('')).toContain(join(home, AUTH_DB_FILE))
    const users = rows(home, 'SELECT id, email, email_verified_at FROM users')
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ email: EMAIL, email_verified_at: null })
    expect(rows(home, 'SELECT group_id FROM memberships')).toEqual([{ group_id: ADMIN_GROUP_ID }])
    expect(rows(home, 'SELECT builtin FROM groups WHERE id = ?'.replace('?', `'${ADMIN_GROUP_ID}'`)))
      .toEqual([{ builtin: 1 }])
    const bootstrapRecords = rows(home, 'SELECT event, actor_user_id, detail FROM audit_log')
      .filter(record => record['event'] === BOOTSTRAP_AUDIT_EVENT)
    expect(bootstrapRecords).toEqual([{
      event: BOOTSTRAP_AUDIT_EVENT,
      actor_user_id: users[0]!['id'],
      detail: 'created the first administrator account',
    }])
  })

  it('refuses a second bootstrap and leaves the store untouched', async () => {
    const home = await tempHome()
    const first = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })
    await expect(runAuthBootstrap({ email: EMAIL, home }, first.io)).resolves.toBe(0)
    const before = dump(home)

    const second = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })
    await expect(runAuthBootstrap({ email: 'second@example.com', home }, second.io)).resolves.toBe(1)

    expect(second.out).toEqual([])
    expect(second.err.join('')).toContain('already has 1 administrator account(s)')
    expect(dump(home)).toBe(before)
  })

  it('reads the password from the terminal when the environment supplies none', async () => {
    const home = await tempHome()
    const readPassword = vi.fn(() => Promise.resolve(PASSWORD))
    const { io } = harness({ interactive: true, readPassword })

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).resolves.toBe(0)

    expect(readPassword).toHaveBeenCalledTimes(1)
    expect(rows(home, 'SELECT email FROM users')).toEqual([{ email: EMAIL }])
  })

  it('names both password sources when neither is available', async () => {
    const home = await tempHome()
    const { io, err } = harness()

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).resolves.toBe(1)

    expect(err.join('')).toContain('run this command on a terminal')
    expect(err.join('')).toContain(BOOTSTRAP_PASSWORD_ENV)
    expect(rows(home, 'SELECT email FROM users')).toEqual([])
  })

  it('rejects a password shorter than the fixed minimum from either source', async () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
    const fromEnv = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: short } })
    await expect(runAuthBootstrap({ email: EMAIL, home: await tempHome() }, fromEnv.io)).resolves.toBe(1)
    expect(fromEnv.err.join('')).toContain(`shorter than ${MIN_PASSWORD_LENGTH} characters`)

    // A defined-but-empty variable is a broken deployment script, so it is
    // rejected rather than silently falling through to the prompt.
    const empty = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: '' }, interactive: true })
    await expect(runAuthBootstrap({ email: EMAIL, home: await tempHome() }, empty.io)).resolves.toBe(1)
    expect(empty.err.join('')).toContain(`shorter than ${MIN_PASSWORD_LENGTH} characters`)

    const fromTerminal = harness({ interactive: true, readPassword: () => Promise.resolve(short) })
    const home = await tempHome()
    await expect(runAuthBootstrap({ email: EMAIL, home }, fromTerminal.io)).resolves.toBe(1)
    expect(rows(home, 'SELECT email FROM users')).toEqual([])
  })

  it('rejects an empty or malformed address before opening the database', async () => {
    for (const email of ['', '   ', 'admin', 'admin@', '@example.com', 'a b@example.com', 'admin@example']) {
      const home = await tempHome()
      const { io, err } = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })
      await expect(runAuthBootstrap({ email, home }, io)).resolves.toBe(1)
      expect(err.join('')).toContain('--email')
      // Nothing was opened, so the home holds no database file at all.
      expect(existsSync(join(home, AUTH_DB_FILE))).toBe(false)
    }
  })

  it('trims the address it stores', async () => {
    const home = await tempHome()
    const { io } = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })

    await expect(runAuthBootstrap({ email: `  ${EMAIL}\t`, home }, io)).resolves.toBe(0)

    expect(rows(home, 'SELECT email FROM users')).toEqual([{ email: EMAIL }])
  })

  it('never leaks the password to output or into the database', async () => {
    const home = await tempHome()
    const { io, printed } = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).resolves.toBe(0)

    expect(printed()).not.toContain(PASSWORD)
    expect(dump(home)).not.toContain(PASSWORD)

    // The refusal paths carry the password through the same code and must not
    // print it either.
    const short = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: 'tinysecret' } })
    await expect(runAuthBootstrap({ email: 'other@example.com', home: await tempHome() }, short.io)).resolves.toBe(1)
    expect(short.printed()).not.toContain('tinysecret')
  })

  it('promotes an existing account without touching its password', async () => {
    const home = await tempHome()
    const seed = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })
    await expect(runAuthBootstrap({ email: EMAIL, home }, seed.io)).resolves.toBe(0)
    // Undo the membership so the store has an account but no administrator,
    // which is the state promotion exists for.
    const db = new DatabaseSync(join(home, AUTH_DB_FILE))
    db.prepare('DELETE FROM memberships').run()
    db.close()
    const hashBefore = rows(home, 'SELECT password_hash FROM users')[0]!['password_hash']

    // No password source at all: promotion must not ask for one.
    const promote = harness()
    await expect(runAuthBootstrap({ email: EMAIL, home }, promote.io)).resolves.toBe(0)

    expect(promote.out.join('')).toContain('password is unchanged')
    expect(rows(home, 'SELECT password_hash FROM users')[0]!['password_hash']).toBe(hashBefore)
    expect(rows(home, 'SELECT user_id FROM memberships')).toHaveLength(1)
    expect(rows(home, 'SELECT detail FROM audit_log WHERE event = ?'.replace('?', `'${BOOTSTRAP_AUDIT_EVENT}'`))
      .map(record => record['detail']))
      .toEqual(['created the first administrator account', 'promoted an existing account to administrator'])
  })

  it('resolves the harness home from $DSH_HOME when --home is absent', async () => {
    const home = await tempHome()
    const { io } = harness({ env: { DSH_HOME: home, [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })

    await expect(runAuthBootstrap({ email: EMAIL }, io)).resolves.toBe(0)

    expect(rows(home, 'SELECT email FROM users')).toEqual([{ email: EMAIL }])
  })

  it('reports a database written by another build instead of rewriting it', async () => {
    const home = await tempHome()
    const db = new DatabaseSync(join(home, AUTH_DB_FILE))
    db.exec('PRAGMA user_version = 9999')
    db.close()
    const { io, err } = harness({ env: { [BOOTSTRAP_PASSWORD_ENV]: PASSWORD } })

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).resolves.toBe(1)

    expect(err.join('')).toContain('schema version 9999')
  })

  it('propagates a failure that is not a refusal', async () => {
    const home = await tempHome()
    const { io } = harness({ interactive: true, readPassword: () => Promise.reject(new Error('terminal closed')) })

    await expect(runAuthBootstrap({ email: EMAIL, home }, io)).rejects.toThrow('terminal closed')
  })
})

describe('processBootstrapIo', () => {
  it('binds the process environment, both output streams, and the terminal check', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const io = processBootstrapIo()

    expect(io.env).toBe(process.env)
    expect(io.interactive).toBe(process.stdin.isTTY)
    io.write('out\n')
    io.writeError('err\n')

    expect(stdout).toHaveBeenCalledWith('out\n')
    expect(stderr).toHaveBeenCalledWith('err\n')
  })

  it('reads a terminal password without echoing it', async () => {
    const stdin = new PassThrough()
    Object.defineProperty(stdin, 'isTTY', { value: true })
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((text) => {
      written.push(String(text))
      return true
    })
    try {
      const pending = processBootstrapIo().readPassword()
      stdin.write(`${PASSWORD}\n`)
      await expect(pending).resolves.toBe(PASSWORD)
    } finally {
      Object.defineProperty(process, 'stdin', original)
    }

    expect(written.join('')).toContain('not echoed')
    expect(written.join('')).not.toContain(PASSWORD)
  })
})
