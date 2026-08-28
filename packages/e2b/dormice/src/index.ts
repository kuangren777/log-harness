/**
 * Dormice Service Provider for the E2B sandbox seam. One long-lived sandbox
 * per user key: acquired by name through Dormice's native API, reached with
 * the official E2B SDK over the daemon's compatibility surface, and left
 * running when the harness disposes so the daemon's own lifecycle policy
 * freezes it with its filesystem intact.
 * @module @deepseek-ai/dsh-dormice
 */

import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  E2BRuntime,
  FileType,
  Sandbox,
  e2bControlEnvs,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'
import type { DormiceAcquireResponse, DormiceLifecyclePolicy, DormiceSandboxRecord } from './types.ts'

export type { DormiceAcquireResponse, DormiceLifecyclePolicy, DormiceSandboxRecord } from './types.ts'

/**
 * Prefix the official `e2b` SDK requires on every API key. Dormice accepts
 * the bare token too, but the SDK rejects an unprefixed key client-side
 * before any request leaves the process, so the prefix is not optional here.
 */
const E2B_KEY_PREFIX = 'e2b_'

/** The one rejection disposal produces, whether it interrupts a poll, a request, or a later call. */
const DISPOSING = 'dsh-dormice: sandbox service is disposing'

/** Configuration for the Dormice-backed sandbox owner. */
export interface Config {
  /** Base URL of the Dormice daemon, without a trailing path. */
  endpoint?: string
  /** Daemon API token; omission reads `DORMICE_API_TOKEN`. It is never forwarded into the sandbox. */
  token?: string
  /** Sandbox address to acquire. The same key always returns the same sandbox with its files intact. */
  userKey: string
  /** Registered Dormice template to create the sandbox from; omission uses the daemon's base image. */
  image?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** Lifecycle thresholds applied only when this acquire creates the sandbox; omission leaves every threshold to the daemon. */
  policy?: DormiceLifecyclePolicy
  /** Deadline in milliseconds for the whole acquisition, archive restore included. */
  acquireTimeoutMs?: number
  /** Delay between acquire polls while an archived sandbox is being restored. */
  restorePollIntervalMs?: number
}

interface ResolvedConfig {
  endpoint: string
  token: string
  userKey: string
  image: string | undefined
  policy: DormiceLifecyclePolicy | undefined
  acquireTimeoutMs: number
  restorePollIntervalMs: number
}

interface SchemaResolvedConfig extends Config {
  endpoint: string
  cwd: string
  policy: DormiceLifecyclePolicy
  acquireTimeoutMs: number
  restorePollIntervalMs: number
}

/**
 * Owns one Dormice sandbox addressed by {@link Config.userKey}. Acquisition is
 * lazy and single-flight: the first {@link getSandbox} call acquires, later
 * calls await that one attempt, and a failed attempt is not cached so a
 * transient daemon failure does not poison the service. Disposal never
 * deletes the sandbox — killing it would discard the user's whole workspace.
 */
export class DormiceRuntime extends E2BRuntime {
  static Config: z<Config> = z.object({
    endpoint: z.string().default('http://127.0.0.1:3676'),
    token: z.string(),
    userKey: z.string().required(),
    image: z.string(),
    cwd: z.string().default('/home/user/sci'),
    policy: z.object({
      freezeAfterSeconds: z.number(),
      stopAfterSeconds: z.union([z.number(), z.const(null)]),
      archiveAfterSeconds: z.union([z.number(), z.const(null)]),
    }),
    acquireTimeoutMs: z.number().default(120_000),
    restorePollIntervalMs: z.number().default(1_000),
  })

  private readonly config: ResolvedConfig
  /** Aborted by the fiber's disposer so an in-flight acquisition stops touching the daemon. */
  private readonly detaching = new AbortController()
  private pending: Promise<Sandbox> | undefined
  private disposed = false

  constructor(ctx: Context, config: Config) {
    // Schemastery fills these fields before construction; the type does not encode that step.
    super(ctx, (config as SchemaResolvedConfig).cwd)
    const resolved = config as SchemaResolvedConfig
    this.config = {
      endpoint: resolved.endpoint.replace(/\/+$/, ''),
      token: config.token ?? process.env.DORMICE_API_TOKEN ?? '',
      userKey: config.userKey,
      image: config.image,
      // Schemastery drops every unset threshold, so an empty object is an override that says nothing.
      policy: Object.keys(resolved.policy).length === 0 ? undefined : resolved.policy,
      acquireTimeoutMs: resolved.acquireTimeoutMs,
      restorePollIntervalMs: resolved.restorePollIntervalMs,
    }
    this.validate()

    ctx.effect(() => () => {
      // Deliberately no kill: the sandbox outlives the harness process and the
      // daemon's lifecycle policy freezes it with the user's files in place.
      // The abort is what quiesces the provider: a restore poll can otherwise
      // keep requesting for the rest of acquireTimeoutMs after the fiber dies.
      this.disposed = true
      this.detaching.abort()
    }, 'dormice sandbox detach')
  }

  /**
   * Return the shared live SDK handle, acquiring the sandbox on first use.
   * @returns the connected sandbox after the configured cwd and runtime root exist.
   * @throws when the daemon rejects the acquire, the restore exceeds `acquireTimeoutMs`, or the service is disposing.
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.disposed) throw new Error(DISPOSING)
    this.pending ??= this.acquire().catch((error: unknown) => {
      this.pending = undefined
      throw error
    })
    const sandbox = await this.pending
    // Disposal can race the awaited acquisition despite the synchronous precheck.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Awaiting acquisition yields to disposal.
    if (this.disposed) throw new Error(DISPOSING)
    return sandbox
  }

  private validate(): void {
    if (this.config.token.length === 0) {
      throw new Error('dsh-dormice: configure token or set DORMICE_API_TOKEN')
    }
    if (this.config.userKey.length === 0) {
      throw new Error('dsh-dormice: userKey must be a non-empty sandbox address')
    }
    if (!URL.canParse(this.config.endpoint)) {
      throw new Error(`dsh-dormice: endpoint must be an absolute URL: ${this.config.endpoint}`)
    }
    if (!Number.isFinite(this.config.acquireTimeoutMs) || this.config.acquireTimeoutMs <= 0) {
      throw new Error('dsh-dormice: acquireTimeoutMs must be a positive finite number')
    }
    if (!Number.isFinite(this.config.restorePollIntervalMs) || this.config.restorePollIntervalMs <= 0) {
      throw new Error('dsh-dormice: restorePollIntervalMs must be a positive finite number')
    }
    const { stopAfterSeconds, archiveAfterSeconds } = this.config.policy ?? {}
    if (typeof archiveAfterSeconds === 'number' && stopAfterSeconds === null) {
      throw new Error('dsh-dormice: policy.archiveAfterSeconds requires a policy.stopAfterSeconds — only a stopped sandbox can archive')
    }
  }

  /**
   * Run one whole acquisition, reporting an acquisition the disposer cut short
   * as disposal rather than as the platform's abort error.
   */
  private async acquire(): Promise<Sandbox> {
    try {
      const record = await this.acquireRecord(Date.now() + this.config.acquireTimeoutMs)
      const sandbox = await Sandbox.connect(record.id, {
        apiKey: `${E2B_KEY_PREFIX}${this.config.token}`,
        apiUrl: `${this.config.endpoint}/e2b/api`,
        sandboxUrl: `${this.config.endpoint}/e2b/envd`,
      })
      await this.prepare(sandbox)
      return sandbox
    } catch (error: unknown) {
      if (this.detaching.signal.aborted) throw new Error(DISPOSING)
      throw error
    }
  }

  /**
   * Acquire by name until the daemon reports `ready`. `restoring` means an
   * archived sandbox is being pulled back from object storage, which the
   * native API answers immediately and expects the caller to poll. Disposal
   * aborts the wait, so the loop cannot outlive the fiber.
   */
  private async acquireRecord(deadline: number): Promise<DormiceSandboxRecord> {
    for (;;) {
      const answer = await this.postAcquire(deadline)
      if (answer.status === 'ready') return answer.sandbox
      if (deadline - Date.now() <= this.config.restorePollIntervalMs) {
        throw new Error(
          `dsh-dormice: sandbox "${this.config.userKey}" was still restoring after ${this.config.acquireTimeoutMs}ms`,
        )
      }
      await delay(this.config.restorePollIntervalMs, undefined, { signal: this.detaching.signal })
    }
  }

  /**
   * One acquire round trip, bounded by whatever is left of the acquisition
   * deadline, and by disposal. An unanswered request aborts as the platform's
   * `TimeoutError`; the restore loop above owns the descriptive deadline failure.
   */
  private async postAcquire(deadline: number): Promise<DormiceAcquireResponse> {
    const response = await fetch(`${this.config.endpoint}/acquireSandbox`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: this.config.userKey,
        ...(this.config.policy === undefined ? {} : { policy: this.config.policy }),
        ...(this.config.image === undefined ? {} : { template: this.config.image }),
      }),
      signal: AbortSignal.any([
        this.detaching.signal,
        AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      ]),
    })
    if (!response.ok) {
      throw new Error(
        `dsh-dormice: acquiring sandbox "${this.config.userKey}" failed with ${response.status}: ${await failureMessage(response)}`,
      )
    }
    return parseAcquireResponse(await response.json(), this.config.userKey)
  }

  private async prepare(sandbox: Sandbox): Promise<void> {
    await sandbox.files.makeDir(this.cwd)
    await sandbox.files.makeDir(this.runtimeRoot)
    const runtimeRoot = await sandbox.files.getInfo(this.runtimeRoot)
    if (runtimeRoot.type !== FileType.DIR || runtimeRoot.symlinkTarget !== undefined) {
      throw new Error(`dsh-dormice: runtime root must be a real directory: ${this.runtimeRoot}`)
    }
    await sandbox.commands.run(
      `chmod 700 -- ${quoteE2BShellArg(this.runtimeRoot)}`,
      { envs: e2bControlEnvs() },
    )
  }
}

/**
 * Read the daemon's `{ message }` error dialect, falling back to the status
 * line. The token never appears in either, so the text is safe to surface.
 */
async function failureMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown }
    return typeof body.message === 'string' ? body.message : response.statusText
  } catch (_nonJsonErrorBody) {
    // The daemon answers JSON for every route it owns; a proxy or a wrong
    // endpoint can still return HTML, and only the status line survives that.
    return response.statusText
  }
}

/**
 * Validate the acquire answer at the wire boundary.
 * @param body - Parsed JSON returned by `POST /acquireSandbox`.
 * @param userKey - Sandbox address named in the failure message.
 * @returns the acquire answer with the fields this provider reads.
 * @throws when the daemon answers a record this provider cannot use.
 */
function parseAcquireResponse(body: unknown, userKey: string): DormiceAcquireResponse {
  const answer = body as Partial<DormiceAcquireResponse> | null
  const id: unknown = answer?.sandbox?.id
  if (
    answer === null
    || (answer.status !== 'ready' && answer.status !== 'restoring')
    || typeof id !== 'string'
    || id.length === 0
  ) {
    throw new Error(`dsh-dormice: acquiring sandbox "${userKey}" returned an unusable record`)
  }
  return answer as DormiceAcquireResponse
}

export default DormiceRuntime
