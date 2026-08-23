import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AuthSessionId,
  CODE_DIGITS,
  CODE_SALT_BYTES,
  GroupId,
  OneTimeTokenId,
  TOKEN_BYTES,
  UserId,
  digestOf,
  digestOfCode,
  mintCode,
  mintToken,
  sameDigest,
} from '../src/index.ts'

describe('bearer tokens', () => {
  it('mints a base64url secret with its stored digest', () => {
    const { token, digest } = mintToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(TOKEN_BYTES)
    expect(digest).toHaveLength(32)
    expect(digest.equals(createHash('sha256').update(token, 'utf8').digest())).toBe(true)
  })

  it('mints a different secret every time', () => {
    const first = mintToken()
    const second = mintToken()
    expect(first.token).not.toBe(second.token)
    expect(sameDigest(first.digest, second.digest)).toBe(false)
  })

  it('recomputes the stored digest from a presented token', () => {
    const { token, digest } = mintToken()
    expect(sameDigest(digestOf(token), digest)).toBe(true)
    expect(sameDigest(digestOf(`${token}x`), digest)).toBe(false)
  })
})

describe('one-time codes', () => {
  it('mints a zero-padded six-digit code with a per-code salt', () => {
    const { code, salt, digest } = mintCode()
    expect(code).toMatch(new RegExp(`^\\d{${CODE_DIGITS}}$`))
    expect(salt).toHaveLength(CODE_SALT_BYTES)
    expect(digest.equals(createHash('sha256').update(salt).update(code, 'utf8').digest())).toBe(true)
  })

  it('salts the digest, so the same code stores differently twice', () => {
    const first = mintCode()
    const second = { ...mintCode(), code: first.code }
    expect(sameDigest(first.digest, digestOfCode(second.salt, second.code))).toBe(false)
    expect(sameDigest(first.digest, digestOfCode(first.salt, first.code))).toBe(true)
  })

  it('refuses a wrong code against the right salt', () => {
    const { code, salt, digest } = mintCode()
    const other = code === '000000' ? '000001' : '000000'
    expect(sameDigest(digestOfCode(salt, other), digest)).toBe(false)
  })
})

describe('digest comparison', () => {
  it('answers false for different lengths instead of throwing', () => {
    expect(sameDigest(Buffer.from([1, 2, 3]), Buffer.from([1, 2]))).toBe(false)
  })

  it('answers for equal-length digests', () => {
    expect(sameDigest(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true)
    expect(sameDigest(Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false)
  })
})

describe('branded ids', () => {
  it('brands without validating or changing the string', () => {
    expect(UserId('u-1')).toBe('u-1')
    expect(GroupId('g-1')).toBe('g-1')
    expect(AuthSessionId('s-1')).toBe('s-1')
    expect(OneTimeTokenId('t-1')).toBe('t-1')
  })
})
