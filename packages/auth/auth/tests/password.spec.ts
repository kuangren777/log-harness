import { describe, expect, it } from 'vitest'
import { hashPassword, isPasswordHash, verifyPassword } from '../src/index.ts'
import {
  SCRYPT_BLOCK_SIZE,
  SCRYPT_COST,
  SCRYPT_HASH_BYTES,
  SCRYPT_PARALLELIZATION,
  SCRYPT_SALT_BYTES,
} from '../src/index.ts'

describe('scrypt password hashing', () => {
  it('encodes its own parameters and a fresh salt', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    const [tag, cost, blockSize, parallelization, salt, hash] = encoded.split('$')
    expect(tag).toBe('scrypt')
    expect(Number(cost)).toBe(SCRYPT_COST)
    expect(Number(blockSize)).toBe(SCRYPT_BLOCK_SIZE)
    expect(Number(parallelization)).toBe(SCRYPT_PARALLELIZATION)
    expect(Buffer.from(salt ?? '', 'base64')).toHaveLength(SCRYPT_SALT_BYTES)
    expect(Buffer.from(hash ?? '', 'base64')).toHaveLength(SCRYPT_HASH_BYTES)
    expect(encoded).not.toContain('correct horse')
  })

  it('salts each hash, so one password stores two different values', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')])
    expect(first).not.toBe(second)
    await expect(verifyPassword('same', first)).resolves.toBe(true)
    await expect(verifyPassword('same', second)).resolves.toBe(true)
  })

  it('round-trips the right password and refuses every other one', async () => {
    const encoded = await hashPassword('s3cret')
    await expect(verifyPassword('s3cret', encoded)).resolves.toBe(true)
    await expect(verifyPassword('s3crey', encoded)).resolves.toBe(false)
    await expect(verifyPassword('', encoded)).resolves.toBe(false)
    await expect(verifyPassword('s3cret ', encoded)).resolves.toBe(false)
  })

  const malformed: Array<[string, string]> = [
    ['not an encoded hash at all', 'nope'],
    ['too few fields', 'scrypt$32768$8$1$AAAA'],
    ['too many fields', 'scrypt$32768$8$1$AAAA$AAAA$extra'],
    ['another algorithm tag', 'argon2id$32768$8$1$AAAA$AAAA'],
    ['a non-numeric cost', 'scrypt$many$8$1$AAAA$AAAA'],
    ['a cost below two', 'scrypt$1$8$1$AAAA$AAAA'],
    ['a cost above the accepted ceiling', `scrypt$${2 ** 21}$8$1$AAAA$AAAA`],
    ['a cost that is not a power of two', 'scrypt$3$8$1$AAAA$AAAA'],
    ['a non-numeric block size', 'scrypt$16$wide$1$AAAA$AAAA'],
    ['a zero block size', 'scrypt$16$0$1$AAAA$AAAA'],
    ['a non-numeric parallelization', 'scrypt$16$8$many$AAAA$AAAA'],
    ['a zero parallelization', 'scrypt$16$8$0$AAAA$AAAA'],
    ['an empty salt', 'scrypt$16$8$1$$AAAA'],
    ['an empty hash', 'scrypt$16$8$1$AAAA$'],
  ]

  it.each(malformed)('fails closed on %s', async (_label, encoded) => {
    expect(isPasswordHash(encoded)).toBe(false)
    await expect(verifyPassword('anything', encoded)).resolves.toBe(false)
  })

  it('reports a readable stored hash as readable', async () => {
    expect(isPasswordHash(await hashPassword('readable'))).toBe(true)
  })
})
