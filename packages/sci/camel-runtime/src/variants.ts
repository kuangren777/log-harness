/**
 * The variant engine: persistent slots, each an AgentENV microVM holding a
 * copy of one project directory of the Dormice workspace. Slots are created
 * and deleted explicitly, bounded by `maxVariants` per workspace, pause
 * themselves when idle, and resume on the next use. Results flow back into
 * the workspace only through `collect`; the workspace stays the one durable
 * copy.
 * @module @deepseek-ai/dsh-camel-runtime/variants
 */

import { posix } from 'node:path'
import { CommandExitError, e2bControlEnvs } from '@deepseek-ai/dsh-e2b'
import type { CommandResult, Sandbox } from '@deepseek-ai/dsh-e2b'
import type { AgentEnvApi } from './agentenv.ts'
import { VARIANT_NAME, VariantRegistry } from './registry.ts'
import { exportWorkspace, importWorkspace, insideWorkspace } from './transfer.ts'
import type { AgentEnvSandbox, VariantCollectResult, VariantListing, VariantRecord, VariantRunResult } from './types.ts'

/** Exit code a run reports when its command hit the wall-clock budget, as `timeout(1)` would. */
export const TIMEOUT_EXIT_CODE = 124

/** Characters of stdout and stderr kept in the tool result. */
export const TAIL_CHARS = 4000

/** Sub-directory of a variant's results directory holding its collected files. */
export const COLLECT_DIR = 'collect'

/** Everything the engine needs from its owner. */
export interface VariantEngineDeps {
  readonly api: AgentEnvApi
  /** The Dormice workspace sandbox, awaited per operation so a re-acquired sandbox is picked up. */
  readonly workspace: () => Promise<Sandbox>
  /** Absolute workspace root; project paths are resolved inside it and copied to the same absolute path in the variant. */
  readonly cwd: string
  /** Absolute directory holding the registry and per-variant collected results. */
  readonly variantsDir: string
  /** AgentENV template a fresh variant starts from. */
  readonly template: string
  /** Slots one workspace may hold. */
  readonly maxVariants: number
  readonly excludes: readonly string[]
  readonly maxProjectBytes: number
  /** Idle seconds before a variant pauses itself; every use extends it. */
  readonly sandboxTimeoutSeconds: number
  /** Clock; tests pin it. */
  readonly now?: () => Date
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

/** Keep the last {@link TAIL_CHARS} characters. */
function tail(text: string): string {
  return text.length <= TAIL_CHARS ? text : text.slice(-TAIL_CHARS)
}

/**
 * The model-facing refusal when every slot is taken.
 * @param max - the slot cap.
 * @param names - current slot names.
 * @returns the message.
 */
export function limitMessage(max: number, names: readonly string[]): string {
  return `variant limit reached: ${names.length}/${max} slots are in use (${names.join(', ')}); delete one with delete_variant before creating another`
}

/** The variant engine; one instance per plugin mount. */
export class VariantEngine {
  /** The slot table behind this workspace; tools read it for the slot count they report. */
  readonly registry: VariantRegistry

  constructor(private readonly deps: VariantEngineDeps) {
    this.registry = new VariantRegistry(deps.workspace, deps.variantsDir)
  }

  /**
   * Create one slot: a fresh microVM seeded with a copy of `project`, or —
   * with `from` — a fork of an existing variant's whole state.
   * @param name - slot name.
   * @param project - workspace-relative project directory.
   * @param from - existing variant to fork instead of seeding from the template.
   * @returns the new record.
   * @throws when the name is taken or malformed, the cap is reached, the project is missing, or `from` names no variant.
   */
  create(name: string, project: string, from?: string): Promise<VariantRecord> {
    if (!VARIANT_NAME.test(name)) throw new Error(`invalid variant name ${JSON.stringify(name)}: use lowercase letters, digits, and dashes`)
    const projectDir = insideWorkspace(this.deps.cwd, project)
    if (projectDir === this.deps.cwd) throw new Error('project must name a directory inside the workspace, not the workspace itself')
    return this.registry.update(async (variants) => {
      if (variants.some(variant => variant.name === name)) throw new Error(`variant ${JSON.stringify(name)} already exists; delete it first or choose another name`)
      if (variants.length >= this.deps.maxVariants) {
        throw new Error(limitMessage(this.deps.maxVariants, variants.map(variant => variant.name)))
      }
      const source = from === undefined ? undefined : variants.find(variant => variant.name === from)
      if (from !== undefined && source === undefined) throw new Error(`variant ${JSON.stringify(from)} does not exist; list_variants shows the current slots`)
      const workspace = await this.deps.workspace()
      const exists = await runShell(workspace, `test -d ${JSON.stringify(projectDir)}`, {})
      if (exists.exitCode !== 0) throw new Error(`project directory ${projectDir} does not exist in the workspace`)
      const stamp = (this.deps.now ?? (() => new Date()))().toISOString()
      const projectRel = posix.relative(this.deps.cwd, projectDir)
      const record = source === undefined
        ? await this.seed(name, projectRel, projectDir, stamp)
        : await this.fork(name, source, stamp)
      return { variants: [...variants, record], result: record }
    })
  }

  /** A fresh microVM from the template with the project directory copied in at the same absolute path. */
  private async seed(name: string, project: string, projectDir: string, stamp: string): Promise<VariantRecord> {
    const workspace = await this.deps.workspace()
    const archive = await exportWorkspace(workspace, projectDir, { excludes: this.deps.excludes, maxBytes: this.deps.maxProjectBytes })
    const sandbox = await this.deps.api.createSandbox(this.deps.template, this.deps.sandboxTimeoutSeconds)
    try {
      await importWorkspace(await this.deps.api.open(sandbox), archive, projectDir)
    } catch (error: unknown) {
      await this.deps.api.kill(sandbox.sandboxID).catch(() => {})
      throw error
    }
    return { name, project, sandboxID: sandbox.sandboxID, templateID: sandbox.templateID, createdAt: stamp, lastUsedAt: stamp }
  }

  /** A microVM resumed from a snapshot of another variant: files, processes, and memory included. */
  private async fork(name: string, source: VariantRecord, stamp: string): Promise<VariantRecord> {
    const live = await this.deps.api.connect(source.sandboxID, this.deps.sandboxTimeoutSeconds)
    if (live === undefined) throw new Error(`variant ${JSON.stringify(source.name)} has no sandbox any more; delete it and create it again before forking from it`)
    const snapshot = await this.deps.api.snapshot(source.sandboxID)
    let sandbox: AgentEnvSandbox
    try {
      sandbox = await this.deps.api.createSandbox(snapshot.snapshotID, this.deps.sandboxTimeoutSeconds)
    } catch (error: unknown) {
      await this.deps.api.deleteTemplate(snapshot.snapshotID).catch(() => {})
      throw error
    }
    return {
      name,
      project: source.project,
      sandboxID: sandbox.sandboxID,
      templateID: sandbox.templateID,
      snapshotID: snapshot.snapshotID,
      from: source.name,
      createdAt: stamp,
      lastUsedAt: stamp,
    }
  }

  /**
   * Run one command in a variant's project directory, resuming the microVM first.
   * @param name - slot name.
   * @param command - shell command.
   * @param timeoutSeconds - wall-clock budget.
   * @returns exit code and output tails.
   * @throws when the slot or its sandbox is gone, or the transport fails.
   */
  async run(name: string, command: string, timeoutSeconds: number): Promise<VariantRunResult> {
    const record = await this.require(name)
    const sdk = await this.resume(record)
    const started = Date.now()
    let result: CommandResult
    try {
      result = await runShell(sdk, command, { cwd: posix.join(this.deps.cwd, record.project), timeoutMs: timeoutSeconds * 1000 })
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error
      result = { exitCode: TIMEOUT_EXIT_CODE, stdout: '', stderr: `command exceeded ${timeoutSeconds}s: ${error.message}` }
    }
    const durationMs = Date.now() - started
    await this.touch(name)
    return { name, exitCode: result.exitCode, stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr), durationMs }
  }

  /**
   * Copy one directory of a variant's project back into the workspace.
   * @param name - slot name.
   * @param path - project-relative directory; `.` for the whole project.
   * @returns where the files landed and how many.
   * @throws when the slot or its sandbox is gone, or the directory does not exist in the variant.
   */
  async collect(name: string, path: string): Promise<VariantCollectResult> {
    const record = await this.require(name)
    const projectDir = posix.join(this.deps.cwd, record.project)
    const source = insideWorkspace(projectDir, path)
    const relative = posix.relative(projectDir, source)
    const shown = relative === '' ? '.' : relative
    const sdk = await this.resume(record)
    const exists = await runShell(sdk, `test -d ${JSON.stringify(source)}`, {})
    if (exists.exitCode !== 0) throw new Error(`variant ${JSON.stringify(name)} has no directory ${shown} under its project`)
    const archive = await exportWorkspace(sdk, source, { excludes: this.deps.excludes, maxBytes: this.deps.maxProjectBytes })
    const destination = posix.join(this.deps.variantsDir, name, COLLECT_DIR, relative)
    const workspace = await this.deps.workspace()
    await importWorkspace(workspace, archive, destination)
    const count = await runShell(workspace, `find ${JSON.stringify(destination)} -type f | wc -l`, {})
    await this.touch(name)
    return { name, path: shown, destination, files: Number.parseInt(count.stdout.trim(), 10) || 0 }
  }

  /**
   * Delete one slot: kill its sandbox, drop its snapshot, remove it from the
   * registry. Collected files stay in the workspace.
   * @param name - slot name.
   * @returns the removed record.
   * @throws when no such slot exists.
   */
  delete(name: string): Promise<VariantRecord> {
    return this.registry.update(async (variants) => {
      const record = variants.find(variant => variant.name === name)
      if (record === undefined) throw new Error(`variant ${JSON.stringify(name)} does not exist; list_variants shows the current slots`)
      await this.deps.api.kill(record.sandboxID)
      if (record.snapshotID !== undefined) await this.deps.api.deleteTemplate(record.snapshotID)
      return { variants: variants.filter(variant => variant.name !== name), result: record }
    })
  }

  /**
   * Every slot with its sandbox's current state.
   * @returns rows in slot order.
   */
  async list(): Promise<VariantListing[]> {
    const variants = await this.registry.load()
    return Promise.all(variants.map(async (record) => {
      const detail = await this.deps.api.getSandbox(record.sandboxID)
      return { ...record, state: detail === undefined ? 'missing' as const : detail.state }
    }))
  }

  private async require(name: string): Promise<VariantRecord> {
    const record = (await this.registry.load()).find(variant => variant.name === name)
    if (record === undefined) throw new Error(`variant ${JSON.stringify(name)} does not exist; list_variants shows the current slots`)
    return record
  }

  private async resume(record: VariantRecord): Promise<Sandbox> {
    const live = await this.deps.api.connect(record.sandboxID, this.deps.sandboxTimeoutSeconds)
    if (live === undefined) {
      throw new Error(`variant ${JSON.stringify(record.name)} has no sandbox any more (AgentENV restarted or expired it); delete_variant it and create it again`)
    }
    return this.deps.api.open(live)
  }

  private touch(name: string): Promise<void> {
    const stamp = (this.deps.now ?? (() => new Date()))().toISOString()
    return this.registry.update(variants => Promise.resolve({
      variants: variants.map(variant => variant.name === name ? { ...variant, lastUsedAt: stamp } : variant),
      result: undefined,
    }))
  }
}
