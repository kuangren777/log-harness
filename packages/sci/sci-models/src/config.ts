/**
 * Deployment-varying choices for the model catalog: which gate publishes it,
 * which environment names carry the gate token and the CaMeL Hub connection,
 * how often the catalog is re-read, and what happens to a model call made
 * before any catalog has been read.
 * @module @deepseek-ai/dsh-sci-models/config
 */

import z from '@deepseek-ai/schemastery'

/** What enforcement does while no catalog has ever been read. */
export type FailMode = 'closed' | 'open'

/** Default gate endpoint: the loopback port the VM's own gate listens on. */
export const DEFAULT_GATE_URL = 'http://127.0.0.1:3079'

/** Default environment name carrying the gate VM bearer token. */
export const DEFAULT_VM_TOKEN_ENV = 'SCI_GATE_VM_TOKEN'

/** Default environment name carrying the CaMeL Hub endpoint. */
export const DEFAULT_API_BASE_ENV = 'CAMEL_API_BASE_URL'

/** Default environment name carrying the CaMeL Hub API key. */
export const DEFAULT_API_KEY_ENV = 'CAMEL_API_KEY'

/** Default catalog refresh interval. */
export const DEFAULT_REFRESH_MS = 300_000

/** Default HTTP deadline for one catalog read. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000

/** Deployment-varying choices for the model catalog. */
export interface Config {
  /** Base URL of the gate that publishes this tenant's catalog. */
  gateUrl: string
  /**
   * Environment name holding the gate VM bearer token. The name rather than
   * the token: the value identifies whose catalog is served and belongs in the
   * container's Env beside the other credentials, not in a composition file.
   */
  vmTokenEnv: string
  /** Environment name holding the CaMeL Hub base URL the `camel-api` route posts to. */
  apiBaseEnv: string
  /** Environment name holding the CaMeL Hub API key, resolved per request through the credential seam. */
  apiKeyEnv: string
  /**
   * How often the catalog is re-read. An institution's model selection changes
   * at human pace, so this trades how long a revoked model stays callable
   * against a request per VM per interval.
   */
  refreshMs: number
  /** HTTP deadline for one catalog read, after which it counts as unreachable. */
  requestTimeoutMs: number
  /**
   * What happens to a model call made before any catalog has been read.
   * `open` admits it, `closed` refuses it. The default is `open` because the
   * gate already refuses a call this VM cannot pay for: a catalog that has not
   * arrived yet is a selection problem, not a spending one.
   */
  failMode: FailMode
}

/** Schemastery schema for the model catalog. */
export const Config: z<Config> = z.object({
  gateUrl: z.string().default(DEFAULT_GATE_URL),
  vmTokenEnv: z.string().default(DEFAULT_VM_TOKEN_ENV),
  apiBaseEnv: z.string().default(DEFAULT_API_BASE_ENV),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
  refreshMs: z.number().step(1).min(1000).default(DEFAULT_REFRESH_MS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  failMode: z.union(['closed', 'open'] as const).default('open'),
})
