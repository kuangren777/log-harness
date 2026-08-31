/**
 * The per-tenant model catalog for the science-research profile: the harness
 * side of the model selection an institution makes in the gate.
 *
 * `apply` owns three contributions, in the order they take effect:
 *
 * - A read of `GET /gate/api/credit/models` with the VM bearer token at boot,
 *   re-read every `refreshMs`. A failed read keeps the previous catalog: an
 *   emptied one would revoke every model the institution opened while the gate
 *   blinked.
 * - The `camel-api` provider route on `ctx.llm`, registered exactly while the
 *   catalog lists a model on it, served by a {@link CamelApiAdapter} pointed at
 *   the CaMeL Hub endpoint. The adapter re-reads the catalog per operation, so
 *   adding or removing a model needs no re-registration.
 * - An `llm/stream` waterfall listener that refuses any `(provider, model)` the
 *   catalog does not open, including the DeepSeek routes the harness registers
 *   itself. `ctx.llm`'s own model catalog is advisory and does not gate a
 *   request, so the whitelist has to sit on the call.
 *
 * Prices are not read here. The same gate answer carries them for the browser's
 * price hint, and `@deepseek-ai/dsh-sci-credit` reads its own rate card from
 * `GET /gate/api/credit/pricing`: one authority for what a model costs, one for
 * whether the tenant may call it.
 *
 * Named exports (no default) preserve the Loader's `name`/`inject`/`Config`
 * injection metadata for a function plugin.
 * @module @deepseek-ai/dsh-sci-models
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  CAMEL_API_PROVIDER,
  CamelApiAdapter,
  camelApiAdapterOptions,
  camelApiConnection,
  CamelApiRoute,
} from './adapter.ts'
import { GateCatalogClient, ModelCatalog } from './catalog.ts'
import { Config } from './config.ts'
import { installEnforcement } from './enforce.ts'
// Type-only: merges the `llm/stream` waterfall this plugin's listener joins and
// the optional services the reused adapter reaches through `ctx.get`.
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-referenced-text'

export {
  CAMEL_API_PROVIDER,
  CAMEL_API_PROVIDER_NAME,
  CamelApiAdapter,
  camelApiAdapterOptions,
  camelApiConnection,
  CamelApiRoute,
  resolveCamelApiKey,
} from './adapter.ts'
export { CATALOG_UNAVAILABLE_CODE, CatalogUnavailableError, GateCatalogClient, ModelCatalog } from './catalog.ts'
export type { GateCatalogClientOptions, ModelCatalogDeps } from './catalog.ts'
export {
  DEFAULT_API_BASE_ENV,
  DEFAULT_API_KEY_ENV,
  DEFAULT_GATE_URL,
  DEFAULT_REFRESH_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_VM_TOKEN_ENV,
} from './config.ts'
export type { FailMode } from './config.ts'
export {
  allows,
  catalogUnavailableMessage,
  installEnforcement,
  MODEL_CATALOG_UNAVAILABLE_CODE,
  MODEL_NOT_ALLOWED_CODE,
  notAllowedMessage,
} from './enforce.ts'
export type { CatalogModel, ModelCatalogSnapshot, ModelRoute } from './types.ts'
export { Config }

/** Cordis plugin name. */
export const name = 'sci-models'

/** The provider registry the route is registered on and the waterfall the whitelist joins. */
export const inject = ['llm']

/**
 * Read one environment value the configuration pointed at.
 * @param ctx - the mounting context, whose launcher owns this run's environment.
 * @param key - the environment name to read.
 * @returns the value, or `undefined` when the environment does not carry it.
 */
function environmentValue(ctx: Context, key: string): string | undefined {
  const value = launchEnvironmentOf(ctx).get(key)?.value
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Register the model catalog, the CaMeL Hub route, and the whitelist.
 *
 * The gate token is required: it names whose catalog is served, and without it
 * this plugin has nothing to read and nothing to enforce. The CaMeL Hub
 * endpoint is not. A deployment whose institutions buy only the built-in
 * DeepSeek models never sets it, and one that has not set it yet still gets the
 * whitelist over the models it does have; the `camel-api` route is simply never
 * registered, so a catalogued model on it fails its call with `NO_ADAPTER`
 * instead of taking the whole VM down at boot.
 * @param ctx - the mounting context, carrying `llm`.
 * @param config - the resolved deployment configuration.
 * @throws Error when the environment carries no gate token, which no later step
 *   can supply.
 */
export function apply(ctx: Context, config: Config): void {
  const vmToken = environmentValue(ctx, config.vmTokenEnv)
  if (vmToken === undefined) {
    throw new Error(
      `sci-models: ${config.vmTokenEnv} must carry the gate VM token this tenant is identified by;`
      + " set it in this VM's environment",
    )
  }
  const baseURL = environmentValue(ctx, config.apiBaseEnv)
  if (baseURL === undefined) {
    ctx.logger.warn(
      'sci-models: %s is unset, so no camel-api route is registered; a catalogued camel-api model'
      + ' stays in the whitelist and fails its call with NO_ADAPTER',
      config.apiBaseEnv,
    )
  }
  const apiKeyEnv: CredentialRef = credentialRef(config.apiKeyEnv)

  const client = new GateCatalogClient({
    gateUrl: config.gateUrl,
    vmToken,
    requestTimeoutMs: config.requestTimeoutMs,
  })

  const catalog = new ModelCatalog(ctx, client, config.refreshMs, {
    onChange: () => { route?.sync(catalog.modelsOn(CAMEL_API_PROVIDER).length > 0) },
  })
  const route = baseURL === undefined ? undefined : new CamelApiRoute(ctx, new CamelApiAdapter(
    camelApiAdapterOptions(ctx, () => camelApiConnection(baseURL, apiKeyEnv, catalog.modelsOn(CAMEL_API_PROVIDER))),
  ))

  installEnforcement(ctx, catalog, config.failMode)
  ctx.effect(() => () => {
    catalog.dispose()
    route?.dispose()
  }, 'sci-models.dispose')
  catalog.start()
}
