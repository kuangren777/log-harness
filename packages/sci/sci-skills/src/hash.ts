/**
 * Content hashing of the bundled skill tree.
 *
 * The studied platform tracked skill freshness with a hand-maintained revision
 * string and re-pushed a whole directory whenever it moved. Here a skill
 * directory's identity is derived: a Merkle digest folding every file's sha256
 * in sorted relative-path order, so an unedited tree always produces the same
 * hash and a one-byte edit changes exactly one file digest.
 * @module @deepseek-ai/dsh-sci-skills/src/hash
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillTreeHash } from './types.ts'

/**
 * Directory names never read out of a skill bundle. Interpreter and VCS
 * residue is regenerated on the far side and is not skill content; excluding
 * it keeps a stray local artifact from inventing a sync round. Fixed, not
 * configurable: this is a property of the vendored tree, not of a deployment.
 */
const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(['__pycache__', '.git'])

/** Read side of one skill tree: the host source of record, or a test double. */
export interface SkillSourceReader {
  /**
   * List every file in a skill directory.
   * @param directory - absolute path of the skill directory.
   * @returns slash-separated paths relative to `directory`, in any order.
   */
  readonly listFiles: (directory: string) => Promise<readonly string[]>
  /**
   * Read one file's UTF-8 text.
   * @param directory - absolute path of the skill directory.
   * @param relativePath - slash-separated path relative to `directory`.
   * @returns the decoded file content.
   */
  readonly readFile: (directory: string, relativePath: string) => Promise<string>
  /**
   * List the skill directories directly under a root.
   * @param root - absolute path of the skill root.
   * @returns directory names, in any order.
   */
  readonly listSkillNames: (root: string) => Promise<readonly string[]>
}

/**
 * Recursively collect the relative file paths under one directory.
 * @param directory - absolute directory to walk.
 * @param prefix - slash-separated path already walked, `''` at the root.
 * @returns every contained file path relative to the walk root.
 */
async function walk(directory: string, prefix: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue
      files.push(...await walk(join(directory, entry.name), `${prefix}${entry.name}/`))
      continue
    }
    files.push(`${prefix}${entry.name}`)
  }
  return files
}

/** Reader backed by the host filesystem, where the bundled tree ships. */
export const nodeSkillSourceReader: SkillSourceReader = {
  listFiles: directory => walk(directory, ''),
  readFile: (directory, relativePath) => readFile(join(directory, ...relativePath.split('/')), 'utf8'),
  listSkillNames: async (root) => {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory() && !EXCLUDED_DIRECTORY_NAMES.has(entry.name))
      .map(entry => entry.name)
  },
}

/**
 * Order two manifest keys by UTF-16 code unit. Every folded digest and every
 * written manifest is sorted with this one comparison, so a tree's identity
 * does not depend on the order a directory listing or a JSON document happened
 * to present its keys in.
 * @param left - the first key.
 * @param right - the second key.
 * @returns negative when `left` sorts first, positive when `right` does, zero when they are equal.
 */
export function compareManifestKeys(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

/**
 * Fold per-file digests into one directory digest.
 * @param files - sha256 of each file, keyed by relative path.
 * @returns the hex Merkle digest over the sorted `path\0digest\n` records.
 */
export function hashFiles(files: Readonly<Record<string, string>>): string {
  const digest = createHash('sha256')
  const records = Object.entries(files).sort(([left], [right]) => compareManifestKeys(left, right))
  for (const [relativePath, fileDigest] of records) {
    digest.update(`${relativePath}\0${fileDigest}\n`)
  }
  return digest.digest('hex')
}

/**
 * Hash one skill directory's complete content.
 * @param directory - absolute path of the skill directory.
 * @param reader - read side; defaults to the host filesystem.
 * @returns the directory digest and the per-file digests it folds.
 */
export async function computeSkillHash(
  directory: string,
  reader: Pick<SkillSourceReader, 'listFiles' | 'readFile'> = nodeSkillSourceReader,
): Promise<SkillTreeHash> {
  const paths = [...await reader.listFiles(directory)].sort()
  const files: Record<string, string> = {}
  for (const relativePath of paths) {
    const content = await reader.readFile(directory, relativePath)
    files[relativePath] = createHash('sha256').update(content, 'utf8').digest('hex')
  }
  return { hash: hashFiles(files), files }
}

/**
 * Hash every named skill directory under one root.
 * @param root - absolute path of the skill root.
 * @param names - skill directory names to hash.
 * @param reader - read side; defaults to the host filesystem.
 * @returns one {@link SkillTreeHash} per skill name.
 */
export async function computeSkillTreeHashes(
  root: string,
  names: readonly string[],
  reader: Pick<SkillSourceReader, 'listFiles' | 'readFile'> = nodeSkillSourceReader,
): Promise<Record<string, SkillTreeHash>> {
  const tree: Record<string, SkillTreeHash> = {}
  for (const name of names) {
    tree[name] = await computeSkillHash(join(root, name), reader)
  }
  return tree
}
