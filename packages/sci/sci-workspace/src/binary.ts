/**
 * Magic-byte recognition for the read gate: which non-text file a target is,
 * and which skill reaches its content instead.
 *
 * The read tool decodes UTF-8, so a binary target either fails late with a
 * decoding error or floods the transcript with replacement characters. Naming
 * the format up front turns that into one sentence pointing at the tool that
 * can actually open it.
 * @module @deepseek-ai/dsh-sci-workspace/binary
 */

import { RULE_BINARY_READ } from './decide.ts'

/** Bytes the probe needs; every recognized signature fits in the first eight. */
export const BINARY_MAGIC_BYTES = 8

/** The kinds of non-text content the read gate recognizes. */
export type BinarySignature = 'pdf' | 'image' | 'archive' | 'executable'

/** Leading bytes identifying one format, most specific prefix first. */
const SIGNATURES: readonly { readonly magic: readonly number[]; readonly signature: BinarySignature }[] = [
  { magic: [0x25, 0x50, 0x44, 0x46], signature: 'pdf' },
  { magic: [0x89, 0x50, 0x4e, 0x47], signature: 'image' },
  { magic: [0xff, 0xd8, 0xff], signature: 'image' },
  { magic: [0x50, 0x4b], signature: 'archive' },
  { magic: [0x7f, 0x45, 0x4c, 0x46], signature: 'executable' },
]

/**
 * Identify a file from its leading bytes.
 * @param bytes - the first bytes of the target, at least {@link BINARY_MAGIC_BYTES} long when the file is that big.
 * @returns the recognized signature, or `undefined` when the content may be text.
 */
export function detectBinarySignature(bytes: Uint8Array): BinarySignature | undefined {
  return SIGNATURES.find(({ magic }) => magic.every((byte, index) => bytes[index] === byte))?.signature
}

/** The way forward each recognized signature offers. */
const REMEDIES: Readonly<Record<BinarySignature, string>> = {
  pdf: 'is a PDF, not text: extract its text with the pdf skill (pdftotext -layout) or look at a page with the sci-read-image skill',
  image: 'is an image, not text: look at it with the sci-read-image skill',
  archive: 'is a zip-family archive, not text: list its entries in a shell command and read the extracted file',
  executable: 'is a compiled executable, not text: inspect it with file, readelf, or strings and report what you find',
}

/**
 * The refusal of a read whose target is not text.
 * @param path - the resolved target path.
 * @param signature - the recognized format.
 * @returns rule id and model-facing reason.
 */
export function denyBinaryRead(path: string, signature: BinarySignature): { rule: string; reason: string } {
  return { rule: RULE_BINARY_READ, reason: `"${path}" ${REMEDIES[signature]}.` }
}
