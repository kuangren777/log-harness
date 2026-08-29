/**
 * Deployment-varying policy of the literature layer.
 *
 * Every field carries a schema default: a settings surface renders the resolved
 * section, so a default that lived only at the use site would read there as no
 * value at all. Nothing here is a credential — the optional Semantic Scholar
 * key is named by {@link Config.s2ApiKeyEnv} and resolved through the
 * credential plane, never stored in the section.
 * @module @deepseek-ai/dsh-sci-literature/src/config
 */

import z from '@deepseek-ai/schemastery'
import type { LiteratureSource } from './types.ts'

/** Every source the layer can query, in merge-priority order. */
export const LITERATURE_SOURCES: readonly LiteratureSource[] = ['openalex', 'semanticscholar', 'arxiv', 'crossref']

/** Records one search returns when the caller names no limit. */
export const DEFAULT_SEARCH_LIMIT = 10

/** Largest record count one search may return; also the model-facing schema bound. */
export const MAX_SEARCH_LIMIT = 20

/** Longest query the layer forwards to an index, in characters. */
export const MAX_QUERY_LENGTH = 300

/** Product identity every outbound request announces. */
export const DEFAULT_USER_AGENT = 'camel-science/0.1 (+https://sci.camelco.de)'

/** Environment variable naming the optional Semantic Scholar key. */
export const DEFAULT_S2_API_KEY_ENV = 'S2_API_KEY'

/** Per-source budget for one fan-out, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 8000

/** Records the layer asks each index for before merging. */
export const DEFAULT_MAX_PER_SOURCE = 15

/** Searches the history table retains per profile. */
export const DEFAULT_HISTORY_LIMIT = 50

/** Deployment-varying policy of the literature layer. */
export interface Config {
  /**
   * Contact address sent to OpenAlex and Crossref. Empty keeps the layer out of
   * both polite pools, which lowers the rate limit but still answers.
   */
  mailto: string
  /** Environment variable naming the optional Semantic Scholar key; the source works keyless. */
  s2ApiKeyEnv: string
  /** Per-source budget for one fan-out, in milliseconds. */
  timeoutMs: number
  /** Records requested from each index before merging. */
  maxPerSource: number
  /** Product identity every outbound request announces. */
  userAgent: string
  /** The sources one search fans out to; a deployment may drop any of them. */
  sources: LiteratureSource[]
  /** Searches the history table retains before the oldest rows are dropped. */
  historyLimit: number
}

/** Loader validation for the literature layer's deployment policy. */
export const Config: z<Config> = z.object({
  mailto: z.string().default(''),
  s2ApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_S2_API_KEY_ENV),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  maxPerSource: z.number().step(1).min(1).max(200).default(DEFAULT_MAX_PER_SOURCE),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  sources: z.array(z.union([
    z.const('openalex' as const),
    z.const('semanticscholar' as const),
    z.const('arxiv' as const),
    z.const('crossref' as const),
  ])).default([...LITERATURE_SOURCES]),
  historyLimit: z.number().step(1).min(1).default(DEFAULT_HISTORY_LIMIT),
})
