/**
 * Password hashing on `node:crypto` scrypt. The encoded form carries its own
 * parameters, so raising the cost later verifies existing hashes unchanged and
 * only new hashes pay the higher cost.
 * @module @deepseek-ai/dsh-auth/password
 */

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * scrypt CPU/memory cost. 2^15 with `r = 8` is the interactive-login setting
 * from the scrypt paper's own recommendations, and costs roughly 32 MiB and
 * tens of milliseconds per verification on server hardware.
 */
export const SCRYPT_COST = 2 ** 15
/** scrypt block size; 8 is the value every published cost recommendation assumes. */
export const SCRYPT_BLOCK_SIZE = 8
/** scrypt parallelization. One, because the cost above already saturates a login's latency budget. */
export const SCRYPT_PARALLELIZATION = 1
/** Salt length in bytes: 256 bits of per-password uniqueness. */
export const SCRYPT_SALT_BYTES = 32
/** Derived-key length in bytes, matched to the salt. */
export const SCRYPT_HASH_BYTES = 32

/**
 * Largest cost this build will verify against. Node refuses parameters whose
 * `128 * N * r` working set is not strictly below `maxmem`, and the ceiling is
 * derived from the row's own cost below — so without an upper bound a stored
 * row claiming an absurd cost would turn a login into an allocation failure
 * instead of a refusal. 2^20 is five doublings above what this build writes,
 * which leaves room to raise {@link SCRYPT_COST} without touching stored rows.
 */
const SCRYPT_MAX_COST = 2 ** 20

/** The encoded form's leading field; it names both the algorithm and this layout. */
const ENCODING_TAG = 'scrypt'

/** Parameters recovered from an encoded hash. */
interface ParsedHash {
  cost: number
  blockSize: number
  parallelization: number
  salt: Buffer
  hash: Buffer
}

const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt)

function derive(
  password: string,
  parsed: Omit<ParsedHash, 'hash'>,
  length: number,
): Promise<Buffer> {
  return scryptAsync(password, parsed.salt, length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelization,
    // Twice the working set the parameters need, which is what makes a
    // parameter set Node would otherwise reject on its default ceiling run.
    maxmem: 128 * parsed.cost * parsed.blockSize * 2,
  })
}

/**
 * Hash a password for storage.
 *
 * The result is `scrypt$N$r$p$<base64 salt>$<base64 hash>`; the salt is fresh
 * random bytes on every call, so two accounts sharing a password store
 * different hashes. Neither the password nor the derived key is logged,
 * returned in any other form, or retained after the call.
 * @param password - the plaintext password.
 * @returns the encoded hash, safe to store as-is.
 */
export async function hashPassword(password: string): Promise<string> {
  const parameters = {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    salt: randomBytes(SCRYPT_SALT_BYTES),
  }
  const hash = await derive(password, parameters, SCRYPT_HASH_BYTES)
  return [
    ENCODING_TAG,
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    parameters.salt.toString('base64'),
    hash.toString('base64'),
  ].join('$')
}

/**
 * Recover the parameters an encoded hash was produced with.
 *
 * This is the readable half of {@link verifyPassword}'s fail-closed behavior:
 * verification answers only "yes" or "no", so a caller that needs to tell a
 * wrong password from a hash it cannot read — to log a corrupt row, or to
 * refuse a login for a reason worth an operator's attention — asks here first.
 * @param encoded - a stored hash.
 * @returns whether the value parses as an encoded scrypt hash this build can verify.
 */
export function isPasswordHash(encoded: string): boolean {
  return parseHash(encoded) !== undefined
}

function parseHash(encoded: string): ParsedHash | undefined {
  const fields = encoded.split('$')
  if (fields.length !== 6) return undefined
  // The length check above is what makes every position present; naming them
  // through the tuple keeps six unreachable `undefined` guards out of the code.
  const [tag, cost, blockSize, parallelization, salt, hash] = fields as [string, string, string, string, string, string]
  if (tag !== ENCODING_TAG) return undefined
  const parsed = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  }
  // scrypt requires a power-of-two cost above 1; the other two are positive
  // integers. Rejecting here rather than at the scrypt call keeps a malformed
  // row from surfacing as a thrown parameter error inside a login.
  if (!Number.isSafeInteger(parsed.cost)
    || parsed.cost < 2
    || parsed.cost > SCRYPT_MAX_COST
    || (parsed.cost & (parsed.cost - 1)) !== 0
    || !Number.isSafeInteger(parsed.blockSize)
    || parsed.blockSize < 1
    || !Number.isSafeInteger(parsed.parallelization)
    || parsed.parallelization < 1
    || parsed.salt.length === 0
    || parsed.hash.length === 0) return undefined
  return parsed
}

/**
 * Check a password against a stored hash.
 *
 * Comparison is `timingSafeEqual` over the derived keys, so the answer's
 * timing does not depend on how much of the hash matched. A hash this build
 * cannot parse fails closed — `false`, never a throw — because a login is not
 * the place to surface a storage defect, and a throw escaping here would let a
 * corrupt row be told apart from a wrong password by the shape of the failure.
 * Use {@link isPasswordHash} to detect and log that case deliberately.
 * @param password - the submitted plaintext password.
 * @param encoded - the stored hash.
 * @returns whether the password produces the stored hash.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded)
  if (parsed === undefined) return false
  const derived = await derive(password, parsed, parsed.hash.length)
  return timingSafeEqual(derived, parsed.hash)
}
