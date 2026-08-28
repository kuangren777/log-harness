/**
 * E2B Cloud Service Provider for the sandbox seam. Creates one short-lived
 * sandbox on the hosted E2B API and deletes it at timeout or disposal.
 * @module @deepseek-ai/dsh-e2b-cloud
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  E2BRuntime,
  FileType,
  Sandbox,
  SandboxNotFoundError,
  e2bControlEnvs,
  quoteE2BShellArg,
} from '@deepseek-ai/dsh-e2b'

/** Configuration for the E2B Cloud sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}

interface ResolvedConfig {
  apiKey: string
  timeoutMs: number
}

interface SchemaResolvedConfig extends Config {
  cwd: string
  timeoutMs: number
}

/**
 * Creates one lazily consumable E2B Cloud SDK handle and deletes the sandbox
 * at timeout or disposal. Creation begins at plugin construction; adapters
 * await {@link getSandbox} before their first operation.
 */
export class E2BCloudRuntime extends E2BRuntime {
  static Config: z<Config> = z.object({
    apiKey: z.string(),
    cwd: z.string().default('/home/user/workspace'),
    timeoutMs: z.number().default(300_000),
  })

  private readonly config: ResolvedConfig
  private readonly ready: Promise<Sandbox>
  private disposed = false

  constructor(ctx: Context, config: Config) {
    // Schemastery fills these fields before construction; the type does not encode that step.
    super(ctx, (config as SchemaResolvedConfig).cwd)
    const resolved = config as SchemaResolvedConfig
    const apiKey = config.apiKey ?? process.env.E2B_API_KEY
    this.config = {
      apiKey: apiKey ?? '',
      timeoutMs: resolved.timeoutMs,
    }
    this.validate()
    this.ready = this.open()
    // A deployment may load the owner before any adapter uses it. Keep a
    // failed eager connection observed; getSandbox() still returns the error.
    void this.ready.catch(() => {})

    ctx.effect(() => async () => {
      this.disposed = true
      let sandbox: Sandbox
      try {
        sandbox = await this.ready
      } catch (_sandboxSetupFailure) {
        // open() either acquired no sandbox or already made the POC's one rollback attempt.
        return
      }
      try {
        await sandbox.kill()
      } catch (error: unknown) {
        if (!(error instanceof SandboxNotFoundError)) throw error
      }
    }, 'e2b cloud sandbox teardown')
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created sandbox after the configured cwd exists.
   * @throws when E2B rejects creation or the service is disposing.
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    const sandbox = await this.ready
    // Disposal can race the awaited sandbox readiness despite the synchronous precheck.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Awaiting readiness yields to disposal.
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    return sandbox
  }

  private validate(): void {
    if (this.config.apiKey.length === 0) {
      throw new Error('dsh-e2b-cloud: configure apiKey or set E2B_API_KEY')
    }
    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs <= 0) {
      throw new Error('dsh-e2b-cloud: timeoutMs must be a positive finite number')
    }
  }

  private async open(): Promise<Sandbox> {
    const sandbox = await Sandbox.create({
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    try {
      await sandbox.files.makeDir(this.cwd)
      await sandbox.files.makeDir(this.runtimeRoot)
      const runtimeRoot = await sandbox.files.getInfo(this.runtimeRoot)
      if (runtimeRoot.type !== FileType.DIR || runtimeRoot.symlinkTarget !== undefined) {
        throw new Error(`dsh-e2b-cloud: runtime root must be a real directory: ${this.runtimeRoot}`)
      }
      await sandbox.commands.run(
        `chmod 700 -- ${quoteE2BShellArg(this.runtimeRoot)}`,
        { envs: e2bControlEnvs() },
      )
      return sandbox
    } catch (error: unknown) {
      try {
        await sandbox.kill()
      } catch (_sandboxSetupRollbackFailure) {
        // TODO(e2b-setup-rollback): Add retry state only if a real double failure
        // outlives E2B's configured sandbox timeout.
      }
      throw error
    }
  }
}

export default E2BCloudRuntime
