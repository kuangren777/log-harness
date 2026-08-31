/**
 * The `ctx.skills` provider for the science-research skill catalog.
 *
 * This is the only provider the sci profile mounts: `skill-filesystem` is left
 * out on purpose, because a second provider scanning the same directories would
 * re-list the skills this one curates away. The listing carries only metadata;
 * a body is fetched from the skill source when `get()` is called and returned
 * as a content-addressed reference, so the body never enters the catalog and
 * never persists on the sandbox disk.
 * @module @deepseek-ai/dsh-sci-skills/src/provider
 */

import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { firstSentence } from './lifecycle.ts'
import { SKILL_FILE } from './scan.ts'
import type { SkillLifecycleState } from './types.ts'
import type { SkillCatalogEntry } from './vault.ts'

/** An expanded skill body and the digest of that exact text. */
export interface LoadedSkillBody {
  /** The body with `$SCI_SKILL_ROOT` expanded to the sandbox skill root. */
  readonly content: string
  /** sha256 hex of {@link content}; the reference commitment the resolver verifies. */
  readonly sha256: string
}

/** Everything the provider needs, with the lifecycle lookup and body loader injected. */
export interface SciSkillProviderOptions {
  /** Unique provider name in the `ctx.skills` registry; also the referenced-text store name. */
  readonly providerName: string
  /** The catalog metadata, in stable name order. */
  readonly catalog: readonly SkillCatalogEntry[]
  /** Absolute path of the skill root inside the sandbox. */
  readonly sandboxRoot: string
  /**
   * Read the current curation projection. Called per listing so a skill that
   * ages between two listings is filtered by its new state; a skill the
   * projection does not carry yet reads as `active`.
   * @returns the states of the projected skills, keyed by skill name.
   */
  readonly lifecycleStates: () => ReadonlyMap<string, SkillLifecycleState>
  /**
   * Fetch and expand one catalog entry's body.
   * @param entry - the catalog entry whose body to load.
   * @param signal - cancels the fetch.
   * @returns the expanded body and its digest.
   */
  readonly loadSkillBody: (entry: SkillCatalogEntry, signal?: AbortSignal) => Promise<LoadedSkillBody>
}

/** Locator handed back to {@link SciSkillProvider.get}. */
interface SciSkillLocator {
  readonly skillName: string
}

/**
 * Render the description a lifecycle state permits.
 * @param entry - the catalog entry.
 * @param state - its curation state.
 * @returns the catalog description, or `undefined` when the skill is not listed.
 */
function visibleDescription(entry: SkillCatalogEntry, state: SkillLifecycleState): string | undefined {
  switch (state) {
    case 'active':
      return entry.description
    case 'stale':
      return firstSentence(entry.description)
    case 'archived':
      return undefined
  }
}

/** Provider mapping the skill catalog into `ctx.skills`, filtered by lifecycle state. */
export class SciSkillProvider implements SkillProvider {
  readonly name: string
  private readonly byName: ReadonlyMap<string, SkillCatalogEntry>

  /** @param options - provider identity, the catalog, the lifecycle lookup, and the body loader. */
  constructor(private readonly options: SciSkillProviderOptions) {
    this.name = options.providerName
    this.byName = new Map(options.catalog.map(entry => [entry.name, entry]))
  }

  /**
   * List the curated catalog. The catalog is fetched once at load and is
   * cwd-independent, so the lookup options select nothing and discovery is
   * always complete.
   * @returns one candidate per listed skill, with archived skills omitted.
   */
  list(): Promise<readonly SkillCandidate[]> {
    const candidates: SkillCandidate[] = []
    for (const entry of this.options.catalog) {
      const description = visibleDescription(entry, this.options.lifecycleStates().get(entry.name) ?? 'active')
      if (description === undefined) continue
      candidates.push({ ...this.summary(entry, description), rank: BUNDLED_SKILL_RANK, locator: { skillName: entry.name } })
    }
    return Promise.resolve(candidates)
  }

  /**
   * Load one listed skill's body as a content-addressed reference.
   * @param candidate - a candidate this provider returned from {@link list}.
   * @param options - lookup options; only `signal` is consulted.
   * @returns the full definition, or `undefined` once the skill stopped being listed.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const entry = this.byName.get((candidate.locator as SciSkillLocator).skillName)
    if (entry === undefined) return undefined
    const description = visibleDescription(entry, this.options.lifecycleStates().get(entry.name) ?? 'active')
    if (description === undefined) return undefined
    const body = await this.options.loadSkillBody(entry, options.signal)
    return {
      ...this.summary(entry, description),
      content: body.content,
      reference: { store: this.name, id: entry.name, sha256: body.sha256 },
    }
  }

  /**
   * Build the invocation-neutral summary shared by candidates and definitions.
   * @param entry - the catalog entry.
   * @param description - the description its lifecycle state permits.
   * @returns the summary, pointing at the skill's sandbox resource directory.
   */
  private summary(entry: SkillCatalogEntry, description: string): Omit<SkillCandidate, 'rank' | 'locator'> {
    const directory = `${this.options.sandboxRoot}/${entry.name}`
    return {
      name: entry.name,
      description,
      ...entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse },
      invocation: entry.invocation,
      source: 'bundled',
      provider: this.name,
      resourceBase: { kind: 'directory', path: directory },
      path: `${directory}/${SKILL_FILE}`,
      ...entry.metadata === undefined ? {} : { metadata: entry.metadata },
    }
  }
}
