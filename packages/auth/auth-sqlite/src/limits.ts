/**
 * Fixed rate limits and their durable accounting.
 *
 * None of these is a `Config` field. A deployment that could widen them could
 * disable the only defence a password form has against online guessing, so
 * they are security invariants of the provider in the same sense a protocol
 * constant is: changeable by a code change and a review, not by a cordis.yml.
 * @module @deepseek-ai/dsh-auth-sqlite/limits
 */

import type { DatabaseSync } from 'node:sqlite'

/** Window over which password attempts are counted, and the resulting lockout's length. */
export const PASSWORD_WINDOW_MS = 15 * 60_000
/** Failed password attempts per address before that address is locked out. */
export const PASSWORD_ATTEMPTS_PER_EMAIL = 10
/** Failed password attempts per client address before that client is locked out. */
export const PASSWORD_ATTEMPTS_PER_IP = 20
/** Shortest gap between two second-factor challenges for one account. */
export const TWO_FACTOR_MIN_INTERVAL_MS = 60_000
/** Second-factor challenges per account per hour. */
export const TWO_FACTOR_PER_HOUR = 5
/** Password resets per address per hour. */
export const RESET_PER_HOUR = 3
/** One hour, the longest window any limit above counts over. */
export const HOUR_MS = 60 * 60_000
/** Wrong second-factor codes one challenge tolerates before it is killed. */
export const CODE_ATTEMPT_CAP = 5

/**
 * How long a counted attempt stays on record. The longest window is an hour
 * and the longest consequence — a password lockout — expires with its own
 * fifteen-minute window, so nothing older than an hour can change an answer.
 */
export const RATE_EVENT_RETENTION_MS = HOUR_MS

/**
 * Record one counted attempt. Attempts are durable rows rather than in-memory
 * counters so that a restart cannot clear a lockout: a process crash loop
 * would otherwise be a way to keep guessing.
 * @param db - the open auth database.
 * @param key - the counter this attempt belongs to.
 * @param now - the attempt's timestamp.
 */
export function recordAttempt(db: DatabaseSync, key: string, now: number): void {
  db.prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)').run(key, now)
}

/**
 * How many attempts one counter holds inside a window.
 * @param db - the open auth database.
 * @param key - the counter to read.
 * @param windowMs - how far back to count.
 * @param now - the current time.
 * @returns the attempt count.
 */
export function countAttempts(db: DatabaseSync, key: string, windowMs: number, now: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND ts > ?')
    .get(key, now - windowMs) as { n: number }
  return row.n
}

/**
 * The lockout deadline one counter currently imposes, if any.
 *
 * The counting window and the lockout length are the same interval by design:
 * a lockout therefore ends exactly when the attempts that caused it leave the
 * window, which needs no separate deadline row and cannot be extended by
 * attempts made while already locked out.
 * @param db - the open auth database.
 * @param key - the counter to read.
 * @param threshold - attempts within the window that trigger a lockout.
 * @param now - the current time.
 * @returns the epoch-millisecond deadline, or `undefined` when the counter is below its threshold.
 */
export function lockoutUntil(
  db: DatabaseSync,
  key: string,
  threshold: number,
  now: number,
): number | undefined {
  // COALESCE keeps the empty-counter case in SQL: `MAX` over no rows is NULL,
  // and a JS guard for it would be unreachable below the threshold check.
  const row = db.prepare(
    'SELECT COUNT(*) AS n, COALESCE(MAX(ts), 0) AS last FROM rate_events WHERE key = ? AND ts > ?',
  ).get(key, now - PASSWORD_WINDOW_MS) as { n: number; last: number }
  if (row.n < threshold) return undefined
  return row.last + PASSWORD_WINDOW_MS
}

/**
 * Drop attempts too old to affect any answer. Called on the operations that
 * write attempts, so the table stays bounded without a background timer whose
 * lifetime the service would then have to own.
 * @param db - the open auth database.
 * @param now - the current time.
 */
export function pruneAttempts(db: DatabaseSync, now: number): void {
  db.prepare('DELETE FROM rate_events WHERE ts <= ?').run(now - RATE_EVENT_RETENTION_MS)
}

/**
 * The counter key for password attempts against one address.
 * @param email - the submitted address; counted case-insensitively.
 * @returns the counter key.
 */
export function passwordEmailKey(email: string): string {
  return `password:email:${email.toLowerCase()}`
}

/**
 * The counter key for password attempts from one client address.
 * @param ip - the client address.
 * @returns the counter key.
 */
export function passwordIpKey(ip: string): string {
  return `password:ip:${ip}`
}

/**
 * The counter key for second-factor challenges issued to one account.
 * @param userId - the account.
 * @returns the counter key.
 */
export function twoFactorKey(userId: string): string {
  return `2fa:user:${userId}`
}

/**
 * The counter key for password resets requested for one address.
 * @param email - the submitted address; counted case-insensitively.
 * @returns the counter key.
 */
export function resetKey(email: string): string {
  return `reset:email:${email.toLowerCase()}`
}
