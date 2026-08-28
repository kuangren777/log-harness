// Acceptance 08-T1 at the pure level: the magic-byte probe and the sentence it
// produces. The reason has to name the tool that CAN open the file, because a
// refusal the model cannot act on turns into a retry loop.
import { describe, expect, it } from 'vitest'
import { BINARY_MAGIC_BYTES, RULE_BINARY_READ, denyBinaryRead, detectBinarySignature } from '@deepseek-ai/dsh-sci-workspace'
import type { BinarySignature } from '@deepseek-ai/dsh-sci-workspace'

/** Eight bytes beginning with the given magic. */
function leading(...magic: number[]): Uint8Array {
  const bytes = new Uint8Array(BINARY_MAGIC_BYTES)
  bytes.set(magic)
  return bytes
}

const SIGNATURES: readonly (readonly [string, Uint8Array, BinarySignature])[] = [
  ['a PDF', leading(0x25, 0x50, 0x44, 0x46, 0x2d), 'pdf'],
  ['a PNG', leading(0x89, 0x50, 0x4e, 0x47, 0x0d), 'image'],
  ['a JPEG', leading(0xff, 0xd8, 0xff, 0xe0), 'image'],
  ['a zip-family archive', leading(0x50, 0x4b, 0x03, 0x04), 'archive'],
  ['an ELF executable', leading(0x7f, 0x45, 0x4c, 0x46), 'executable'],
]

describe('detectBinarySignature', () => {
  it.each(SIGNATURES)('recognizes %s', (_label, bytes, expected) => {
    expect(detectBinarySignature(bytes)).toBe(expected)
  })

  it('leaves text and a near-miss prefix unrecognized', () => {
    expect(detectBinarySignature(new TextEncoder().encode('\\documentclass'))).toBeUndefined()
    expect(detectBinarySignature(leading(0x25, 0x50, 0x44, 0x00))).toBeUndefined()
    expect(detectBinarySignature(new Uint8Array())).toBeUndefined()
  })
})

describe('denyBinaryRead', () => {
  it('sends a PDF to the extraction skill by name (08-T1)', () => {
    const denial = denyBinaryRead('/sci/projects/p1/tmp/refs/a.pdf', 'pdf')
    expect(denial.rule).toBe(RULE_BINARY_READ)
    expect(denial.reason).toContain('pdftotext')
    expect(denial.reason).toContain('sci-read-image')
    expect(denial.reason).toContain('/sci/projects/p1/tmp/refs/a.pdf')
  })

  it('sends an image to the image skill and names a plain remedy for the other kinds', () => {
    expect(denyBinaryRead('/x/fig.png', 'image').reason).toContain('sci-read-image')
    expect(denyBinaryRead('/x/data.zip', 'archive').reason).toContain('archive')
    expect(denyBinaryRead('/x/installer', 'executable').reason).toContain('readelf')
  })
})
