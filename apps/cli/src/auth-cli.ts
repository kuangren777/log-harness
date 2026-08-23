/**
 * `dsh auth bootstrap --email <address>` — create the deployment's first
 * administrator account.
 *
 * The command opens `<harness home>/auth.db` through the SQLite auth provider
 * directly: no Cordis application boots, no service is mounted, and no RPC
 * surface is registered. That is the security design, not an optimization.
 * Bootstrap runs at the one moment when no account exists, so no credential
 * could authorize it; the only thing that can stand in for authorization is
 * write access to the harness home, which is exactly what a local process has
 * and a network peer does not. Keeping the operation unreachable from the
 * remote BFF means there is no code path for an unauthenticated caller to
 * reach it at all, rather than a permission check that has to be right.
 * @module @deepseek-ai/dsh/auth-cli
 */

import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { ADMIN_GROUP_ID, AuthError, type UserId } from '@deepseek-ai/dsh-auth'
import { AuthStore, DEFAULT_SESSION_TTL_MS } from '@deepseek-ai/dsh-auth-sqlite'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const NAME = 'dsh'

/** File under the harness home holding every auth record. */
export const AUTH_DB_FILE = 'auth.db'

/** Environment variable supplying the bootstrap password without a terminal. */
export const BOOTSTRAP_PASSWORD_ENV = 'DSH_BOOTSTRAP_PASSWORD'

/**
 * Shortest accepted bootstrap password. Fixed rather than configurable: this
 * account holds every administrative right in the deployment, and a length a
 * deployment could lower would be lowered by the deployment least able to
 * afford it.
 */
export const MIN_PASSWORD_LENGTH = 12

/** Audit event this command writes for the account it makes an administrator. */
export const BOOTSTRAP_AUDIT_EVENT = 'auth.bootstrap'

/** What the launcher resolved from `dsh auth bootstrap`. */
export interface AuthBootstrapRequest {
  /** The address the first administrator account is created for. */
  readonly email: string
  /** Harness home override; absent resolves `$DSH_HOME`, then `~/.dsh`. */
  readonly home?: string
}

/**
 * Everything the bootstrap reads or writes outside the auth database, injected
 * so a test drives the command without a terminal or a real process
 * environment.
 */
export interface AuthBootstrapIo {
  /** Environment read for `DSH_BOOTSTRAP_PASSWORD` and `$DSH_HOME`. */
  readonly env: Record<string, string | undefined>
  /** Sink for the one success line. */
  readonly write: (text: string) => void
  /** Sink for refusals, diagnostics, and the password prompt. */
  readonly writeError: (text: string) => void
  /** Whether a terminal is attached to read a password from. */
  readonly interactive: boolean
  /** Read a password from the terminal without echoing it; only called when {@link interactive}. */
  readonly readPassword: () => Promise<string>
}

/**
 * Read a password from the real terminal with echo suppressed: readline writes
 * its line editing to a sink that discards everything, so neither the typed
 * characters nor a replayed line reaches the terminal. The prompt itself goes
 * to stderr, leaving stdout carrying only the command's result.
 * @returns the entered line, without its terminator.
 */
async function readPasswordFromTerminal(): Promise<string> {
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  process.stderr.write(`${NAME}: password for the first administrator (not echoed): `)
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true })
  try {
    return await reader.question('')
  } finally {
    reader.close()
    process.stderr.write('\n')
  }
}

/**
 * The process-backed IO the launcher runs the bootstrap with.
 * @returns environment, output sinks, and the terminal password reader of the current process.
 */
export function processBootstrapIo(): AuthBootstrapIo {
  return {
    env: process.env,
    write: text => void process.stdout.write(text),
    writeError: text => void process.stderr.write(text),
    interactive: process.stdin.isTTY,
    readPassword: readPasswordFromTerminal,
  }
}

/**
 * Whether an address is worth attempting to deliver to: one `@`, non-empty
 * sides, a dotted domain, and no whitespace anywhere. Deliberately not a
 * full RFC 5322 grammar — this rejects the typo an operator makes at 3am, and
 * the address's real validity is decided by the verification mail.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** A refusal the operator can act on, reported as a message and a nonzero exit. */
class BootstrapRefusal extends Error {}

/**
 * Resolve the password from its two sources. `DSH_BOOTSTRAP_PASSWORD` wins
 * whenever it is defined, including when it is empty: a defined-but-empty
 * variable is a broken deployment script, and silently falling through to a
 * prompt would hide it behind an interactive command that appears to work.
 * @param io - the injected environment, terminal, and output sinks.
 * @returns the plaintext password.
 * @throws BootstrapRefusal when no source supplies one, or the password is too short.
 */
async function resolvePassword(io: AuthBootstrapIo): Promise<string> {
  const fromEnv = io.env[BOOTSTRAP_PASSWORD_ENV]
  if (fromEnv === undefined && !io.interactive) {
    throw new BootstrapRefusal(
      `no password source: run this command on a terminal, or set ${BOOTSTRAP_PASSWORD_ENV}`,
    )
  }
  const password = fromEnv ?? await io.readPassword()
  if (password.length < MIN_PASSWORD_LENGTH) {
    // The length is the only fact stated; the value never reaches a message.
    throw new BootstrapRefusal(`password is shorter than ${MIN_PASSWORD_LENGTH} characters`)
  }
  return password
}

/**
 * Make one account the deployment's first administrator, creating it when the
 * address is unknown.
 *
 * An account that already has the address is promoted rather than recreated,
 * and its password is left alone: the store has no administrator, so a
 * deployment whose only account was created some other way would otherwise
 * have no way to reach one, and rewriting a password nobody asked to change
 * would turn a recovery command into an account takeover.
 * @param store - the opened auth database.
 * @param email - the validated address.
 * @param io - the injected environment, terminal, and output sinks.
 * @returns the administrator's account id and whether this call created it.
 * @throws BootstrapRefusal when an administrator already exists or no password is available.
 */
async function promoteFirstAdmin(
  store: AuthStore,
  email: string,
  io: AuthBootstrapIo,
): Promise<{ userId: UserId; created: boolean }> {
  const admins = await store.listMembers(ADMIN_GROUP_ID)
  if (admins.length > 0) {
    throw new BootstrapRefusal(
      `this deployment already has ${admins.length} administrator account(s); bootstrap only creates the first one`,
    )
  }
  const existing = await store.getUserByEmail(email)
  if (existing !== undefined) return { userId: existing.userId, created: false }
  // Read the password only on the creating path: promotion does not set one,
  // so demanding a terminal for it would refuse a recoverable deployment.
  const password = await resolvePassword(io)
  // createUser leaves `email_verified_at` unset, which is the state this
  // command wants: the first login sends the verification mail.
  return { userId: await store.createUser(email, password), created: true }
}

/**
 * Run one `dsh auth bootstrap` invocation.
 * @param request - the address to make an administrator and the harness home to do it in.
 * @param io - the environment, output sinks, and password reader to run against.
 * @returns the process exit code: 0 on success, 1 for every refusal.
 */
export async function runAuthBootstrap(
  request: AuthBootstrapRequest,
  io: AuthBootstrapIo,
): Promise<number> {
  const email = request.email.trim()
  if (email.length === 0) {
    io.writeError(`${NAME}: auth bootstrap: --email is empty\n`)
    return 1
  }
  if (!EMAIL_PATTERN.test(email)) {
    io.writeError(`${NAME}: auth bootstrap: --email is not an e-mail address: ${JSON.stringify(request.email)}\n`)
    return 1
  }
  const path = join(resolveDshHome(request.home, io.env), AUTH_DB_FILE)
  const store = new AuthStore({
    path,
    journalMode: 'wal',
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    now: () => Date.now(),
    warn: (message) => { io.writeError(`${NAME}: auth bootstrap: ${message}\n`) },
  })
  try {
    // Settle the open here so an unreadable or foreign-versioned database is
    // reported as itself rather than as a failure of the first query.
    await store.open()
    const { userId, created } = await promoteFirstAdmin(store, email, io)
    await store.setMembers(ADMIN_GROUP_ID, [userId])
    await store.audit({
      event: BOOTSTRAP_AUDIT_EVENT,
      actorUserId: userId,
      subject: userId,
      detail: created ? 'created the first administrator account' : 'promoted an existing account to administrator',
    })
    io.write(
      created
        ? `${NAME}: created administrator ${email} in ${path}; the address is unverified until the first login\n`
        : `${NAME}: promoted existing account ${email} to administrator in ${path}; its password is unchanged\n`,
    )
    return 0
  } catch (error) {
    if (!(error instanceof BootstrapRefusal) && !(error instanceof AuthError)) throw error
    io.writeError(`${NAME}: auth bootstrap: ${error.message}\n`)
    return 1
  } finally {
    await store.close()
  }
}
