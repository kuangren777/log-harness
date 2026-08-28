/**
 * CaMeL runtime for the science-research agent profile: the Dormice sandbox
 * behind `ctx.e2b` stays the workspace's only durable copy, and an AgentENV
 * server supplies snapshot-and-fork microVMs for parallel variants. This
 * plugin mounts the `fork_workspace` tool that joins the two. It is meant for
 * the cluster (Swarm) preset only: a tier that cannot fan out has no use for
 * forks, and the AgentENV key is injected only into cluster processes.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-camel-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-e2b'
import type {} from '@deepseek-ai/dsh-tools'
import { AgentEnvClient } from './agentenv.ts'
import { ForkEngine } from './fork.ts'
import { applyForkTool } from './tool.ts'

export { API_KEY_HEADER, AgentEnvClient } from './agentenv.ts'
export type { AgentEnvApi, AgentEnvClientOptions } from './agentenv.ts'
export { COLLECT_DIR, ForkEngine, TAIL_CHARS, TIMEOUT_EXIT_CODE, mapWithConcurrency, runShell } from './fork.ts'
export type { ForkEngineDeps } from './fork.ts'
export {
  FORK_TOOL,
  VARIANT_NAME,
  applyForkTool,
  describeForkTool,
  formatForkResult,
  parseForkRequest,
} from './tool.ts'
export type { ForkRunner, ForkToolArgs, ForkToolLimits, ForkToolValue } from './tool.ts'
export {
  IMPORT_ARCHIVE,
  exportWorkspace,
  importWorkspace,
  insideWorkspace,
  tarExportCommand,
  tarImportCommand,
} from './transfer.ts'
export type { ExportOptions } from './transfer.ts'
export type {
  AgentEnvSandbox,
  AgentEnvSnapshot,
  ForkOutcome,
  ForkRequest,
  ForkVariant,
  ForkVariantResult,
  SciForkCompletedData,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'camel-runtime'

/** The tool registry the fork tool joins, and the workspace sandbox it forks. */
export const inject = ['tools', 'e2b']

/** Default byte cap on the exported workspace archive. */
const DEFAULT_MAX_WORKSPACE_BYTES = 64 * 1024 * 1024

/** Paths never worth forking: platform state, dependency trees, and bulky binaries. */
const DEFAULT_EXCLUDES = ['./.sci', './.dsh-e2b', '*/node_modules', './.git', '*.bin']

/** Deployment-varying choices for the CaMeL runtime. */
export interface Config {
  /** Base URL of the AgentENV server. */
  endpoint?: string
  /** AgentENV API key; omission reads `AENV_API_KEY`. It is never forwarded into any sandbox. */
  apiKey?: string
  /** AgentENV template the seed microVM starts from; it must carry the same toolchain as the workspace image. */
  template: string
  /** Workspace-relative directory receiving `<forkId>/<variant>/`. */
  forksDir?: string
  /** Variants one call may request. */
  maxVariants?: number
  /** Byte cap on the exported workspace archive. */
  maxWorkspaceBytes?: number
  /** Per-variant command budget when the call names none. */
  commandTimeoutSeconds?: number
  /** Largest per-variant command budget a call may ask for. */
  maxCommandTimeoutSeconds?: number
  /** TTL of every microVM the engine starts; a safety net, since the engine deletes them itself. */
  sandboxTimeoutSeconds?: number
  /** Variants running at once. */
  concurrency?: number
  /** tar exclude patterns applied to the workspace export. */
  exclude?: string[]
}

interface ResolvedConfig extends Config {
  endpoint: string
  forksDir: string
  maxVariants: number
  maxWorkspaceBytes: number
  commandTimeoutSeconds: number
  maxCommandTimeoutSeconds: number
  sandboxTimeoutSeconds: number
  concurrency: number
  exclude: string[]
}

/** Schemastery schema; the Loader fills defaults before `apply` runs. */
export const Config: z<Config> = z.object({
  endpoint: z.string().default('http://127.0.0.1:8000'),
  apiKey: z.string(),
  template: z.string().required(),
  forksDir: z.string().default('.sci/forks'),
  maxVariants: z.number().default(8),
  maxWorkspaceBytes: z.number().default(DEFAULT_MAX_WORKSPACE_BYTES),
  commandTimeoutSeconds: z.number().default(600),
  maxCommandTimeoutSeconds: z.number().default(3600),
  sandboxTimeoutSeconds: z.number().default(1800),
  concurrency: z.number().default(4),
  exclude: z.array(z.string()).default(DEFAULT_EXCLUDES),
})

/**
 * Check the constraints the schema cannot express.
 * @param config - the schema-filled configuration.
 * @param apiKey - the resolved API key.
 * @throws with the offending field named.
 */
export function validateConfig(config: ResolvedConfig, apiKey: string): void {
  if (apiKey.length === 0) throw new Error('camel-runtime: configure apiKey or set AENV_API_KEY')
  if (config.template.trim().length === 0) throw new Error('camel-runtime: template must name an AgentENV template')
  if (!URL.canParse(config.endpoint)) throw new Error(`camel-runtime: endpoint must be an absolute URL: ${config.endpoint}`)
  for (const field of ['maxVariants', 'maxWorkspaceBytes', 'commandTimeoutSeconds', 'maxCommandTimeoutSeconds', 'sandboxTimeoutSeconds', 'concurrency'] as const) {
    if (!Number.isInteger(config[field]) || config[field] <= 0) {
      throw new Error(`camel-runtime: ${field} must be a positive integer`)
    }
  }
  if (config.commandTimeoutSeconds > config.maxCommandTimeoutSeconds) {
    throw new Error('camel-runtime: commandTimeoutSeconds must not exceed maxCommandTimeoutSeconds')
  }
  if (config.forksDir.startsWith('/') || config.forksDir.split('/').includes('..')) {
    throw new Error(`camel-runtime: forksDir must be a relative path inside the workspace: ${config.forksDir}`)
  }
}

/**
 * Mount the fork tool over the deployment's AgentENV server and the workspace sandbox.
 * @param ctx - the plugin context.
 * @param config - the schema-filled configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery fills the defaulted fields before apply runs; the type does not encode that step.
  const resolved = config as ResolvedConfig
  const apiKey = config.apiKey ?? process.env.AENV_API_KEY ?? ''
  validateConfig(resolved, apiKey)
  const engine = new ForkEngine({
    api: new AgentEnvClient({ endpoint: resolved.endpoint, apiKey }),
    workspace: () => ctx.e2b.getSandbox(),
    cwd: ctx.e2b.cwd,
    forksDir: resolved.forksDir,
    template: resolved.template,
    excludes: resolved.exclude,
    maxWorkspaceBytes: resolved.maxWorkspaceBytes,
    sandboxTimeoutSeconds: resolved.sandboxTimeoutSeconds,
    concurrency: resolved.concurrency,
  })
  applyForkTool(ctx, request => engine.run(request), {
    maxVariants: resolved.maxVariants,
    defaultTimeoutSeconds: resolved.commandTimeoutSeconds,
    maxTimeoutSeconds: resolved.maxCommandTimeoutSeconds,
  }, resolved.forksDir)
}
