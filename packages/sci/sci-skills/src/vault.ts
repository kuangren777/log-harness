/**
 * The source of the science-research skill catalog and bodies.
 *
 * The studied platform shipped every skill body inside the agent image and on
 * the sandbox disk, where the model — and therefore its operator — could read
 * it. Here a body is platform property: the listing metadata is served, but a
 * body is fetched by its content digest only when a request is built, and it is
 * never written to the sandbox. Two sources implement the same three reads: an
 * HTTP vault for deployment, and a local directory for tests and development.
 * @module @deepseek-ai/dsh-sci-skills/src/vault
 */

import { createHash } from 'node:crypto'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import { nodeSkillSourceReader, type SkillSourceReader } from './hash.ts'
import { SKILL_FILE, scanSkillRoot } from './scan.ts'

/**
 * One skill's listing metadata plus the digests that address its body and its
 * non-`SKILL.md` files. The body itself is absent: it is fetched by
 * {@link SkillVaultSource.object} only when a request needs it.
 */
export interface SkillCatalogEntry {
  /** Kebab-case skill name, equal to its directory name. */
  readonly name: string
  /** Routing description shown in the catalog. */
  readonly description: string
  /** Extra routing guidance from frontmatter. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Frontmatter `metadata` object when the skill declares one. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** sha256 hex of the unexpanded `SKILL.md` body; the key {@link SkillVaultSource.object} answers. */
  readonly bodySha256: string
  /** sha256 hex of each non-`SKILL.md` file, keyed by slash-separated path relative to the skill directory. */
  readonly files: Readonly<Record<string, string>>
}

/**
 * The three reads the sci-skills plugin performs against its skill source. Both
 * a body and a file are addressed so the plugin never trusts a path it did not
 * first see in the catalog.
 */
export interface SkillVaultSource {
  /**
   * List every skill's metadata and digests.
   * @param signal - cancels the read.
   * @returns the catalog in stable name order.
   */
  readonly catalog: (signal?: AbortSignal) => Promise<readonly SkillCatalogEntry[]>
  /**
   * Fetch one unexpanded body by its content digest.
   * @param sha256 - the `bodySha256` a catalog entry carries.
   * @param signal - cancels the read.
   * @returns the body exactly as the digest addresses it.
   */
  readonly object: (sha256: string, signal?: AbortSignal) => Promise<string>
  /**
   * Fetch one non-`SKILL.md` file's content, for publication into the sandbox.
   * @param name - the owning skill's name.
   * @param relativePath - slash-separated path relative to the skill directory.
   * @param signal - cancels the read.
   * @returns the file content.
   */
  readonly file: (name: string, relativePath: string, signal?: AbortSignal) => Promise<string>
}

/** hex sha256 of one string's UTF-8 encoding. */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * A skill source backed by a local directory, for tests and development. It
 * reads the same tree the studied platform bundled, but presents it through the
 * vault contract so the plugin's remote and local paths are one code path.
 */
export class DirectoryVaultSource implements SkillVaultSource {
  private cache: {
    entries: readonly SkillCatalogEntry[]
    bodies: Map<string, string>
  } | undefined

  /**
   * @param root - absolute path of the skill root.
   * @param reader - read side of the tree; defaults to the host filesystem.
   */
  constructor(
    private readonly root: string,
    private readonly reader: SkillSourceReader = nodeSkillSourceReader,
  ) {}

  /**
   * Scan the tree once, memoising the catalog and a digest-to-body map.
   * @returns the parsed source.
   */
  private async load(): Promise<{ entries: readonly SkillCatalogEntry[]; bodies: Map<string, string> }> {
    if (this.cache !== undefined) return this.cache
    const scanned = await scanSkillRoot(this.root, this.reader)
    const bodies = new Map<string, string>()
    const entries: SkillCatalogEntry[] = []
    for (const skill of scanned) {
      bodies.set(skill.bodySha256, skill.content)
      const files: Record<string, string> = {}
      for (const relativePath of await this.reader.listFiles(`${this.root}/${skill.name}`)) {
        if (relativePath === SKILL_FILE) continue
        files[relativePath] = sha256(await this.reader.readFile(`${this.root}/${skill.name}`, relativePath))
      }
      entries.push({
        name: skill.name,
        description: skill.description,
        ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
        invocation: skill.invocation,
        ...skill.metadata === undefined ? {} : { metadata: skill.metadata },
        bodySha256: skill.bodySha256,
        files,
      })
    }
    this.cache = { entries, bodies }
    return this.cache
  }

  async catalog(): Promise<readonly SkillCatalogEntry[]> {
    return (await this.load()).entries
  }

  async object(sha256Digest: string): Promise<string> {
    const body = (await this.load()).bodies.get(sha256Digest)
    if (body === undefined) throw new Error(`sci-skills: no skill body with digest ${sha256Digest}`)
    return body
  }

  async file(name: string, relativePath: string): Promise<string> {
    return await this.reader.readFile(`${this.root}/${name}`, relativePath)
  }
}

/** Deployment configuration for {@link HttpVaultSource}. */
export interface HttpVaultConfig {
  /** Base URL of the vault, without a trailing slash. */
  readonly url: string
  /** Bearer token this VM presents; read from the environment, never logged. */
  readonly token: string
  /** Per-request timeout. */
  readonly timeoutMs: number
}

/**
 * A skill source backed by the loopback HTTP vault. The plugin fetches the
 * catalog exactly once at load, so no cache lives here; each call is one bearer
 * request with a bounded timeout, failing loud on a non-2xx status.
 */
export class HttpVaultSource implements SkillVaultSource {
  /** @param config - vault URL, bearer token, and per-request timeout. */
  constructor(private readonly config: HttpVaultConfig) {}

  /**
   * Fetch one vault path as text, with the bearer and a bounded timeout.
   * @param path - the path below the base URL.
   * @param signal - caller cancellation, combined with the timeout.
   * @returns the response body text.
   */
  private async get(path: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(`${this.config.url}${path}`, {
      headers: { authorization: `Bearer ${this.config.token}` },
      signal: composed,
    })
    if (!response.ok) throw new Error(`sci-skills: vault GET ${path} returned ${String(response.status)}`)
    return await response.text()
  }

  async catalog(signal?: AbortSignal): Promise<readonly SkillCatalogEntry[]> {
    const raw = await this.get('/v1/catalog', signal)
    return (JSON.parse(raw) as { skills: readonly SkillCatalogEntry[] }).skills
  }

  async object(sha256Digest: string, signal?: AbortSignal): Promise<string> {
    return await this.get(`/v1/objects/${sha256Digest}`, signal)
  }

  async file(name: string, relativePath: string, signal?: AbortSignal): Promise<string> {
    return await this.get(`/v1/skills/${name}/files/${relativePath}`, signal)
  }
}
