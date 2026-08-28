/**
 * Reconciliation of the bundled skill tree into the sandbox.
 *
 * The studied platform re-pushed a whole skill directory whenever its
 * hand-maintained revision string moved. Here the sandbox carries a manifest of
 * the digests it already holds, so a round writes exactly the files whose
 * content changed and retracts exactly the files the local tree dropped.
 * @module @deepseek-ai/dsh-sci-skills/src/sync
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
// Type-only: merges the optional `subprocess` service this module reads off Context.
import type {} from '@deepseek-ai/dsh-subprocess'
import { compareManifestKeys, computeSkillTreeHashes, hashFiles, nodeSkillSourceReader, type SkillSourceReader } from './hash.ts'
import type { SciSkillsSyncedData, SkillSyncPlan, SkillTreeHash, SkillTreeManifest } from './types.ts'

/**
 * The variable skill bodies use for their own on-disk location. Expanded to
 * the sandbox skill root while a file is written, so one SKILL.md is correct
 * both in this repository and inside the sandbox. A protocol constant shared
 * with the skill bodies, not a deployment choice.
 */
export const SKILL_ROOT_VARIABLE = '$SCI_SKILL_ROOT'

/** Sandbox-relative location of the digest manifest, under the skill root. */
export const MANIFEST_PATH = '.sci/skills.json'

/**
 * Terminate-escalation grace for the retraction command. It bounds teardown of
 * a `rm` that is already only waiting on the filesystem, so it is a fixed
 * lifecycle constant rather than a deployment-varying limit.
 */
const REMOVE_GRACE_MS = 5_000

/** Byte cap on the retained retraction diagnostics; a failure message, not a data channel. */
const REMOVE_STDERR_MAX_BYTES = 8 * 1024

/** Write side of one sync round: the sandbox filesystem, or a test double. */
export interface SkillSyncFileSystem {
  /**
   * Read one sandbox file.
   * @param path - absolute path in the sandbox.
   * @returns the decoded content, or `undefined` when the file is absent.
   */
  readonly read: (path: string) => Promise<string | undefined>
  /**
   * Report whether one sandbox path is present, without reading its content.
   * @param path - absolute path in the sandbox.
   * @returns true when something exists at the path.
   */
  readonly exists: (path: string) => Promise<boolean>
  /**
   * Create or replace one sandbox file, creating parent directories.
   * @param path - absolute path in the sandbox.
   * @param content - the full new content.
   */
  readonly write: (path: string, content: string) => Promise<void>
  /**
   * Retract sandbox files that the local tree no longer contains.
   * @param paths - absolute paths in the sandbox.
   * @returns the paths actually removed; empty when no retraction capability is mounted.
   */
  readonly remove: (paths: readonly string[]) => Promise<readonly string[]>
}

/** Everything one sync round needs, with both filesystems injected. */
export interface SkillSyncRequest {
  /** Absolute path of the bundled skill root on the host. */
  readonly skillRoot: string
  /** Absolute path of the skill root inside the sandbox. */
  readonly sandboxRoot: string
  /** Skill names to publish; the sandbox loses anything outside this list. */
  readonly names: readonly string[]
  /** Read side of the bundled tree; a sync round lists and reads files, never skill names. */
  readonly source: Pick<SkillSourceReader, 'listFiles' | 'readFile'>
  /** Write side in the sandbox. */
  readonly target: SkillSyncFileSystem
  /**
   * Diagnostic sink for sandbox manifest entries this round refuses to act on.
   * Called once per dropped key; a round never fails because of one.
   */
  readonly warn: (message: string) => void
}

/**
 * Split a `<skill>/<relative path>` entry into its two parts.
 * @param path - a sync-plan entry.
 * @returns the skill name and the path relative to that skill's directory.
 */
function splitEntry(path: string): { skill: string; relativePath: string } {
  const boundary = path.indexOf('/')
  return { skill: path.slice(0, boundary), relativePath: path.slice(boundary + 1) }
}

/**
 * Decide which files one sync round must write and retract.
 *
 * A file is written when the sandbox holds no digest for it, holds a different
 * one, or claims the matching digest for a file that is no longer there: the
 * manifest is the sandbox's own claim, so a file deleted out of band would
 * otherwise never come back. Retraction covers every digest the sandbox holds
 * that the local tree no longer produces, including every file of a skill that
 * disappeared. The result is sorted so a plan is comparable across runs.
 * @param local - digests of the bundled tree, keyed by skill name.
 * @param remote - digests the sandbox manifest claims, keyed by skill name.
 * @param published - existence probe for a `<skill>/<relative path>` entry the
 *   digests agree on; only these are probed, so an unchanged tree costs one
 *   stat per file and no reads.
 * @returns the `<skill>/<relative path>` entries to write and to retract.
 */
export async function planSync(
  local: SkillTreeManifest,
  remote: SkillTreeManifest,
  published: (path: string) => Promise<boolean>,
): Promise<SkillSyncPlan> {
  const write: string[] = []
  const remove: string[] = []
  const unchanged: string[] = []
  for (const [skill, tree] of Object.entries(local)) {
    const known = remote[skill]
    for (const [relativePath, digest] of Object.entries(tree.files)) {
      const path = `${skill}/${relativePath}`
      if (known?.files[relativePath] === digest) unchanged.push(path)
      else write.push(path)
    }
  }
  const probed = await Promise.all(unchanged.map(async path => ({ path, present: await published(path) })))
  for (const { path, present } of probed) {
    if (!present) write.push(path)
  }
  for (const [skill, tree] of Object.entries(remote)) {
    const current = local[skill]
    for (const relativePath of Object.keys(tree.files)) {
      if (current?.files[relativePath] === undefined) remove.push(`${skill}/${relativePath}`)
    }
  }
  return { write: write.sort(), remove: remove.sort() }
}

/**
 * Expand the skill-root variable a skill body uses for its own location.
 * @param content - the file content as it ships in this repository.
 * @param sandboxRoot - absolute path of the skill root inside the sandbox.
 * @returns the content as the sandbox should hold it.
 */
export function expandSkillRoot(content: string, sandboxRoot: string): string {
  return content.replaceAll(SKILL_ROOT_VARIABLE, sandboxRoot)
}

/**
 * Project the manifest the sandbox holds after a round.
 *
 * Anything written or already current is recorded from the local tree; a
 * planned retraction that did not happen keeps its old digest so the next
 * round retries it instead of forgetting the file exists.
 * @param local - digests of the bundled tree.
 * @param remote - digests the sandbox manifest claimed before the round.
 * @param retained - planned retractions that did not happen.
 * @returns the manifest to write back.
 */
export function nextManifest(
  local: SkillTreeManifest,
  remote: SkillTreeManifest,
  retained: readonly string[],
): SkillTreeManifest {
  const files = new Map<string, Record<string, string>>()
  for (const [skill, tree] of Object.entries(local)) files.set(skill, { ...tree.files })
  for (const path of retained) {
    const { skill, relativePath } = splitEntry(path)
    const digest = remote[skill]?.files[relativePath]
    if (digest === undefined) continue
    const entry = files.get(skill) ?? {}
    entry[relativePath] = digest
    files.set(skill, entry)
  }
  const manifest: Record<string, SkillTreeHash> = {}
  for (const [skill, entry] of [...files].sort(([left], [right]) => compareManifestKeys(left, right))) {
    manifest[skill] = { hash: hashFiles(entry), files: entry }
  }
  return manifest
}

/** Path separators a manifest key may carry, on either host platform. */
const PATH_SEPARATOR = /[/\\]/

/** A key rooted at a filesystem root rather than at the skill root. */
const ABSOLUTE_KEY = /^[/\\]/

/** A key rooted at a Windows drive or share, `C:` or `C:\\dir`. */
const DRIVE_QUALIFIED_KEY = /^[A-Za-z]:/

/**
 * Explain why a manifest key may not be joined onto the sandbox skill root.
 *
 * Every key of the sandbox manifest becomes an argument of the retraction
 * `rm`, and the manifest is a durable file the sandbox side writes, so a key
 * that escapes the skill root is the one input this package must never trust.
 * @param key - the raw key as the manifest carried it.
 * @param nested - whether the key may itself contain path separators.
 * @returns the rejection reason, or `undefined` when the key stays inside the root.
 */
function keyRejection(key: string, nested: boolean): string | undefined {
  if (key === '') return 'is empty'
  if (ABSOLUTE_KEY.test(key)) return 'is absolute'
  if (DRIVE_QUALIFIED_KEY.test(key)) return 'is drive-qualified'
  if (!nested && PATH_SEPARATOR.test(key)) return 'contains a path separator'
  if (key.split(PATH_SEPARATOR).includes('..')) return 'contains a ".." segment'
  return undefined
}

/**
 * Parse the sandbox manifest, treating an absent or unreadable one as empty.
 *
 * The manifest is a durable file the sandbox side can corrupt, truncate, or
 * craft, so an unparseable one is a full re-publish rather than a load failure:
 * every file is then written from the local tree, which is the correct end
 * state. A key that would leave the sandbox skill root is dropped with a
 * warning instead: the file it names is then neither written nor retracted,
 * and the round proceeds on the keys that remain.
 * @param raw - the manifest file content, or `undefined` when absent.
 * @param warn - diagnostic sink, called once per dropped key.
 * @returns the digests the sandbox claims, restricted to keys inside the root.
 */
export function parseManifest(raw: string | undefined, warn: (message: string) => void): SkillTreeManifest {
  if (raw === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupt manifest is indistinguishable from an empty one for this
    // package's purposes and nothing else reads the file.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const manifest: Record<string, SkillTreeHash> = {}
  for (const [skill, value] of Object.entries(parsed as Record<string, unknown>)) {
    const skillRejection = keyRejection(skill, false)
    if (skillRejection !== undefined) {
      warn(`sci-skills ignored sandbox manifest entry "${skill}": the skill key ${skillRejection}`)
      continue
    }
    const files = (value as { files?: unknown } | null)?.files
    if (typeof files !== 'object' || files === null || Array.isArray(files)) continue
    const digests: Record<string, string> = {}
    for (const [relativePath, digest] of Object.entries(files as Record<string, unknown>)) {
      const fileRejection = keyRejection(relativePath, true)
      if (fileRejection !== undefined) {
        warn(`sci-skills ignored sandbox manifest entry "${skill}/${relativePath}": the file key ${fileRejection}`)
        continue
      }
      if (typeof digest === 'string') digests[relativePath] = digest
    }
    manifest[skill] = { hash: hashFiles(digests), files: digests }
  }
  return manifest
}

/**
 * Publish the bundled skill tree into the sandbox, writing only what changed.
 * @param request - both filesystems, both roots, and the skills to publish.
 * @returns the sandbox-relative paths written and removed in this round.
 */
export async function syncSkills(request: SkillSyncRequest): Promise<SciSkillsSyncedData> {
  const { skillRoot, sandboxRoot, names, source, target, warn } = request
  const local = await computeSkillTreeHashes(skillRoot, names, source)
  const remote = parseManifest(await target.read(`${sandboxRoot}/${MANIFEST_PATH}`), warn)
  const plan = await planSync(local, remote, path => target.exists(`${sandboxRoot}/${path}`))
  for (const path of plan.write) {
    const { skill, relativePath } = splitEntry(path)
    const content = await source.readFile(`${skillRoot}/${skill}`, relativePath)
    await target.write(`${sandboxRoot}/${path}`, expandSkillRoot(content, sandboxRoot))
  }
  const removedPaths = await target.remove(plan.remove.map(path => `${sandboxRoot}/${path}`))
  const removed = new Set(removedPaths)
  const retained = plan.remove.filter(path => !removed.has(`${sandboxRoot}/${path}`))
  await target.write(
    `${sandboxRoot}/${MANIFEST_PATH}`,
    `${JSON.stringify(nextManifest(local, remote, retained), null, 2)}\n`,
  )
  return { changed: plan.write, removed: plan.remove.filter(path => removed.has(`${sandboxRoot}/${path}`)) }
}

/**
 * Bind one sync round to the mounted filesystem and, when present, the
 * subprocess capability that shares its execution world.
 *
 * `ctx.fs` has no unlink verb, so retraction crosses to `ctx.subprocess` — the
 * documented bridge is {@link FileSystem.processPath}, which yields the path a
 * process in the filesystem's own execution world can open. Without a
 * subprocess provider nothing is removed and the manifest keeps the stale
 * entries, so the next round with one mounted retries them.
 * Retraction is confined twice: {@link parseManifest} drops a manifest key that
 * would leave the skill root, and this side re-checks every resolved target
 * against the root before `rm` exists as a process. The second check is the
 * load-bearing one — `ctx.fs` policy never observes a subprocess, so a path
 * that reached the argv would be deleted whatever the filesystem allows.
 * @param ctx - the mounting context, carrying `fs` and optionally `subprocess`.
 * @param sandboxRoot - absolute path of the skill root inside the sandbox; no
 *   file outside it is ever retracted.
 * @returns the write side of a sync round.
 */
export function createSyncFileSystem(ctx: Context, sandboxRoot: string): SkillSyncFileSystem {
  const fs: FileSystem = ctx.fs
  return {
    read: async (path) => {
      const target = await fs.resolve(path)
      const info = await fs.stat(target)
      return info === undefined ? undefined : await fs.readText(target)
    },
    exists: async path => await fs.stat(await fs.resolve(path)) !== undefined,
    write: async (path, content) => {
      await fs.writeText(await fs.resolve(path), content)
    },
    remove: async (paths) => {
      const subprocess = ctx.get('subprocess')
      if (paths.length === 0 || subprocess === undefined) return []
      const root = await fs.resolve(sandboxRoot)
      const targets = await Promise.all(paths.map(async path => ({ path, target: await fs.resolve(path) })))
      for (const { path, target } of targets) {
        if (fs.contains(root, target)) continue
        throw new Error(`sci-skills refused to retract "${path}": it resolves to ${fs.processPath(target)}, outside the sandbox skill root ${sandboxRoot}`)
      }
      const handle = subprocess.spawn({
        argv: ['rm', '-f', '--', ...targets.map(({ target }) => fs.processPath(target))],
        cwd: fs.processPath(root),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: REMOVE_STDERR_MAX_BYTES },
          stderr: { maxBytes: REMOVE_STDERR_MAX_BYTES },
        },
        graceMs: REMOVE_GRACE_MS,
      })
      const outcome = await handle.done
      if (outcome.exitCode !== 0) {
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        throw new Error(`sci-skills could not retract ${paths.length} stale skill file(s): rm exited ${String(outcome.exitCode)} ${stderr}`.trim())
      }
      return paths
    },
  }
}

export { nodeSkillSourceReader }
