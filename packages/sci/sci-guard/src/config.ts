/**
 * Deployment-varying description of what this gate treats as irreversible:
 * which regions hold unsigned executables, which regions hold work that must
 * not be deleted without a decision, which categories are live at all, and
 * where the mounted shell tools keep their command text.
 * @module @deepseek-ai/dsh-sci-guard/config
 */

import z from '@deepseek-ai/schemastery'
import type { ShellToolBinding } from './types.ts'

/** Which classes of irreversible action reach the user as a question. */
export interface CategorySwitches {
  /** Running an ELF or shebang-less script out of a scratch region. */
  execUnsigned: boolean
  /** Uploading or piping local content to an external endpoint. */
  egress: boolean
  /** Writing over SSH keys, `.netrc`, or a private key file. */
  credential: boolean
  /** Recursively deleting inside a region that holds work. */
  destructive: boolean
}

/** Deployment-varying choices for the irreversible-action gate. */
export interface Config {
  /**
   * Absolute directory holding one subdirectory per project. Required: the
   * home layout differs per sandbox image, and a wrong guess would place every
   * region outside the gate and silently disable two of its four categories.
   */
  projectRoot: string
  /**
   * Project-relative directories an executed file is unsigned in. A binary the
   * agent downloaded, compiled, or unpacked lands here, so a command word
   * resolving below one of these is the case the user must decide.
   */
  execRoots: string[]
  /**
   * Project-relative directories whose recursive deletion needs a decision.
   * The scratch region is deliberately absent: `rm -rf tmp/...` is the
   * intended way to clean up and asking about it would train the user to
   * approve without reading.
   */
  destructiveRoots: string[]
  /** Which categories are live; a category switched off is classified as no risk at all. */
  categories: CategorySwitches
  /**
   * Largest candidate the gate reads back to identify and hash. A larger file
   * is not probed, which classifies it as an unsigned script and still asks —
   * the safe direction, at the cost of a question about a large signed binary.
   */
  probeMaxBytes: number
  /** The mounted shell-class tools, and the argument each keeps its command line in. */
  shellTools: ShellToolBinding[]
}

/** Default probe cap, matching the workspace gate's binary probe. */
const DEFAULT_PROBE_MAX_BYTES = 8 * 1024 * 1024

/** The shell-class tools this repository ships, with the argument names they declare. */
export const DEFAULT_SHELL_TOOLS: ShellToolBinding[] = [
  { name: 'bash', command: 'command' },
  { name: 'terminal_send', command: 'text' },
]

/** Project-relative directories an executed file is unsigned in, by default. */
export const DEFAULT_EXEC_ROOTS: string[] = ['tmp', 'workspace']

/** Project-relative directories whose recursive deletion needs a decision, by default. */
export const DEFAULT_DESTRUCTIVE_ROOTS: string[] = ['workspace', 'papers', 'sciplots', 'memory']

const shellToolBinding: z<ShellToolBinding> = z.object({
  name: z.string().required(),
  command: z.string().required(),
})

/** Schemastery schema for the irreversible-action gate. */
export const Config: z<Config> = z.object({
  projectRoot: z.string().required(),
  execRoots: z.array(z.string()).default(DEFAULT_EXEC_ROOTS),
  destructiveRoots: z.array(z.string()).default(DEFAULT_DESTRUCTIVE_ROOTS),
  categories: z.object({
    execUnsigned: z.boolean().default(true),
    egress: z.boolean().default(true),
    credential: z.boolean().default(true),
    destructive: z.boolean().default(true),
  }).default({ execUnsigned: true, egress: true, credential: true, destructive: true }),
  probeMaxBytes: z.number().step(1).min(1).default(DEFAULT_PROBE_MAX_BYTES),
  shellTools: z.array(shellToolBinding).default(DEFAULT_SHELL_TOOLS),
})
