# dsh-auth-sqlite

English | [中文](README.zh.md)

Service Provider for the [authentication and authorization](../README.md) seam: [`AuthService`](../auth/README.md) over one `node:sqlite` database, holding users, groups, rules, live auth sessions, one-time secrets, resource ownership, rate windows, and the audit log.

## Storage

The database lives at the configured `path` (`$DSH_HOME/auth.db` in the shipped composition), opened WAL-first with file mode `0600`. `AUTH_SCHEMA_VERSION` is written to `PRAGMA user_version` and **rejected, never migrated**: a database from a different build fails loud at load naming both versions, so a downgrade cannot silently reinterpret credential records.

| `Config` field | Meaning |
|---|---|
| `path` | Database file; `:memory:` gives a per-process store for tests. |
| `journalMode` | `wal` (default), `delete`, `truncate`, or `persist`. |
| `sessionTtlMs` | Absolute lifetime of an issued auth session; default 30 days. |

## What the store enforces itself

**Generic login failure.** `verifyLogin` returns the same refusal whether the e-mail is unknown, the password is wrong, or the account is disabled, so the reply cannot be used to enumerate accounts.

**Durable rate limits.** Password, 2FA-send, and reset attempts are counted in `rate_events` with sliding windows, so a lockout survives a Host restart rather than resetting with the process. The limits are security invariants, not deployment knobs.

**Single-use secrets.** A one-time token is consumed inside one transaction that both marks `consumed_at` and returns the user, so two concurrent redemptions cannot both succeed. A 2FA code additionally dies after its attempt cap.

**Digest-only secrets.** Auth-session tokens and one-time codes are stored as digests and located by digest, then confirmed with `timingSafeEqual`. Neither the database nor the audit log ever holds a password, token, or code in plaintext.

**An undeletable admin group.** The builtin group refuses deletion, so a deployment cannot lock every administrator out of its own permission surface.

## Ownership

`session_owners` and `workspace_owners` map an agent session or workspace to the user who created it. Ownership lives here rather than in the session log so that adding authentication to a deployment does not change `SESSION_FORMAT_VERSION` or the durable session record.

## Model Experience

None, as the provider serves the Host's authorization decisions: no stored record reaches a model request, and the package registers no tool, prompt section, or session event.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **Single-process store** — one SQLite file with WAL serves one Host. A second Host process against the same file is untested and unsupported; a shared deployment needs a different provider behind the same seam.
- **Reject-don't-migrate** — a schema bump requires operators to recreate the database, losing users and audit history. The first version that must survive an upgrade gains a migration path.
- **Audit retention is unbounded** — `audit_log` grows without pruning; a long-lived deployment needs its own retention policy until the provider gains one.
