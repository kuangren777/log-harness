/**
 * The undelivered-charge spool: a JSONL file holding every charge the gate did
 * not accept, and the retry loop that drains it.
 *
 * A charge is money already spent upstream, so losing one is worse than
 * delivering it late. The stream is never made to wait on the spool: appending
 * and draining happen beside it, and the drain is idempotent because the gate
 * keys on `requestId`.
 * @module @deepseek-ai/dsh-sci-credit/spool
 */

import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ChargePayload } from './types.ts'

/** Owner-only bits for a file naming a tenant's spending. */
const SPOOL_FILE_MODE = 0o600

/** Owner-only bits for the directory holding it. */
const SPOOL_DIR_MODE = 0o700

/** How one spooled payload reads back from the file. */
function isChargePayload(value: unknown): value is ChargePayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['requestId'] === 'string'
    && record['requestId'].length > 0
    && typeof record['model'] === 'string'
    && typeof record['usdMicros'] === 'number'
    && typeof record['usage'] === 'object'
    && record['usage'] !== null
}

/** What one drain pass did. */
export interface DrainReport {
  /** Payloads the gate accepted or recognized as already charged. */
  readonly delivered: number
  /** Payloads still in the file because the gate could not take them. */
  readonly pending: number
  /** Lines dropped because they were not a charge payload at all. */
  readonly discarded: number
}

/**
 * The on-disk queue of charges the gate has not accepted.
 *
 * Reads and writes are serialized through one promise chain, so a drain that
 * rewrites the file cannot interleave with an append that adds to it.
 */
export class ChargeSpool {
  private tail: Promise<unknown> = Promise.resolve()

  /**
   * @param path - absolute path of the JSONL spool file.
   */
  constructor(private readonly path: string) {}

  /**
   * Append one undelivered charge.
   * @param payload - the charge body the gate did not accept.
   * @returns nothing, once the line is on disk.
   * @throws when the spool directory or file cannot be written.
   */
  append(payload: ChargePayload): Promise<void> {
    return this.serialize(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: SPOOL_DIR_MODE })
      await appendFile(this.path, `${JSON.stringify(payload)}\n`, { mode: SPOOL_FILE_MODE })
    })
  }

  /**
   * Read every payload currently spooled, dropping unreadable lines.
   * @returns the payloads in file order, and how many lines were not payloads.
   * @throws when the file exists but cannot be read.
   */
  read(): Promise<{ payloads: ChargePayload[]; discarded: number }> {
    return this.serialize(() => this.readUnlocked())
  }

  /**
   * Hand every spooled payload to the gate and keep only what it refused.
   *
   * Delivery stops at the first refusal: a gate that refused one charge will
   * refuse the rest of this pass too, and continuing would spend one failed
   * request per queued payload. Order is preserved, so the oldest charge is
   * always the next one tried.
   * @param deliver - sends one payload; resolving means the gate has it, rejecting means it does not.
   * @returns what the pass delivered, left pending, and discarded.
   * @throws when the file cannot be read or rewritten.
   */
  drain(deliver: (payload: ChargePayload) => Promise<unknown>): Promise<DrainReport> {
    return this.serialize(async (): Promise<DrainReport> => {
      const { payloads, discarded } = await this.readUnlocked()
      let delivered = 0
      while (delivered < payloads.length) {
        try {
          await deliver(payloads[delivered] as ChargePayload)
        } catch {
          // The gate is refusing right now. The remaining payloads stay in file
          // order for the next attempt; the caller owns the backoff.
          break
        }
        delivered += 1
      }
      const pending = payloads.slice(delivered)
      if (delivered > 0 || discarded > 0) await this.replaceUnlocked(pending)
      return { delivered, pending: pending.length, discarded }
    })
  }

  /**
   * Read the file without taking the lock; callers already hold it.
   * @returns the payloads in file order, and how many lines were not payloads.
   */
  private async readUnlocked(): Promise<{ payloads: ChargePayload[]; discarded: number }> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      // An absent spool is the ordinary state: nothing has failed yet.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { payloads: [], discarded: 0 }
      throw error
    }
    const payloads: ChargePayload[] = []
    let discarded = 0
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        // A truncated tail from a killed process: the charge is unrecoverable
        // either way, and keeping the line would block every later one.
        discarded += 1
        continue
      }
      if (isChargePayload(parsed)) payloads.push(parsed)
      else discarded += 1
    }
    return { payloads, discarded }
  }

  /**
   * Rewrite the file to exactly these payloads, removing it when empty.
   * @param payloads - what remains queued.
   */
  private async replaceUnlocked(payloads: readonly ChargePayload[]): Promise<void> {
    if (payloads.length === 0) {
      await rm(this.path, { force: true })
      return
    }
    const content = payloads.map(payload => `${JSON.stringify(payload)}\n`).join('')
    await writeFileAtomic(this.path, content, { mode: SPOOL_FILE_MODE, dirMode: SPOOL_DIR_MODE })
  }

  /**
   * Run one file operation after every earlier one has settled.
   * @param operation - the file work to run under the lock.
   * @returns the operation's own result.
   */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation)
    this.tail = next.catch(() => undefined)
    return next
  }
}

/**
 * The delay before retry attempt `attempt`, doubling from a base to a ceiling.
 * @param attempt - one-based attempt number; anything below one uses the base.
 * @param baseMs - the first delay.
 * @param maxMs - the ceiling the doubling stops at.
 * @returns the delay in milliseconds.
 */
export function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  if (attempt <= 1) return Math.min(baseMs, maxMs)
  // 2 ** 30 already exceeds any sane ceiling; capping the exponent keeps the
  // shift finite for a spool that has been failing for a very long time.
  const doublings = Math.min(attempt - 1, 30)
  return Math.min(baseMs * 2 ** doublings, maxMs)
}
