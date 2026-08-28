/**
 * Service Definition for the E2B sandbox seam (`ctx.e2b`): one shared SDK
 * handle, the reserved adapter-state directory under the shared working
 * directory, and the two helpers every adapter needs to survive the SDK's
 * hard-coded login shell. Acquisition policy — create, connect, lifetime,
 * delete — belongs to Service Providers (`@deepseek-ai/dsh-e2b-cloud` for
 * E2B Cloud, `@deepseek-ai/dsh-dormice` for a self-hosted Dormice pool).
 * @module @deepseek-ai/dsh-e2b
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Sandbox } from 'e2b'

export {
  CommandExitError,
  FileNotFoundError,
  FileType,
  Sandbox,
  SandboxNotFoundError,
} from 'e2b'
export type { CommandHandle, CommandResult, EntryInfo } from 'e2b'

/**
 * Reserved directory name for adapter-owned process and terminal state,
 * placed directly under the shared working directory. Adapters address it
 * through {@link E2BRuntime.runtimeRoot}; every provider must reserve the
 * same relative name so one sandbox reads back the state another wrote.
 */
export const E2B_RUNTIME_DIRECTORY = '.dsh-e2b'

/**
 * Quote one opaque argument for the SDK's unavoidable `/bin/bash -l -c` layer.
 * @param value - Exact argument value to preserve.
 * @returns A single shell word with no interpolation.
 */
export function quoteE2BShellArg(value: string): string {
  return `'${value.replaceAll('\'', "'\"'\"'")}'`
}

/**
 * Isolate E2B's hard-coded login shell behind a fresh randomized home path.
 * @param overrides - Additional environment entries for the internal command.
 * @returns A fresh mutable map that the E2B SDK may extend.
 */
export function e2bControlEnvs(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...overrides, HOME: `/.dsh-e2b-control-${randomUUID()}` }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    e2b: E2BRuntime
  }
}

/**
 * Abstract owner of one shared E2B sandbox. Subclass, implement
 * {@link getSandbox}, and load the subclass as a plugin — it registers as
 * `ctx.e2b` (one implementation per context; loading a second throws, which is
 * cordis' standard duplicate-service behavior). Filesystem and subprocess
 * adapters await the one handle, so they inhabit the same remote Linux world.
 *
 * Implementations must honor these semantics:
 * - {@link getSandbox} resolves only after {@link cwd} and {@link runtimeRoot}
 *   exist in the sandbox, so an adapter's first operation needs no setup.
 * - {@link runtimeRoot} is adapter-private: a real directory, never a symlink,
 *   reachable only by its owner.
 * - Acquisition is shared and repeatable: concurrent callers await one attempt
 *   and receive the same handle.
 * - Acquisition failure is reported to every caller; providers never hand back
 *   a half-prepared sandbox.
 * - Disposal first refuses new handle acquisition; whether it also deletes the
 *   sandbox is the provider's lifetime policy.
 */
export abstract class E2BRuntime extends Service {
  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string

  /**
   * Reserve the seam's shared paths before the provider acquires a sandbox.
   * @param ctx - Cordis context this service registers into.
   * @param cwd - Absolute POSIX working directory shared by every adapter.
   * @throws when `cwd` is not an absolute Linux path.
   */
  constructor(ctx: Context, cwd: string) {
    super(ctx, 'e2b')
    if (!posix.isAbsolute(cwd)) {
      throw new Error(`dsh-e2b: cwd must be an absolute Linux path: ${cwd}`)
    }
    this.cwd = cwd
    this.runtimeRoot = posix.join(cwd, E2B_RUNTIME_DIRECTORY)
  }

  /**
   * Return the shared live SDK handle.
   * @returns the acquired sandbox after {@link cwd} and {@link runtimeRoot} exist.
   * @throws when acquisition fails or the service is disposing.
   */
  abstract getSandbox(): Promise<Sandbox>
}
