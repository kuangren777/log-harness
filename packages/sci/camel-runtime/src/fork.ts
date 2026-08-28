/**
 * The fork engine: export the Dormice workspace once, seed one AgentENV
 * microVM with it, snapshot, and resume one microVM per variant from that
 * snapshot. Results flow back into the workspace, which remains the only
 * durable copy; every microVM and the snapshot are deleted in `finally`, so a
 * failure anywhere leaves nothing running on the engine.
 * @module @deepseek-ai/dsh-camel-runtime/fork
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { CommandExitError, e2bControlEnvs } from '@deepseek-ai/dsh-e2b'
import type { CommandResult, Sandbox } from '@deepseek-ai/dsh-e2b'
import type { AgentEnvApi } from './agentenv.ts'
import { exportWorkspace, importWorkspace, insideWorkspace } from './transfer.ts'
import type { ForkOutcome, ForkRequest, ForkVariant, ForkVariantResult } from './types.ts'

/** Exit code a variant reports when its command hit the wall-clock budget, as `timeout(1)` would. */
export const TIMEOUT_EXIT_CODE = 124

/** Characters of stdout and stderr kept in the tool result. */
export const TAIL_CHARS = 4000

/** Sub-directory of a variant's result directory holding its collected files. */
export const COLLECT_DIR = 'collect'

/** Everything the engine needs from its owner. */
export interface ForkEngineDeps {
  readonly api: AgentEnvApi
  /** The Dormice workspace sandbox, awaited per fork so a re-acquired sandbox is picked up. */
  readonly workspace: () => Promise<Sandbox>
  /** Absolute workspace root, identical on both sides so the variant command sees the paths the model knows. */
  readonly cwd: string
  /** Workspace-relative directory receiving `<forkId>/<variant>/`. */
  readonly forksDir: string
  /** AgentENV template the seed microVM starts from. */
  readonly template: string
  readonly excludes: readonly string[]
  readonly maxWorkspaceBytes: number
  readonly sandboxTimeoutSeconds: number
  /** Upper bound on variants running at once. */
  readonly concurrency: number
  /** Fork identity source; tests pin it. */
  readonly forkId?: () => string
  /** Clock; tests pin it. */
  readonly now?: () => number
}

/**
 * Run a shell command and report a non-zero exit as a result rather than as
 * the SDK's thrown `CommandExitError`.
 * @param sandbox - the sandbox to run in.
 * @param command - shell command.
 * @param options - working directory and wall-clock budget.
 * @returns the command's exit code and output.
 * @throws the SDK's timeout and transport errors unchanged.
 */
export async function runShell(
  sandbox: Sandbox,
  command: string,
  options: { cwd?: string; timeoutMs?: number },
): Promise<CommandResult> {
  try {
    return await sandbox.commands.run(command, { ...options, envs: e2bControlEnvs() })
  } catch (error: unknown) {
    if (error instanceof CommandExitError) {
      const { exitCode, stdout, stderr } = error
      return { exitCode, stdout, stderr, ...error.error === undefined ? {} : { error: error.error } }
    }
    throw error
  }
}

/**
 * Map with at most `limit` callbacks in flight, preserving input order.
 * @param items - inputs.
 * @param limit - concurrency cap, at least 1.
 * @param task - the mapped async function.
 * @returns results in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  // One iterator shared by every worker hands each item out exactly once.
  const queue = items.entries()
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) results[index] = await task(item, index)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Keep the last {@link TAIL_CHARS} characters. */
function tail(text: string): string {
  return text.length <= TAIL_CHARS ? text : text.slice(-TAIL_CHARS)
}

/** One fork's mutable bookkeeping: what to delete when it ends. */
interface Ledger {
  readonly sandboxes: string[]
  snapshotID: string | undefined
}

/** The fork engine; one instance per plugin mount. */
export class ForkEngine {
  constructor(private readonly deps: ForkEngineDeps) {}

  /**
   * Run one fork end to end.
   * @param request - validated variants and options.
   * @returns per-variant results, after they are written into the workspace.
   * @throws when export, seeding, snapshotting, or a transport step fails; everything created so far is deleted first.
   */
  async run(request: ForkRequest): Promise<ForkOutcome> {
    const now = this.deps.now ?? Date.now
    const started = now()
    const forkId = (this.deps.forkId ?? shortId)()
    const collectDir = request.collect === undefined ? undefined : insideWorkspace(this.deps.cwd, request.collect)
    const workspace = await this.deps.workspace()
    const archive = await exportWorkspace(workspace, this.deps.cwd, {
      excludes: this.deps.excludes,
      maxBytes: this.deps.maxWorkspaceBytes,
    })
    const ledger: Ledger = { sandboxes: [], snapshotID: undefined }
    try {
      const seed = await this.deps.api.createSandbox(this.deps.template, this.deps.sandboxTimeoutSeconds)
      ledger.sandboxes.push(seed.sandboxID)
      await importWorkspace(await this.deps.api.connect(seed), archive, this.deps.cwd)
      const snapshot = await this.deps.api.snapshot(seed.sandboxID)
      ledger.snapshotID = snapshot.snapshotID
      const variants = await mapWithConcurrency(
        request.variants,
        this.deps.concurrency,
        variant => this.variant(ledger, snapshot.snapshotID, forkId, variant, request.timeoutSeconds, collectDir, workspace),
      )
      return { forkId, snapshotID: snapshot.snapshotID, variants, durationMs: now() - started }
    } finally {
      await this.cleanup(ledger)
    }
  }

  private async variant(
    ledger: Ledger,
    snapshotID: string,
    forkId: string,
    variant: ForkVariant,
    timeoutSeconds: number,
    collectDir: string | undefined,
    workspace: Sandbox,
  ): Promise<ForkVariantResult> {
    const sandbox = await this.deps.api.createSandbox(snapshotID, this.deps.sandboxTimeoutSeconds)
    ledger.sandboxes.push(sandbox.sandboxID)
    const sdk = await this.deps.api.connect(sandbox)
    let result: CommandResult
    try {
      result = await runShell(sdk, variant.command, { cwd: this.deps.cwd, timeoutMs: timeoutSeconds * 1000 })
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error
      result = { exitCode: TIMEOUT_EXIT_CODE, stdout: '', stderr: `command exceeded ${timeoutSeconds}s: ${error.message}` }
    }
    const resultDir = posix.join(this.deps.cwd, this.deps.forksDir, forkId, variant.name)
    await workspace.files.write([
      { path: posix.join(resultDir, 'stdout.txt'), data: result.stdout },
      { path: posix.join(resultDir, 'stderr.txt'), data: result.stderr },
      { path: posix.join(resultDir, 'exit-code'), data: `${result.exitCode}\n` },
    ])
    if (collectDir !== undefined) {
      const collected = await runShell(sdk, `test -d ${JSON.stringify(collectDir)}`, {})
      if (collected.exitCode === 0) {
        const bytes = await exportWorkspace(sdk, collectDir, { excludes: [], maxBytes: this.deps.maxWorkspaceBytes })
        await importWorkspace(workspace, bytes, posix.join(resultDir, COLLECT_DIR))
      }
    }
    return {
      name: variant.name,
      exitCode: result.exitCode,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
      resultDir,
    }
  }

  /** Delete every microVM and the snapshot; a failed deletion never masks the fork's own error. */
  private async cleanup(ledger: Ledger): Promise<void> {
    await Promise.allSettled(ledger.sandboxes.map(id => this.deps.api.kill(id)))
    if (ledger.snapshotID !== undefined) {
      await Promise.allSettled([this.deps.api.deleteTemplate(ledger.snapshotID)])
    }
  }
}

/** A fork identity: sortable timestamp plus enough randomness to never collide within one workspace. */
function shortId(): string {
  return `${new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`
}
