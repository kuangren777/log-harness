/**
 * Filesystem and shell gate for the science-research agent profile.
 *
 * `apply` registers one `tools/pre-execute` listener and, where a subprocess
 * seam is composed, runs the sandbox home skeleton bootstrap once. The listener
 * is the gate itself: it classifies the path a filesystem
 * tool is about to act on, applies the workspace contract's path table, refuses
 * a read whose first bytes are not text, reconstructs what a manifest write or
 * edit would leave on disk and refuses one that changes a field the agent does
 * not own, and screens a shell command for a recursive delete reaching into a
 * bundle. Every refusal appends `sci/fs-denied` and reaches the model as the
 * tool's denial reason.
 *
 * The gate deliberately does not occupy `fs/write-intent` or `fs/edit-intent`:
 * those single slots belong to `@deepseek-ai/dsh-fs-observation-policy`, whose
 * read-before-edit guard is the other half of co-editing safety. Deciding at
 * the tool boundary also lets one listener cover the shell, which the `fs`
 * seam never sees.
 *
 * This is the outer of two layers. The inner one is the sandbox image, where
 * `sciplots/<slug>/` and `papers/<slug>/` belong to the render user and the
 * agent's own uid cannot unlink them. A shell command that defeats the static
 * screen still meets that.
 *
 * The package owns `projectRoot`, so it also owns making it exist: the image
 * cannot bake a tree under a mounted home volume, and the bootstrap in
 * `./bootstrap.ts` runs the image's idempotent skeleton command once instead.
 * It is fail-open by construction — the report is logged and the load continues.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-workspace
 */

import { isManifestPath } from '@deepseek-ai/dsh-sci-manifest'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: merges the optional `subprocess` service the bootstrap runs through.
import type {} from '@deepseek-ai/dsh-subprocess'
import { indexFsTools, readStringArg, reconstructAfter, resolveFsOp } from './bindings.ts'
import { BINARY_MAGIC_BYTES, denyBinaryRead, detectBinarySignature } from './binary.ts'
import { parseBootstrapArgv, runSkeletonBootstrap } from './bootstrap.ts'
import { Config } from './config.ts'
import { decideFsOp, denyDelegationScope, denyExistingCreateOnly } from './decide.ts'
import { checkManifestChange } from './manifest-gate.ts'
import { classifyPath, isAbsolutePath, isOutsideDelegationScope } from './paths.ts'
import { delegationScopeOperand, screenShellCommand } from './shell.ts'
import type { FsToolBinding, FsOp, SciFsDeniedData } from './types.ts'

export { indexFsTools, readBooleanArg, readStringArg, reconstructAfter, resolveFsOp } from './bindings.ts'
export type { FsToolEntry } from './bindings.ts'
export { BINARY_MAGIC_BYTES, denyBinaryRead, detectBinarySignature } from './binary.ts'
export type { BinarySignature } from './binary.ts'
export { BOOTSTRAP_CWD, lastLine, parseBootstrapArgv, runSkeletonBootstrap } from './bootstrap.ts'
export type { SkeletonBootstrapReport, SkeletonBootstrapRequest } from './bootstrap.ts'
export { DEFAULT_FS_TOOLS } from './config.ts'
export {
  FS_DENIAL_RULES,
  RULE_BINARY_READ,
  RULE_BUNDLE_RECURSIVE_DELETE,
  RULE_DELEGATION_SCOPE,
  RULE_MANIFEST_INVALID,
  RULE_MANIFEST_OWNED_FIELD,
  RULE_MANIFEST_UNVERIFIABLE,
  RULE_REFERENCES_OUTSIDE_PAPERS,
  RULE_RENDER_OWNED_VERSIONS,
  RULE_SCI_PRIVATE,
  RULE_SKILLS_READ_ONLY,
  RULE_SPOOL_CREATE_ONLY,
  RULE_VERSIONS_APPEND_ONLY,
  decideFsOp,
  denyDelegationScope,
  denyExistingCreateOnly,
} from './decide.ts'
export { applyReplacement, checkManifestChange, parseManifestJson } from './manifest-gate.ts'
export type { ManifestChange, ManifestDenial } from './manifest-gate.ts'
export {
  PATH_CLASSES,
  classifyPath,
  isOutsideDelegationScope,
  isAbsolutePath,
  sandboxHomeSegments,
  normalizePath,
  pathSegments,
  resolveAgainst,
  segmentsUnder,
} from './paths.ts'
export type { PathLayout } from './paths.ts'
export { delegationScopeOperand, recursiveDeleteOperands, screenShellCommand, tokenizeCommand } from './shell.ts'
export type { ShellScreenConfig } from './shell.ts'
export type {
  DeniedOp,
  FsDecision,
  FsOp,
  FsToolBinding,
  PathClass,
  SciFsDeniedData,
  ShellDenial,
  ShellToolBinding,
} from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'sci-workspace'

/**
 * The tool registry whose pre-dispatch waterfall carries the gate, and the
 * filesystem the gate resolves paths and reads current content through.
 */
export const inject = ['tools', 'fs']

/**
 * Await one filesystem probe, treating failure as no information.
 * @param operation - the probe in flight.
 * @returns the value, or `undefined` when the probe failed.
 */
function probe<T>(operation: Promise<T>): Promise<T | undefined> {
  return operation.then(
    value => value,
    // A probe fails when the target is absent, unreadable, or past the byte
    // cap. The tool is about to act on the same target and produces its own
    // error for exactly that condition, so the gate learns nothing here that
    // suppressing the failure could hide.
    () => undefined,
  )
}

/**
 * Register the science-research workspace gate on the mounting context, and
 * bootstrap the sandbox home skeleton once a subprocess seam is available.
 * @param ctx - the mounting context, carrying `tools` and `fs`, and optionally `subprocess`.
 * @param config - the resolved deployment configuration.
 * @throws Error when `projectRoot` is relative, or when one tool name is listed in more than one class.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolutePath(config.projectRoot)) {
    throw new Error(`sci-workspace: projectRoot must be an absolute path, got ${JSON.stringify(config.projectRoot)}`)
  }
  const tools = indexFsTools(config.fsTools)

  /**
   * The directory relative tool arguments resolve against.
   * @param exec - the pending call.
   * @returns the calling session's workspace, or the project root for a call with no session.
   */
  const workingDirectory = (exec: ToolExecution): string => exec.agent?.session.header.cwd ?? config.projectRoot

  /**
   * The project a delegated call is confined to, or `undefined` for a
   * top-level session and for a delegation with no recorded working directory.
   * @param exec - the pending call.
   * @returns the delegated session's working directory when the scope rule applies.
   */
  const delegationScope = (exec: ToolExecution): string | undefined => {
    const header = exec.agent?.session.header
    if (header === undefined || (header.delegationDepth ?? 0) === 0) return undefined
    return header.cwd
  }

  /**
   * Resolve the path argument of a filesystem call.
   * @param path - the path exactly as the call carries it.
   * @param exec - the pending call.
   * @returns the resolved target, or `undefined` when the backend cannot resolve it.
   */
  const resolveTarget = (path: string, exec: ToolExecution): Promise<FsTarget | undefined> => {
    const cwd = exec.agent?.session.header.cwd
    return probe(ctx.fs.resolve(path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal }))
  }

  /**
   * Refuse a read whose leading bytes identify a format the read tool cannot
   * decode. A target the probe cannot size or read passes: the read tool meets
   * the same condition and reports it in its own words.
   * @param target - the resolved read target.
   * @param path - the target's absolute path.
   * @param exec - the pending call.
   * @returns the refusal, or `undefined` to let the read run.
   */
  const screenRead = async (target: FsTarget, path: string, exec: ToolExecution): Promise<SciFsDeniedData | undefined> => {
    const info = await probe(ctx.fs.stat(target, exec.signal))
    if (info?.type !== 'file' || info.size === undefined) return undefined
    if (info.size < BINARY_MAGIC_BYTES || info.size > config.binaryProbeMaxBytes) return undefined
    const bytes = await probe(ctx.fs.readBytes(target, exec.signal, info.size))
    if (bytes === undefined) return undefined
    const signature = detectBinarySignature(bytes)
    if (signature === undefined) return undefined
    return { op: 'read', path, ...denyBinaryRead(path, signature) }
  }

  /**
   * Refuse a manifest write or edit that changes a field the agent does not
   * own, or a write that would leave the manifest invalid.
   * @param binding - where the calling tool keeps its content arguments.
   * @param target - the resolved target.
   * @param path - the target's absolute path.
   * @param op - the operation the call performs.
   * @param exec - the pending call.
   * @returns the refusal, or `undefined` when the target is not a manifest or the change is the agent's to make.
   */
  const screenManifest = async (
    binding: FsToolBinding,
    target: FsTarget,
    path: string,
    op: FsOp,
    exec: ToolExecution,
  ): Promise<SciFsDeniedData | undefined> => {
    const kind = isManifestPath(path)
    if (kind === undefined) return undefined
    const before = await probe(ctx.fs.readText(target, exec.signal))
    const after = reconstructAfter(binding, exec.arguments, before)
    const denial = checkManifestChange({ kind, path, op, before, after })
    if (denial === undefined) return undefined
    return { op, path, ...denial }
  }

  /**
   * Apply the path table, then the content rules, to one filesystem call.
   * @param binding - where the calling tool keeps its arguments.
   * @param op - the operation the call performs.
   * @param exec - the pending call.
   * @returns the refusal, or `undefined` to let the call run.
   */
  const screenFsCall = async (binding: FsToolBinding, op: FsOp, exec: ToolExecution): Promise<SciFsDeniedData | undefined> => {
    const requested = readStringArg(exec.arguments, binding.path)
    if (requested === undefined) return undefined
    const target = await resolveTarget(requested, exec)
    if (target === undefined) return undefined
    const path = ctx.fs.processPath(target)
    const scope = delegationScope(exec)
    if (scope !== undefined && isOutsideDelegationScope(path, scope, config)) return { op, path, ...denyDelegationScope(path) }
    const cls = classifyPath(path, config)
    const decision = decideFsOp(op, cls)
    if (decision.kind === 'deny') return { op, path, rule: decision.rule, reason: decision.reason }
    if (decision.kind === 'allow-if-absent') {
      const info = await probe(ctx.fs.stat(target, exec.signal))
      if (info !== undefined) return { op, path, ...denyExistingCreateOnly(path, cls) }
    }
    if (op === 'read') return screenRead(target, path, exec)
    return screenManifest(binding, target, path, op, exec)
  }

  /**
   * Screen one shell command for a recursive delete reaching into a bundle.
   * @param commandArg - the argument holding the command line.
   * @param exec - the pending call.
   * @returns the refusal, or `undefined` to let the command run.
   */
  const screenShellCall = (commandArg: string, exec: ToolExecution): SciFsDeniedData | undefined => {
    const command = readStringArg(exec.arguments, commandArg)
    if (command === undefined) return undefined
    const scope = delegationScope(exec)
    const outside = scope === undefined ? undefined : delegationScopeOperand(command, scope, config)
    if (outside !== undefined) return { op: 'shell', path: outside, ...denyDelegationScope(outside) }
    const denial = screenShellCommand(command, {
      cwd: workingDirectory(exec),
      projectRoot: config.projectRoot,
      bundleDirs: config.bundleDirs,
      denyRecursiveDeleteInBundles: config.denyRecursiveDeleteInBundles,
    })
    if (denial === undefined) return undefined
    return { op: 'shell', ...denial }
  }

  /**
   * Decide one pending call against every rule this gate owns.
   * @param exec - the pending call.
   * @returns the refusal, or `undefined` when no rule of this gate applies.
   */
  const screenCall = async (exec: ToolExecution): Promise<SciFsDeniedData | undefined> => {
    const shellBinding = tools.shell.get(exec.name)
    if (shellBinding !== undefined) return screenShellCall(shellBinding.command, exec)
    const entry = tools.fs.get(exec.name)
    if (entry === undefined) return undefined
    return screenFsCall(entry.binding, resolveFsOp(entry, exec.arguments), exec)
  }

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const denial = await screenCall(exec)
    if (denial === undefined) return next()
    exec.agent?.session.append('sci/fs-denied', denial, { ignorable: true })
    return { kind: 'deny', reason: denial.reason }
  })

  const bootstrapArgv = parseBootstrapArgv(config.bootstrapCommand)
  if (bootstrapArgv === undefined) return
  // The seam is read through ctx.inject rather than the plugin's own `inject`:
  // the gate is complete without it, and a Host-only composition that mounts no
  // subprocess provider must still get the path table. The command runs at most
  // once per mounted plugin, so a provider that unloads and returns — the
  // sandbox backend being replaced — does not repeat a bootstrap this fiber has
  // already done.
  let bootstrapped = false
  ctx.inject(['subprocess'], (world: Context) => {
    if (bootstrapped) return
    bootstrapped = true
    // The load does not await this: the skeleton is missing either way until
    // the command finishes, and a slow or broken sandbox must not hold up the
    // profile's boot. The report is the only thing that ever comes back.
    void runSkeletonBootstrap(world.subprocess, {
      argv: bootstrapArgv,
      timeoutMs: config.bootstrapTimeoutMs,
    }).then((report) => {
      if (report.kind === 'ok') {
        ctx.logger.info(`sci-workspace: sandbox home skeleton ready: ${report.summary}`)
        return
      }
      ctx.logger.warn(`sci-workspace: the sandbox home skeleton was not laid down, so a call under ${config.projectRoot} may fail as not found: ${report.detail}`)
    })
  })
}
