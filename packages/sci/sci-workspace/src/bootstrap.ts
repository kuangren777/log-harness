/**
 * One-shot bootstrap of the sandbox home skeleton the path table describes.
 *
 * The sandbox image cannot bake that skeleton. The sandbox daemon mounts
 * `/home/user` as a persistent volume, and the mount masks everything the image
 * placed under that path, so the image keeps a copy outside the home and ships
 * an idempotent command on PATH — `sci-init` — that lays the tree down at first
 * use. This module runs that command once per plugin lifetime, through the
 * subprocess seam, so a fresh sandbox holds `projectRoot` before any tool or
 * RPC reaches into it.
 *
 * Every outcome is a report, never a throw. The skeleton's absence is already
 * visible where it matters — a `workspace.create` or directory listing under
 * `projectRoot` fails naming the missing path — and a bootstrap that cannot run
 * must not take the profile's boot with it.
 * @module @deepseek-ai/dsh-sci-workspace/bootstrap
 */

import type { SubprocessOutcome, SubprocessOutputReader, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/**
 * Directory the bootstrap command runs in. It cannot be a directory under the
 * science home, because laying that tree down is what the command is for; `/`
 * is the one directory every execution world already has, and the command
 * reads its target from the sandbox environment rather than from the working
 * directory.
 */
export const BOOTSTRAP_CWD = '/'

/**
 * Terminate-escalation grace for the bootstrap command. It bounds teardown of a
 * command that is already only waiting on the filesystem, so it is a fixed
 * lifecycle constant rather than a deployment-varying limit.
 */
const BOOTSTRAP_GRACE_MS = 5_000

/** Byte cap on the retained bootstrap output: a one-line summary and a failure tail, not a data channel. */
const BOOTSTRAP_OUTPUT_MAX_BYTES = 8 * 1024

/** One bootstrap attempt: the command to run and how long to wait for it. */
export interface SkeletonBootstrapRequest {
  /** Executable and arguments; `argv[0]` is the program, resolved on the execution world's PATH. */
  readonly argv: readonly string[]
  /** Deadline in milliseconds; the command is terminated and the attempt reported as failed once it passes. */
  readonly timeoutMs: number
}

/**
 * What one bootstrap attempt left behind: the command's own last line when it
 * succeeded, or one diagnostic sentence when it did not.
 */
export type SkeletonBootstrapReport =
  | {
    readonly kind: 'ok'
    /** The command's last non-empty stdout line — for `sci-init`, the root it made ready. */
    readonly summary: string
  }
  | {
    readonly kind: 'failed'
    /** Why the attempt failed, ending in the command's stderr tail when it produced one. */
    readonly detail: string
  }

/**
 * Split a configured bootstrap command into argv.
 *
 * The split is on whitespace and nothing else: the subprocess seam never
 * interprets a shell, so quoting, globs, and redirection in the configured
 * value are argv text rather than syntax. A deployment needing shell semantics
 * points this at its own script.
 * @param command - the configured command line; a blank value disables the bootstrap.
 * @returns the argv, or `undefined` when the bootstrap is disabled.
 */
export function parseBootstrapArgv(command: string): readonly string[] | undefined {
  const trimmed = command.trim()
  if (trimmed === '') return undefined
  return trimmed.split(/\s+/)
}

/**
 * The last non-empty line of a captured stream.
 * @param text - the captured text.
 * @returns the trailing line, or the empty string when the stream carried none.
 */
export function lastLine(text: string): string {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line !== '')
  return lines.at(-1) ?? ''
}

/**
 * The trailing line of one collected stream.
 * @param reader - the collected stream, or `undefined` when the spawn kept none.
 * @returns the trailing line, or the empty string.
 */
function tail(reader: SubprocessOutputReader | undefined): string {
  return reader === undefined ? '' : lastLine(reader.readFrom(0).text)
}

/**
 * Append a stderr tail to a diagnostic sentence.
 * @param text - the stderr tail, possibly empty.
 * @returns the tail as a suffix, or the empty string.
 */
function suffix(text: string): string {
  return text === '' ? '' : `: ${text}`
}

/**
 * How a closed bootstrap process ended, for the failure message.
 * @param outcome - the process's exit facts.
 * @returns the exit clause.
 */
function describeExit(outcome: SubprocessOutcome): string {
  return outcome.exitCode === null ? `on signal ${String(outcome.signal)}` : `with code ${String(outcome.exitCode)}`
}

/**
 * Run one bootstrap attempt to completion and report it.
 *
 * The deadline is this function's own `AbortController`: the seam reacts to an
 * abort by terminating the process tree, so a command that hangs on the sandbox
 * is reported as a timeout instead of holding the attempt open. The attempt
 * never rejects — a spawn that throws, a seam that rejects `done`, and a
 * non-zero exit all become a `failed` report.
 * @param subprocess - the composed subprocess seam.
 * @param request - the command to run and its deadline.
 * @returns the report; `ok` only for an exit code of zero within the deadline.
 */
export async function runSkeletonBootstrap(
  subprocess: SubprocessRuntime,
  request: SkeletonBootstrapRequest,
): Promise<SkeletonBootstrapReport> {
  const command = request.argv.join(' ')
  const deadline = new AbortController()
  const timer = setTimeout(() => { deadline.abort() }, request.timeoutMs)
  try {
    const handle = subprocess.spawn({
      argv: request.argv,
      cwd: BOOTSTRAP_CWD,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: BOOTSTRAP_OUTPUT_MAX_BYTES },
        stderr: { maxBytes: BOOTSTRAP_OUTPUT_MAX_BYTES },
      },
      graceMs: BOOTSTRAP_GRACE_MS,
      signal: deadline.signal,
    })
    const outcome = await handle.done
    const exit = describeExit(outcome)
    if (deadline.signal.aborted) {
      return {
        kind: 'failed',
        detail: `${command} did not finish within ${String(request.timeoutMs)} ms and was terminated (${exit})${suffix(tail(handle.collected.stderr))}`,
      }
    }
    if (outcome.exitCode !== 0) {
      return { kind: 'failed', detail: `${command} exited ${exit}${suffix(tail(handle.collected.stderr))}` }
    }
    return { kind: 'ok', summary: tail(handle.collected.stdout) }
  } catch (error: unknown) {
    return { kind: 'failed', detail: `${command} could not run: ${String(error)}` }
  } finally {
    clearTimeout(timer)
  }
}
