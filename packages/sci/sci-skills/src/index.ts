/**
 * Skill catalog, content-hash sync, lifecycle curation, and listing provider
 * for the science-research agent profile.
 *
 * `apply` owns these contributions, all effects of the mounting fiber:
 *
 * - The catalog is fetched once at load from the configured skill source (an
 *   HTTP vault in deployment, a local directory in tests). A skill whose
 *   description is empty fails the load by name instead of reaching a
 *   model-visible catalog as a bare name.
 * - A `ctx.referencedText` store named after the provider resolves a skill body
 *   by its content digest, so a body reaches the model as a reference the
 *   request path expands, never inline in the session log.
 * - The non-`SKILL.md` files of the tree are reconciled into the sandbox
 *   through `ctx.fs`: only files whose content digest moved are written, and
 *   `<sandboxRoot>/.sci/skills.json` records what the sandbox holds. The body
 *   itself is never written to the sandbox.
 * - One `ctx.skills` provider lists the catalog, filtered by curation state. The
 *   sci profile mounts this provider ALONE — `skill-filesystem` is deliberately
 *   absent, because a second provider over the same directories would re-list
 *   the skills this one curates away.
 * - Two storage-domain projections fold recorded skill-tool calls into usage
 *   and usage into lifecycle state.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-skills
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-referenced-text'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { curateLifecycle, foldUsage, parseSkillToolArgument } from './lifecycle.ts'
import { SciSkillProvider } from './provider.ts'
import { LIFECYCLE_TABLE, USAGE_TABLE, sciSkillsDomainSpec } from './spec.ts'
import { createSyncFileSystem, expandSkillRoot, syncSkills } from './sync.ts'
import type { SkillSourceReader } from './hash.ts'
import type { SkillLifecycleRecord, SkillLifecycleState, SkillUsageRecord } from './types.ts'
import { DirectoryVaultSource, HttpVaultSource, type SkillCatalogEntry, type SkillVaultSource } from './vault.ts'

export { compareManifestKeys, computeSkillHash, computeSkillTreeHashes, hashFiles, nodeSkillSourceReader } from './hash.ts'
export type { SkillSourceReader } from './hash.ts'
export {
  MILLISECONDS_PER_DAY,
  REMOVED_FROM_TREE_REASON,
  curateLifecycle,
  firstSentence,
  foldUsage,
  parseSkillToolArgument,
} from './lifecycle.ts'
export type { CurationInput } from './lifecycle.ts'
export { SciSkillProvider } from './provider.ts'
export type { LoadedSkillBody, SciSkillProviderOptions } from './provider.ts'
export { SKILL_FILE, collectChapterReferences, parseSkill, parseSkillDocument, scanSkillRoot } from './scan.ts'
export type { ScannedSkill } from './scan.ts'
export { LIFECYCLE_TABLE, USAGE_TABLE, sciSkillsDomainSpec } from './spec.ts'
export {
  MANIFEST_PATH,
  SKILL_ROOT_VARIABLE,
  createSyncFileSystem,
  expandSkillRoot,
  nextManifest,
  parseManifest,
  planSync,
  syncSkills,
} from './sync.ts'
export type { SkillSyncFileSystem, SkillSyncRequest } from './sync.ts'
export {
  DirectoryVaultSource,
  HttpVaultSource,
} from './vault.ts'
export type { HttpVaultConfig, SkillCatalogEntry, SkillVaultSource } from './vault.ts'
export type {
  SciSkillsSyncedData,
  SkillLifecycleRecord,
  SkillLifecycleState,
  SkillSyncPlan,
  SkillTreeHash,
  SkillTreeManifest,
  SkillUsageRecord,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'sci-skills'

/**
 * The skill registry this provider joins, the referenced-text registry a body
 * is fetched through, the filesystem the sandbox copy is written through, and
 * the storage form holding both projections. Retraction of stale sandbox files
 * additionally uses `ctx.subprocess` when a provider sharing the filesystem's
 * execution world is mounted; it is read through `ctx.get` rather than injected,
 * because the sync is otherwise complete without it.
 */
export const inject = ['skills', 'referencedText', 'fs', 'storageDomain']

/**
 * The system-prompt chapter titles the skill bodies cite, as the display names
 * `@deepseek-ai/dsh-sci-prompt` registers them. A skill body that cites a
 * chapter is only coherent while that chapter is assembled, so this set is the
 * cross-package contract the prompt layer's invariant consumes.
 */
export const SKILL_CHAPTER_REFERENCES: ReadonlySet<string> = new Set(['Delivering files'])

/** Default staleness horizon, matching the studied platform's retirement window. */
const DEFAULT_STALE_AFTER_DAYS = 90

/** Default per-request timeout for the HTTP source. */
const DEFAULT_VAULT_TIMEOUT_MS = 10_000

/** The skill source: a local directory for tests, or the loopback HTTP vault for deployment. */
export interface SciSkillSourceConfig {
  /** `directory` reads a local tree; `http` reads the loopback skill vault. */
  readonly kind: string
  /** Absolute path of the skill root, when `kind` is `directory`. */
  readonly root: string
  /** Base URL of the vault, when `kind` is `http`. */
  readonly url: string
  /** Environment variable holding the VM's vault bearer token, when `kind` is `http`. */
  readonly tokenEnv: string
  /** Per-request timeout in milliseconds, when `kind` is `http`. */
  readonly timeoutMs: number
}

/** Deployment-varying choices for the science-research skill layer. */
export interface Config {
  /** Where skill metadata and bodies are read from. */
  source: SciSkillSourceConfig
  /**
   * Absolute path the non-`SKILL.md` files are published to inside the sandbox.
   * Required: the home layout differs per sandbox image, and a wrong guess would
   * silently publish files where the model cannot open them.
   */
  sandboxRoot: string
  /** Days of disuse after which an unpinned skill is listed by its first sentence only. */
  staleAfterDays: number
  /** Skill names exempt from ageing out, whatever their usage. */
  pinned: string[]
  /** Whether the tree is reconciled into the sandbox while the plugin loads. */
  syncOnStart: boolean
  /**
   * Name of the tool whose recorded calls count as skill loads. Defaults to
   * `skill`, the name `@deepseek-ai/dsh-tool-skill` registers; a deployment
   * that renames or shadows that tool must say so here or usage stops ageing.
   */
  skillToolName: string
  /** Unique name of this provider in the `ctx.skills` registry and of its referenced-text store. */
  providerName: string
}

/** Schemastery schema for the science-research skill layer. */
export const Config: z<Config> = z.object({
  source: z.object({
    kind: z.string().default('directory'),
    root: z.string().default(''),
    url: z.string().default(''),
    tokenEnv: z.string().default('SCI_VAULT_TOKEN'),
    timeoutMs: z.number().step(1).min(1).default(DEFAULT_VAULT_TIMEOUT_MS),
  }).default({ kind: 'directory', root: '', url: '', tokenEnv: 'SCI_VAULT_TOKEN', timeoutMs: DEFAULT_VAULT_TIMEOUT_MS }),
  sandboxRoot: z.string().required(),
  staleAfterDays: z.number().step(1).min(1).default(DEFAULT_STALE_AFTER_DAYS),
  pinned: z.array(z.string()).default([]),
  syncOnStart: z.boolean().default(true),
  skillToolName: z.string().default('skill'),
  providerName: z.string().default('sci'),
})

/**
 * Resolve the configured skill source, failing loud on a self-contained
 * misconfiguration at load.
 * @param config - the resolved plugin configuration.
 * @returns the source the plugin reads its catalog and bodies from.
 */
function buildSource(config: Config): SkillVaultSource {
  const source = config.source
  switch (source.kind) {
    case 'directory':
      if (source.root === '') throw new Error('sci-skills: source.kind "directory" requires source.root')
      return new DirectoryVaultSource(source.root)
    case 'http': {
      if (source.url === '') throw new Error('sci-skills: source.kind "http" requires source.url')
      const token = process.env[source.tokenEnv]
      if (token === undefined || token === '') {
        throw new Error(`sci-skills: source.kind "http" requires the ${source.tokenEnv} environment variable`)
      }
      return new HttpVaultSource({ url: source.url.replace(/\/$/, ''), token, timeoutMs: source.timeoutMs })
    }
    default:
      throw new Error(`sci-skills: unknown source.kind "${source.kind}"`)
  }
}

/**
 * The skill name at the end of a sync directory argument. The sync machinery
 * joins a root onto each name; the source reads by name alone, so the reader
 * recovers it from the trailing path segment and ignores the root.
 * @param directory - a `<root>/<name>` directory argument.
 * @returns the skill name, or the empty string when the argument holds none.
 */
export function skillNameOf(directory: string): string {
  const segments = directory.split('/').filter(segment => segment !== '')
  return segments[segments.length - 1] ?? ''
}

/**
 * Load the stored rows of one projection table into a map.
 * @param table - the opened table.
 * @returns every stored row, keyed by skill name.
 */
function snapshot<V>(table: KvTable<string, V>): Map<string, V> {
  return new Map(table.entries())
}

/**
 * Persist the rows a curation round changed.
 * @param table - the lifecycle table.
 * @param stored - the rows before the round.
 * @param projected - the rows after it.
 */
async function persistLifecycle(
  table: KvTable<string, SkillLifecycleRecord>,
  stored: ReadonlyMap<string, SkillLifecycleRecord>,
  projected: ReadonlyMap<string, SkillLifecycleRecord>,
): Promise<void> {
  for (const [skillName, record] of projected) {
    if (stored.get(skillName) !== record) await table.put(skillName, record)
  }
}

/**
 * Register the science-research skill layer on the mounting context.
 *
 * Load order is deliberate: the catalog is fetched before anything else so a
 * defective source fails the load, the body store and provider are registered
 * before the listing is advertised, the sandbox files are published, and the
 * session listeners attach last so no event is projected against an unopened
 * table.
 * @param ctx - the mounting context, carrying `skills`, `referencedText`, `fs`, and `storageDomain`.
 * @param config - the resolved deployment configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const source = buildSource(config)
  const catalog: readonly SkillCatalogEntry[] = await source.catalog()
  for (const entry of catalog) {
    if (entry.description.trim() === '') {
      throw new Error(`sci-skills: skill "${entry.name}" has an empty description; every listed skill must state when to use it`)
    }
  }
  const names = catalog.map(entry => entry.name)
  const byName = new Map(catalog.map(entry => [entry.name, entry]))
  const pinned = new Set(config.pinned)

  /**
   * Fetch one catalog entry's body and expand its sandbox-root variable. The
   * digest is over the expanded text the model actually receives, recording
   * exactly what the reference substituted when it was logged.
   * @param entry - the catalog entry to load.
   * @param signal - cancels the fetch.
   * @returns the expanded body and its digest.
   */
  const loadSkillBody = async (entry: SkillCatalogEntry, signal?: AbortSignal): Promise<{ content: string; sha256: string }> => {
    const raw = await source.object(entry.bodySha256, signal)
    const content = expandSkillRoot(raw, config.sandboxRoot)
    return { content, sha256: createHash('sha256').update(content, 'utf8').digest('hex') }
  }

  // A live store: a logged reference follows the catalog's current body, so a
  // skill update never strands the sessions that loaded an earlier version.
  // The recorded sha256 is the digest of the expanded body the model first
  // saw; for a skill the catalog no longer lists, it recovers the recorded
  // raw body from the source's permanent object store — exact only while the
  // body contains no `$SCI_SKILL_ROOT`, since expansion moves the digest.
  ctx.referencedText.registerStore(config.providerName, {
    mode: 'live',
    read: async (ref, signal) => {
      const entry = byName.get(ref.id)
      if (entry !== undefined) return (await loadSkillBody(entry, signal)).content
      try {
        return expandSkillRoot(await source.object(ref.sha256, signal), config.sandboxRoot)
      } catch (cause) {
        throw new Error(`sci-skills: unknown skill "${ref.id}" and no stored body ${ref.sha256}`, { cause })
      }
    },
  })

  const domain = await ctx.storageDomain.open(sciSkillsDomainSpec)
  ctx.effect(() => () => domain.close(), 'sci-skills.domainClose')
  const usageTable = domain.table(USAGE_TABLE)
  const lifecycleTable = domain.table(LIFECYCLE_TABLE)

  const states = new Map<string, SkillLifecycleState>()
  /**
   * Re-project lifecycle state from the current usage rows and persist the
   * difference. Called once at load and after every recorded skill load.
   */
  const recurate = async (): Promise<void> => {
    const stored = snapshot(lifecycleTable)
    const projected = curateLifecycle({
      present: names,
      usage: snapshot(usageTable),
      stored,
      pinned,
      staleAfterDays: config.staleAfterDays,
      now: Date.now(),
    })
    await persistLifecycle(lifecycleTable, stored, projected)
    states.clear()
    for (const [skillName, record] of projected) states.set(skillName, record.state)
  }
  await recurate()

  ctx.skills.registerProvider(() => new SciSkillProvider({
    providerName: config.providerName,
    catalog,
    sandboxRoot: config.sandboxRoot,
    lifecycleStates: () => states,
    loadSkillBody,
  }))

  /**
   * Tail of the recorded-usage chain. `session/event` is synchronous, so two
   * recorded loads in one tick would otherwise both read the same stored row
   * and the second `put` would drop the first's increment; each listener call
   * appends to this promise instead. The chain absorbs its own failures — a
   * floating rejection here would take the process down under Node's default
   * `--unhandled-rejections=throw`, and one unrecorded load must not.
   */
  let usage: Promise<void> = Promise.resolve()
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'tool/call' || event.data.name !== config.skillToolName) return
    const skillName = parseSkillToolArgument(event.data.arguments)
    if (skillName === undefined || !names.includes(skillName)) return
    usage = usage
      .then(() => recordUsage(usageTable, skillName, session, event.time))
      .then(recurate)
      .catch((error: unknown) => {
        ctx.logger.warn(`sci-skills could not record the load of skill "${skillName}": ${String(error)}`)
      })
  })

  if (!config.syncOnStart) return
  // A sync round lists and reads files by the `names` this scope published, so
  // the catalog entry is always present — a same-process invariant, not a
  // runtime input to validate. It never lists skill names, so this reader omits
  // that method.
  const syncReader: Pick<SkillSourceReader, 'listFiles' | 'readFile'> = {
    // The reader is only ever called with the `names` published above, so the
    // catalog entry is always present — a same-process invariant, not input.
    // oxlint-disable-next-line no-non-null-assertion
    listFiles: directory => Promise.resolve(Object.keys(byName.get(skillNameOf(directory))!.files)),
    readFile: (directory, relativePath) => source.file(skillNameOf(directory), relativePath),
  }
  const synced = await syncSkills({
    skillRoot: '',
    sandboxRoot: config.sandboxRoot,
    names,
    source: syncReader,
    target: createSyncFileSystem(ctx, config.sandboxRoot),
    warn: (message) => { ctx.logger.warn(message) },
  })
  ctx.on('session/created', (session: Session) => {
    session.append('sci/skills-synced', synced, { ignorable: true })
  })
}

/**
 * Fold one recorded skill load into the usage table.
 * @param table - the usage table.
 * @param skillName - the loaded skill.
 * @param session - the session whose log recorded the call.
 * @param at - epoch milliseconds of the recorded call.
 */
function recordUsage(
  table: KvTable<string, SkillUsageRecord>,
  skillName: string,
  session: Session,
  at: number,
): Promise<void> {
  return table.put(skillName, foldUsage(table.get(skillName), skillName, session.header.id, at))
}
