/**
 * CaMeL runtime for the science-research agent profile: the Dormice sandbox
 * behind `ctx.e2b` stays the workspace's only durable copy, and an AgentENV
 * server supplies persistent microVM variants — named slots, each a copy of
 * one project directory, bounded per workspace. This plugin mounts the five
 * variant tools. It is meant for the cluster (Swarm) preset only: a tier that
 * cannot fan out has no use for variants, and the AgentENV key is injected
 * only into cluster processes.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-camel-runtime
 */

import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-e2b'
import type {} from '@deepseek-ai/dsh-tools'
import { AgentEnvClient } from './agentenv.ts'
import { applyVariantTools } from './tools.ts'
import { VariantEngine } from './variants.ts'

export { API_KEY_HEADER, AgentEnvClient } from './agentenv.ts'
export type { AgentEnvApi, AgentEnvClientOptions } from './agentenv.ts'
export { REGISTRY_FILE, VARIANT_NAME, VariantRegistry, parseRegistry, serializeRegistry } from './registry.ts'
export {
  COLLECT_TOOL,
  CREATE_TOOL,
  DELETE_TOOL,
  LIST_TOOL,
  RUN_TOOL,
  applyVariantTools,
  formatCollected,
  formatCreated,
  formatListing,
  formatRun,
  parseText,
  parseTimeout,
  parseVariantName,
} from './tools.ts'
export type { VariantToolLimits } from './tools.ts'
export {
  IMPORT_ARCHIVE,
  exportWorkspace,
  importWorkspace,
  insideWorkspace,
  tarExportCommand,
  tarImportCommand,
} from './transfer.ts'
export type { ExportOptions } from './transfer.ts'
export { COLLECT_DIR, TAIL_CHARS, TIMEOUT_EXIT_CODE, VariantEngine, limitMessage, runShell } from './variants.ts'
export type { VariantEngineDeps } from './variants.ts'
export type {
  AgentEnvSandbox,
  AgentEnvSandboxDetail,
  AgentEnvSandboxState,
  AgentEnvSnapshot,
  SciVariantCreatedData,
  SciVariantDeletedData,
  SciVariantRunData,
  VariantCollectResult,
  VariantListing,
  VariantRecord,
  VariantRegistryFile,
  VariantRunResult,
  VariantState,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'camel-runtime'

/** The tool registry the variant tools join, and the workspace sandbox they copy from. */
export const inject = ['tools', 'e2b']

/** Default byte cap on one exported project archive. */
const DEFAULT_MAX_PROJECT_BYTES = 64 * 1024 * 1024

/** Paths never worth copying: platform state, dependency trees, and bulky binaries. */
const DEFAULT_EXCLUDES = ['./.sci', './.dsh-e2b', '*/node_modules', './.git', '*.bin']

/** Deployment-varying choices for the CaMeL runtime. */
export interface Config {
  /** Base URL of the AgentENV server. */
  endpoint?: string
  /** AgentENV API key; omission reads `AENV_API_KEY`. It is never forwarded into any sandbox. */
  apiKey?: string
  /** AgentENV template a fresh variant starts from; it must carry the same toolchain as the workspace image. */
  template: string
  /** Variant slots one workspace may hold; a plan-dependent cap the deployment sets per VM. */
  maxVariants?: number
  /** Workspace-relative directory holding the registry and `<name>/collect/`. */
  variantsDir?: string
  /** Byte cap on one exported project archive. */
  maxProjectBytes?: number
  /** Command budget when a call names none. */
  commandTimeoutSeconds?: number
  /** Largest command budget a call may ask for. */
  maxCommandTimeoutSeconds?: number
  /** Idle seconds before a variant pauses itself; every use extends it. */
  sandboxTimeoutSeconds?: number
  /** tar exclude patterns applied when copying a project either way. */
  exclude?: string[]
}

interface ResolvedConfig extends Config {
  endpoint: string
  maxVariants: number
  variantsDir: string
  maxProjectBytes: number
  commandTimeoutSeconds: number
  maxCommandTimeoutSeconds: number
  sandboxTimeoutSeconds: number
  exclude: string[]
}

/** Schemastery schema; the Loader fills defaults before `apply` runs. */
export const Config: z<Config> = z.object({
  endpoint: z.string().default('http://127.0.0.1:8000'),
  apiKey: z.string(),
  template: z.string().required(),
  maxVariants: z.number().default(8),
  variantsDir: z.string().default('.sci/variants'),
  maxProjectBytes: z.number().default(DEFAULT_MAX_PROJECT_BYTES),
  commandTimeoutSeconds: z.number().default(600),
  maxCommandTimeoutSeconds: z.number().default(3600),
  sandboxTimeoutSeconds: z.number().default(1800),
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
  for (const field of ['maxVariants', 'maxProjectBytes', 'commandTimeoutSeconds', 'maxCommandTimeoutSeconds', 'sandboxTimeoutSeconds'] as const) {
    if (!Number.isInteger(config[field]) || config[field] <= 0) {
      throw new Error(`camel-runtime: ${field} must be a positive integer`)
    }
  }
  if (config.commandTimeoutSeconds > config.maxCommandTimeoutSeconds) {
    throw new Error('camel-runtime: commandTimeoutSeconds must not exceed maxCommandTimeoutSeconds')
  }
  if (config.variantsDir.startsWith('/') || config.variantsDir.split('/').includes('..')) {
    throw new Error(`camel-runtime: variantsDir must be a relative path inside the workspace: ${config.variantsDir}`)
  }
}

/**
 * Mount the variant tools over the deployment's AgentENV server and the workspace sandbox.
 * @param ctx - the plugin context.
 * @param config - the schema-filled configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery fills the defaulted fields before apply runs; the type does not encode that step.
  const resolved = config as ResolvedConfig
  const apiKey = config.apiKey ?? process.env.AENV_API_KEY ?? ''
  validateConfig(resolved, apiKey)
  const engine = new VariantEngine({
    api: new AgentEnvClient({ endpoint: resolved.endpoint, apiKey }),
    workspace: () => ctx.e2b.getSandbox(),
    cwd: ctx.e2b.cwd,
    variantsDir: posix.join(ctx.e2b.cwd, resolved.variantsDir),
    template: resolved.template,
    maxVariants: resolved.maxVariants,
    excludes: resolved.exclude,
    maxProjectBytes: resolved.maxProjectBytes,
    sandboxTimeoutSeconds: resolved.sandboxTimeoutSeconds,
  })
  applyVariantTools(ctx, engine, {
    maxVariants: resolved.maxVariants,
    defaultTimeoutSeconds: resolved.commandTimeoutSeconds,
    maxTimeoutSeconds: resolved.maxCommandTimeoutSeconds,
  }, resolved.variantsDir)
}
