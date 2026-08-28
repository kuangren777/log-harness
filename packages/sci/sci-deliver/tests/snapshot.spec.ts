// The snapshot is what makes a card immutable, so the digest and size must
// describe the ORIGINAL bytes whatever encoding the copy needed, and a
// non-UTF-8 file must survive the copy losslessly.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BASE64_SNAPSHOT_SUFFIX, DeliveryId, encodeSnapshot, snapshotDelivery } from '@deepseek-ai/dsh-sci-deliver'
import { MemoryFileSystem, SNAPSHOT_DIR, WORKSPACE } from './harness.ts'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xD8])

describe('encodeSnapshot', () => {
  it('keeps valid UTF-8 as text, including multibyte content', () => {
    const bytes = Buffer.from('# 结果\nfinished\n', 'utf8')
    expect(encodeSnapshot(bytes)).toEqual({ suffix: '', text: '# 结果\nfinished\n' })
  })

  it('falls back to base64 for bytes that are not valid UTF-8', () => {
    expect(encodeSnapshot(PNG_BYTES)).toEqual({
      suffix: BASE64_SNAPSHOT_SUFFIX,
      text: PNG_BYTES.toString('base64'),
    })
  })
})

describe('snapshotDelivery', () => {
  it('copies a text file under its own name and digests the original bytes', async () => {
    const fs = new MemoryFileSystem().put(`${WORKSPACE}/report.md`, '# Report\n')
    const snapshot = await snapshotDelivery(fs, {
      path: `${WORKSPACE}/report.md`,
      deliveryId: DeliveryId('d1'),
      snapshotDir: SNAPSHOT_DIR,
      maxBytes: 1024,
    })

    expect(snapshot).toEqual({
      sha256: createHash('sha256').update('# Report\n').digest('hex'),
      size: 9,
      snapshotPath: `${SNAPSHOT_DIR}/d1/report.md`,
    })
    expect(fs.peek(snapshot.snapshotPath)).toBe('# Report\n')
  })

  it('copies binary content base64-encoded while reporting the original size', async () => {
    const fs = new MemoryFileSystem().put(`${WORKSPACE}/fig1.png`, PNG_BYTES)
    const snapshot = await snapshotDelivery(fs, {
      path: `${WORKSPACE}/fig1.png`,
      deliveryId: DeliveryId('d2'),
      snapshotDir: SNAPSHOT_DIR,
      maxBytes: 1024,
    })

    expect(snapshot.size).toBe(PNG_BYTES.byteLength)
    expect(snapshot.sha256).toBe(createHash('sha256').update(PNG_BYTES).digest('hex'))
    expect(snapshot.snapshotPath).toBe(`${SNAPSHOT_DIR}/d2/fig1.png${BASE64_SNAPSHOT_SUFFIX}`)
    expect(Buffer.from(fs.peek(snapshot.snapshotPath) ?? '', 'base64')).toEqual(PNG_BYTES)
  })

  it('refuses a file over the byte cap rather than snapshotting a truncated copy', async () => {
    const fs = new MemoryFileSystem().put(`${WORKSPACE}/big.bin`, Buffer.alloc(64))
    await expect(snapshotDelivery(fs, {
      path: `${WORKSPACE}/big.bin`,
      deliveryId: DeliveryId('d3'),
      snapshotDir: SNAPSHOT_DIR,
      maxBytes: 32,
    })).rejects.toThrow('exceeds 32 bytes')
    expect(fs.paths()).toEqual([`${WORKSPACE}/big.bin`])
  })
})
