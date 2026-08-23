/**
 * Bearer tokens and one-time codes. Every secret here is minted once, handed
 * to the caller once, and stored only as a digest, so a database copy cannot
 * be replayed as a credential.
 * @module @deepseek-ai/dsh-auth/token
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** Bearer-token entropy in bytes: 256 bits, well past any online guessing budget. */
export const TOKEN_BYTES = 32
/** Per-code salt length in bytes for the six-digit codes. */
export const CODE_SALT_BYTES = 16
/** Digits in a one-time code. */
export const CODE_DIGITS = 6

/** One freshly minted bearer token and the digest to store for it. */
export interface MintedToken {
  /** The bearer token, in base64url. Return it to its owner and keep no copy. */
  token: string
  /** SHA-256 of the token's UTF-8 bytes; this is what storage holds. */
  digest: Buffer
}

/** One freshly minted numeric code, its per-code salt, and the digest to store. */
export interface MintedCode {
  /** The six-digit code, zero-padded. Deliver it out of band and keep no copy. */
  code: string
  /** SHA-256 of `salt || code`; this is what storage holds. */
  digest: Buffer
  /** The random salt the digest was taken over; store it beside the digest. */
  salt: Buffer
}

/**
 * Mint a bearer token.
 *
 * The token is 256 random bits, which is why it needs no salt or stretching:
 * unlike a password there is no low-entropy guess to grind, so a plain SHA-256
 * digest is enough to make the stored form useless to whoever reads it.
 * @returns the token to hand out and the digest to store.
 */
export function mintToken(): MintedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, digest: digestOf(token) }
}

/**
 * The stored digest for one presented token — the lookup key on the way back in.
 * @param token - the presented bearer token.
 * @returns SHA-256 of the token's UTF-8 bytes.
 */
export function digestOf(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * Mint a six-digit code for a second factor.
 *
 * Six digits is a million possibilities, which is only safe because the row
 * that holds the code caps attempts and expires; the per-code salt exists for
 * the same reason, since an unsalted digest of a six-digit number is trivially
 * reversible from a database copy alone.
 * @returns the code to deliver, its salt, and the digest to store.
 */
export function mintCode(): MintedCode {
  // randomInt is rejection-sampled, so every code is equally likely; a plain
  // modulo over random bytes would bias the low digits.
  const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
  const salt = randomBytes(CODE_SALT_BYTES)
  return { code, salt, digest: digestOfCode(salt, code) }
}

/**
 * The stored digest for one presented code and its row's salt.
 * @param salt - the salt stored with the code's row.
 * @param code - the presented code.
 * @returns SHA-256 of `salt || code`.
 */
export function digestOfCode(salt: Buffer, code: string): Buffer {
  return createHash('sha256').update(salt).update(code, 'utf8').digest()
}

/**
 * Compare two digests without leaking how far they matched.
 *
 * A length mismatch answers `false` up front: `timingSafeEqual` throws on
 * unequal lengths, and the length of a digest is not a secret.
 * @param left - one digest.
 * @param right - the other digest.
 * @returns whether the two are byte-identical.
 */
export function sameDigest(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
