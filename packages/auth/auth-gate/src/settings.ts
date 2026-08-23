/**
 * Resolved gate configuration. Defaulting happens here and nowhere else, and a
 * value this gate cannot serve with fails the plugin load rather than the
 * first sign-in.
 * @module @deepseek-ai/dsh-auth-gate/settings
 */

/** Cookie name a deployment gets without saying otherwise. */
export const DEFAULT_COOKIE_NAME = 'dsh_session'
/** Second-factor code lifetime: long enough to read a mail, short enough that a leaked code is stale. */
export const DEFAULT_CODE_TTL_MS = 10 * 60_000
/** Reset and confirmation link lifetime. */
export const DEFAULT_LINK_TTL_MS = 60 * 60_000

/** Plugin configuration. */
export interface Config {
  /**
   * Absolute origin this deployment is reached at, used to build the links
   * mail carries. It has no default: a link to the wrong origin either fails
   * to open or sends a one-time token somewhere else.
   */
  baseUrl: string
  /** Name of the session cookie; defaults to `dsh_session`. */
  cookieName?: string
  /**
   * Whether the session cookie carries `Secure`, which keeps a browser from
   * ever sending it over plain HTTP. Defaults to `true`; set it to `false`
   * only for a deployment reached over loopback HTTP, where the attribute
   * would stop the cookie from working at all.
   */
  cookieSecure?: boolean
  /** How long a second-factor code stays valid, in milliseconds. */
  codeTtlMs?: number
  /** How long a reset or confirmation link stays valid, in milliseconds. */
  linkTtlMs?: number
}

/** Complete gate parameters, with every default already applied. */
export interface GateSettings {
  /** Parsed {@link Config.baseUrl}, the base every mailed link resolves against. */
  readonly baseUrl: URL
  /** Name of the session cookie. */
  readonly cookieName: string
  /** Whether the session cookie carries `Secure`. */
  readonly cookieSecure: boolean
  /** Second-factor code lifetime in milliseconds. */
  readonly codeTtlMs: number
  /** Reset and confirmation link lifetime in milliseconds. */
  readonly linkTtlMs: number
}

/**
 * Resolve plugin configuration into complete gate parameters.
 * @param config - the plugin's configuration.
 * @returns the fully resolved parameters.
 * @throws Error when `baseUrl` is not an absolute URL.
 */
export function resolveSettings(config: Config): GateSettings {
  let baseUrl: URL
  try {
    baseUrl = new URL(config.baseUrl)
  } catch {
    throw new Error(`auth-gate: baseUrl ${JSON.stringify(config.baseUrl)} is not an absolute URL`)
  }
  return {
    baseUrl,
    cookieName: config.cookieName ?? DEFAULT_COOKIE_NAME,
    cookieSecure: config.cookieSecure ?? true,
    codeTtlMs: config.codeTtlMs ?? DEFAULT_CODE_TTL_MS,
    linkTtlMs: config.linkTtlMs ?? DEFAULT_LINK_TTL_MS,
  }
}
