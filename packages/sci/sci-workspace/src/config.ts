/**
 * Deployment-varying description of the sandbox the gate governs: where each
 * region lives, and where each mounted tool keeps the arguments the gate reads.
 *
 * Tool names and argument names are configuration rather than constants because
 * a deployment chooses its filesystem tool set — the defaults describe the
 * tools this repository ships, and a profile mounting a renamed or alternative
 * set says so here instead of silently falling outside the gate.
 * @module @deepseek-ai/dsh-sci-workspace/config
 */

import z from '@deepseek-ai/schemastery'
import { BINARY_MAGIC_BYTES } from './binary.ts'
import type { FsToolBinding, ShellToolBinding } from './types.ts'

/** Deployment-varying choices for the science-research workspace gate. */
export interface Config {
  /**
   * Absolute directory holding one subdirectory per project. Required: the home
   * layout differs per sandbox image, and a wrong guess would classify every
   * science region as unmanaged and silently disable the gate.
   */
  projectRoot: string
  /** Project-relative directory that is the only delivery area. */
  deliveryDir: string
  /** Project-relative directory for intermediate products, deliverable to nobody. */
  scratchDir: string
  /** Project-relative directories holding the two bundle kinds. */
  bundleDirs: {
    /** Directory holding paper bundles, one `<slug>/` per manuscript. */
    papers: string
    /** Directory holding sciplot bundles, one `<slug>/` per figure. */
    sciplots: string
  }
  /** Sandbox-root-relative directory the harness synchronizes the skill tree into. */
  skillsDir: string
  /** Sandbox-root-relative directory owned by the harness user. */
  privateDir: string
  /** Sandbox-root-relative directory shell deliveries are queued in; the one writable place under {@link privateDir}. */
  spoolPendingDir: string
  /** Whether the shell pre-screen refuses recursive deletes reaching into a bundle. */
  denyRecursiveDeleteInBundles: boolean
  /**
   * Command run once, in the execution world of the composed subprocess seam,
   * to lay down the sandbox home skeleton this table classifies. Split on
   * whitespace into argv with no shell interpretation; a blank value disables
   * the bootstrap, which is what a deployment whose home is provisioned
   * elsewhere sets.
   */
  bootstrapCommand: string
  /** Deadline for {@link bootstrapCommand}; past it the command is terminated and the failure logged. */
  bootstrapTimeoutMs: number
  /**
   * Largest file the read gate reads back to identify its format. A larger
   * target passes the gate untouched: the read tool's own byte caps already
   * refuse it, and probing it would mean buffering it twice.
   */
  binaryProbeMaxBytes: number
  /** The mounted tools of each class, and the arguments the gate reads from each. */
  fsTools: {
    /** Tools that read a file; the gate classifies their path argument and probes binaries. */
    read: FsToolBinding[]
    /** Tools that create or overwrite a file; the gate classifies the path and checks manifest ownership on the new content. */
    write: FsToolBinding[]
    /** Tools that edit a file in place; the gate classifies the path and checks manifest ownership on the resulting content. */
    edit: FsToolBinding[]
    /** Tools that run a shell command; the gate pre-screens the command text for recursive deletes reaching a bundle. */
    shell: ShellToolBinding[]
  }
}

/** Default probe cap; above it the read tool's own caps are the operative limit. */
const DEFAULT_BINARY_PROBE_MAX_BYTES = 8 * 1024 * 1024

/** The skeleton command the sci sandbox image ships on PATH. */
const DEFAULT_BOOTSTRAP_COMMAND = 'sci-init'

/** Default bootstrap deadline; the command only creates directories and copies a demo project. */
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 30_000

/**
 * The filesystem tools this repository ships, with the argument names they
 * declare. `str_replace_editor` selects its operation per call, so its binding
 * maps each sub-command onto the operation the gate should apply.
 */
export const DEFAULT_FS_TOOLS: Config['fsTools'] = {
  read: [{ name: 'read', path: 'file_path' }],
  write: [{ name: 'write', path: 'file_path', content: 'content' }],
  edit: [
    { name: 'edit', path: 'file_path', oldText: 'old_string', newText: 'new_string', replaceAll: 'replace_all' },
    {
      name: 'str_replace_editor',
      path: 'path',
      content: 'file_text',
      oldText: 'old_str',
      newText: 'new_str',
      commandArg: 'command',
      commands: { view: 'read', create: 'write', str_replace: 'edit', insert: 'edit' },
    },
  ],
  shell: [
    { name: 'bash', command: 'command' },
    { name: 'terminal_send', command: 'text' },
  ],
}

const fsToolBinding: z<FsToolBinding> = z.object({
  name: z.string().required(),
  path: z.string().required(),
  content: z.string(),
  oldText: z.string(),
  newText: z.string(),
  replaceAll: z.string(),
  commandArg: z.string(),
  commands: z.dict(z.union(['read', 'write', 'edit'] as const)),
})

const shellToolBinding: z<ShellToolBinding> = z.object({
  name: z.string().required(),
  command: z.string().required(),
})

/** Schemastery schema for the science-research workspace gate. */
export const Config: z<Config> = z.object({
  projectRoot: z.string().required(),
  deliveryDir: z.string().default('workspace'),
  scratchDir: z.string().default('tmp'),
  bundleDirs: z.object({
    papers: z.string().default('papers'),
    sciplots: z.string().default('sciplots'),
  }).default({ papers: 'papers', sciplots: 'sciplots' }),
  skillsDir: z.string().default('skills'),
  privateDir: z.string().default('.sci'),
  spoolPendingDir: z.string().default('.sci/spool/pending'),
  denyRecursiveDeleteInBundles: z.boolean().default(true),
  bootstrapCommand: z.string().default(DEFAULT_BOOTSTRAP_COMMAND),
  bootstrapTimeoutMs: z.number().step(1).min(1).default(DEFAULT_BOOTSTRAP_TIMEOUT_MS),
  binaryProbeMaxBytes: z.number().step(1).min(BINARY_MAGIC_BYTES).default(DEFAULT_BINARY_PROBE_MAX_BYTES),
  fsTools: z.object({
    read: z.array(fsToolBinding).default(DEFAULT_FS_TOOLS.read),
    write: z.array(fsToolBinding).default(DEFAULT_FS_TOOLS.write),
    edit: z.array(fsToolBinding).default(DEFAULT_FS_TOOLS.edit),
    shell: z.array(shellToolBinding).default(DEFAULT_FS_TOOLS.shell),
  }).default(DEFAULT_FS_TOOLS),
})
