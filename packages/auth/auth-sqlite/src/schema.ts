/**
 * Physical layout and open sequence for the auth database: the schema version,
 * the owner-only file creation, the pragmas, and the DDL.
 * @module @deepseek-ai/dsh-auth-sqlite/schema
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { ADMIN_GROUP_ID, ADMIN_GROUP_NAME, AuthError } from '@deepseek-ai/dsh-auth'

/**
 * On-disk layout version, stored in `PRAGMA user_version`. Monotonic, and any
 * other stamped value is rejected rather than migrated: the pre-release stance
 * makes a wrong-version auth database an operator decision, not something a
 * provider should silently rewrite while it holds credentials.
 */
export const AUTH_SCHEMA_VERSION = 1

/**
 * Journal modes this provider will run under. `wal` is the default; the
 * rollback-journal modes exist for filesystems where WAL's shared-memory files
 * do not work. `memory` and `off` are excluded because losing a revocation or
 * a consumed-token write to a crash is a security failure, not a performance
 * trade-off.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/**
 * Every table and index, applied as one statement batch to a fresh database.
 *
 * The tables are STRICT, so SQLite itself enforces each column's type and the
 * `CHECK` constraints enforce each closed vocabulary. That is what lets the
 * reader code below treat a row's columns as typed: the durable boundary is
 * validated by the schema this provider owns and re-checks at every open,
 * rather than by hand-written decoding at every query.
 */
const SCHEMA = `
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash     TEXT NOT NULL,
  email_verified_at INTEGER,
  disabled_at       INTEGER,
  created_at        INTEGER NOT NULL
) STRICT;

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  builtin    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE memberships (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
) STRICT;

CREATE TABLE rules (
  id       TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  domain   TEXT NOT NULL CHECK (domain IN ('skill', 'tool', 'model', 'settings-section')),
  pattern  TEXT NOT NULL,
  effect   TEXT NOT NULL CHECK (effect IN ('allow', 'deny'))
) STRICT;

CREATE INDEX rules_by_group_domain ON rules (group_id, domain);

CREATE TABLE auth_sessions (
  id           TEXT PRIMARY KEY,
  token_digest BLOB NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   INTEGER
) STRICT;

CREATE INDEX auth_sessions_by_user ON auth_sessions (user_id);

CREATE TABLE one_time_tokens (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('2fa', 'verify-email', 'reset-password')),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  digest      BLOB NOT NULL UNIQUE,
  salt        BLOB,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE session_owners (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE workspace_owners (
  workspace_id TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE rate_events (
  key TEXT NOT NULL,
  ts  INTEGER NOT NULL
) STRICT;

CREATE INDEX rate_events_by_key_ts ON rate_events (key, ts);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  actor_user_id TEXT,
  event         TEXT NOT NULL,
  subject       TEXT,
  detail        TEXT,
  ip            TEXT
) STRICT;

CREATE INDEX audit_log_by_ts ON audit_log (ts);
`

/**
 * Exclusively create a missing database file with owner-only permissions. An
 * existing file keeps its modes, and any error other than `EEXIST` propagates.
 * The mode protects the file's contents, not its directory entry: a principal
 * that can replace the entry can still substitute a database.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the auth database, applying its pragmas and, for a fresh medium, its
 * schema. Missing directories and files are created owner-only; `:memory:`
 * skips filesystem setup.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @param journalMode - validated journal pragma.
 * @param now - clock used to stamp the builtin group's creation time.
 * @returns the open handle, schema-complete and version-stamped.
 * @throws AuthError `schema-version` when the medium carries another build's layout.
 */
export async function openDatabase(
  path: string,
  journalMode: JournalMode,
  now: () => number,
): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configureDatabase(db, actual, journalMode, now)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(
  db: DatabaseSync,
  path: string,
  journalMode: JournalMode,
  now: () => number,
): void {
  db.exec('PRAGMA foreign_keys = ON')
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
  // `PRAGMA user_version` always returns exactly one row { user_version }.
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== AUTH_SCHEMA_VERSION) {
    throw new AuthError(
      'schema-version',
      `auth database at "${path}" has schema version ${onDisk}, incompatible with this build (${AUTH_SCHEMA_VERSION})`,
    )
  }
  if (onDisk !== 0) return
  db.exec(SCHEMA)
  db.prepare('INSERT INTO groups (id, name, builtin, created_at) VALUES (?, ?, 1, ?)')
    .run(ADMIN_GROUP_ID, ADMIN_GROUP_NAME, now())
  // Stamp last: the version asserts the layout is complete, so an interrupted
  // materialization leaves an unstamped medium the next open retries from scratch.
  db.exec(`PRAGMA user_version = ${AUTH_SCHEMA_VERSION}`)
}
