/**
 * Moving a workspace between two E2B-surfaced sandboxes that share no
 * filesystem: a gzip tar streamed through the command channel as base64. The
 * pure command builders are exported so the exact shell the model's files pass
 * through is pinned by tests.
 * @module @deepseek-ai/dsh-camel-runtime/transfer
 */

import { posix } from 'node:path'
import { e2bControlEnvs, quoteE2BShellArg } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'

/** Remote path the import writes the archive to before extracting it. */
export const IMPORT_ARCHIVE = '/tmp/camel-runtime-import.tgz'

/**
 * The command that archives one directory to base64 on stdout.
 * @param cwd - absolute directory to archive; its contents become the archive root.
 * @param excludes - tar exclude patterns, matched against archive-relative paths.
 * @returns a shell command whose stdout is a base64 gzip tar.
 */
export function tarExportCommand(cwd: string, excludes: readonly string[]): string {
  const flags = excludes.map(pattern => `--exclude=${quoteE2BShellArg(pattern)}`).join(' ')
  return `tar -czf - -C ${quoteE2BShellArg(cwd)} ${flags} . | base64 -w0`
}

/**
 * The command that extracts an uploaded archive into a directory.
 * @param archive - absolute remote path of the uploaded archive.
 * @param dest - absolute destination directory; created when missing.
 * @returns a shell command.
 */
export function tarImportCommand(archive: string, dest: string): string {
  return `mkdir -p ${quoteE2BShellArg(dest)} && tar -xzf ${quoteE2BShellArg(archive)} -C ${quoteE2BShellArg(dest)} && rm -f ${quoteE2BShellArg(archive)}`
}

/** Bounds of one export. */
export interface ExportOptions {
  readonly excludes: readonly string[]
  /** Refuse an archive larger than this many bytes (decoded). */
  readonly maxBytes: number
}

/**
 * Archive one directory of a sandbox into memory.
 * @param sandbox - the sandbox holding the directory.
 * @param cwd - absolute directory to export.
 * @param options - excludes and the size cap.
 * @returns the gzip tar bytes.
 * @throws when tar fails or the archive exceeds `maxBytes`.
 */
export async function exportWorkspace(sandbox: Sandbox, cwd: string, options: ExportOptions): Promise<Buffer> {
  const result = await sandbox.commands.run(tarExportCommand(cwd, options.excludes), { envs: e2bControlEnvs() })
  if (result.exitCode !== 0) {
    throw new Error(`camel-runtime: exporting ${cwd} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
  }
  const bytes = Buffer.from(result.stdout.trim(), 'base64')
  if (bytes.byteLength > options.maxBytes) {
    throw new Error(`camel-runtime: workspace archive is ${bytes.byteLength} bytes, over the ${options.maxBytes}-byte cap; exclude large files or raise maxWorkspaceBytes`)
  }
  return bytes
}

/**
 * Extract an archive into a directory of a sandbox.
 * @param sandbox - the receiving sandbox.
 * @param archive - gzip tar bytes.
 * @param dest - absolute destination directory.
 * @throws when the upload or extraction fails.
 */
export async function importWorkspace(sandbox: Sandbox, archive: Buffer, dest: string): Promise<void> {
  await sandbox.files.write(IMPORT_ARCHIVE, new Uint8Array(archive).buffer)
  const result = await sandbox.commands.run(tarImportCommand(IMPORT_ARCHIVE, dest), { envs: e2bControlEnvs() })
  if (result.exitCode !== 0) {
    throw new Error(`camel-runtime: importing into ${dest} failed (exit ${result.exitCode}): ${result.stderr.trim()}`)
  }
}

/**
 * Resolve a workspace-relative directory and refuse one that escapes it.
 * @param cwd - absolute workspace root.
 * @param relative - the caller-supplied relative directory.
 * @returns the absolute path inside `cwd`.
 * @throws when `relative` is absolute or climbs out of `cwd`.
 */
export function insideWorkspace(cwd: string, relative: string): string {
  const resolved = posix.normalize(posix.join(cwd, relative)).replace(/(?<=.)\/+$/, '')
  if (posix.isAbsolute(relative) || resolved !== cwd && !resolved.startsWith(`${cwd}/`)) {
    throw new Error(`camel-runtime: ${relative} is outside the workspace ${cwd}`)
  }
  return resolved
}
