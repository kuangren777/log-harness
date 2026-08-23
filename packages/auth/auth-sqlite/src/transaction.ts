/**
 * The one transaction helper every multi-statement auth operation runs through.
 * @module @deepseek-ai/dsh-auth-sqlite/transaction
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * Run one body inside an immediate transaction.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so a read-then-write
 * operation — redeeming a single-use token, replacing a group's membership —
 * cannot interleave with another connection between its read and its write.
 * A throw rolls back and propagates: no auth operation has a partial result
 * worth committing.
 * @param db - the open auth database.
 * @param body - the statements to run; every SQLite call here is synchronous.
 * @returns whatever the body returned.
 */
export function transact<T>(db: DatabaseSync, body: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = body()
    db.exec('COMMIT')
    return value
  } catch (error: unknown) {
    db.exec('ROLLBACK')
    throw error
  }
}
