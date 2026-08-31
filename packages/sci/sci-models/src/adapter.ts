/**
 * The `camel-api` provider route: a {@link DeepSeekAdapter} pointed at the
 * CaMeL Hub endpoint, and the registration that exists exactly while the
 * catalog opens a model on that route.
 *
 * The adapter is reused rather than reimplemented because CaMeL Hub speaks the
 * same OpenAI-compatible chat-completions protocol DeepSeek does, down to the
 * SSE framing and the usage fields the metering prices; only the endpoint, the
 * credential, the catalog, and the selector name differ, and all four are
 * already per-operation inputs of that adapter.
 * @module @deepseek-ai/dsh-sci-models/adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
// Type-only: merges the optional credential service this module reads through `ctx.get`.
import type {} from '@deepseek-ai/dsh-credentials'
import type { CatalogModel } from './types.ts'

/** The provider route this package owns, and the gate's own name for it. */
export const CAMEL_API_PROVIDER = 'camel-api'

/** Selector name shown for the {@link CAMEL_API_PROVIDER} route. */
export const CAMEL_API_PROVIDER_NAME = 'CaMeL Hub'

/**
 * The DeepSeek adapter under the CaMeL Hub name.
 *
 * `providerInfo` is the one behavior that cannot come from the connection
 * facts: the base class states the vendor it was written for, and a selector
 * showing "DeepSeek" for a route the institution knows as CaMeL Hub would
 * misattribute every model on it.
 */
export class CamelApiAdapter extends DeepSeekAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: CAMEL_API_PROVIDER_NAME }
  }
}

/**
 * Build the connection facts for one CaMeL Hub generation.
 *
 * Everything except the endpoint, the credential, and the catalog is the
 * adapter's own published default: this package routes an OpenAI-compatible
 * endpoint, and re-deciding request bounds here would fork them from the
 * adapter that enforces them.
 * @param baseURL - the CaMeL Hub endpoint, from the configured environment name.
 * @param apiKeyEnv - credential reference resolved per request.
 * @param models - the catalogued models on this route, in catalog order.
 * @returns validated connection facts for {@link CamelApiAdapter}.
 */
export function camelApiConnection(
  baseURL: string,
  apiKeyEnv: CredentialRef,
  models: readonly CatalogModel[],
): DeepSeekConnectionOptions {
  return {
    baseURL,
    apiKeyEnv,
    defaults: {},
    maxTokens: DEFAULT_MAX_TOKENS,
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    models: models.map(entry => ({ id: entry.model, name: entry.displayName })),
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    maxRequestFilesBytes: DEFAULT_MAX_REQUEST_FILES_BYTES,
    maxInlineRequestImageBytes: DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
    maxImagesPerRequest: DEFAULT_MAX_IMAGES_PER_REQUEST,
    imageOffloadByteQuantum: DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
    inlineImageOffloadByteQuantum: DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
    imageOffloadCountQuantum: DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
    filesApiTimeoutMs: DEFAULT_FILES_API_TIMEOUT_MS,
    filePolicy: {
      expiresAfterSeconds: DEFAULT_FILE_EXPIRY_SECONDS,
      refreshMarginSeconds: DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
      quotaCleanupBatch: DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
    },
    retryPolicy: resolveRetryPolicy(undefined, 'sci-models: retryPolicy'),
  }
}

/**
 * Resolve the CaMeL Hub key for one connection generation.
 *
 * The credential reference comes from the caller's snapshot and is never
 * re-read, so a key can only ever be paired with the endpoint of the same
 * resolution. The managed store is asked first and the launch environment
 * second, because a deployment that mounts the credential seam expects its
 * stored value to win over whatever the container happened to inherit.
 * @param ctx - the mounting context, carrying the optional credential service.
 * @param connection - the connection facts this request will be sent with.
 * @returns the key, usable as an HTTP header value.
 * @throws LlmError `MISSING_CREDENTIAL` when neither plane carries the reference.
 */
export async function resolveCamelApiKey(ctx: Context, connection: DeepSeekConnectionOptions): Promise<string> {
  const ref = connection.apiKeyEnv
  const hit = await ctx.get('credentials')?.resolve(ref)
  if (hit !== undefined) return assertUsableApiKey(hit.value, 'sci-models', ref)
  const ambient = launchEnvironmentOf(ctx).get(ref)
  if (ambient !== undefined && ambient.value.length > 0) {
    return assertUsableApiKey(ambient.value, 'sci-models', ref)
  }
  throw new LlmError(
    `sci-models: no API key for provider route "${CAMEL_API_PROVIDER}"; store ${ref} through the credentials`
    + ` service, or export ${ref} in this VM's environment`,
    'MISSING_CREDENTIAL',
  )
}

/**
 * The operation-local resolution hooks the reused adapter takes from this
 * plugin: the connection facts, the credential, the anonymous id shared with
 * telemetry, and the two optional services a request carrying images or named
 * text needs. The attachment and referenced-text services are read through
 * `ctx.get` at each request rather than captured, because a composition may
 * mount them after this plugin.
 * @param ctx - the mounting context.
 * @param options - the connection facts of the current generation.
 * @returns the adapter's construction options.
 */
export function camelApiAdapterOptions(
  ctx: Context,
  options: () => DeepSeekConnectionOptions,
): DeepSeekAdapterOptions {
  let userId: AnonymousUserId | undefined
  return {
    options,
    resolveApiKey: connection => resolveCamelApiKey(ctx, connection),
    resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
    resolveAttachments: () => ctx.get('attachments'),
    resolveReferencedText: () => ctx.get('referencedText'),
  }
}

/**
 * Holds the `camel-api` route registered exactly while the catalog lists a
 * model on it.
 *
 * The route is dropped rather than left empty when the catalog stops listing
 * one, because a registered route with no models is a selector entry a user can
 * open and find nothing in. The adapter itself is registered once and re-reads
 * the catalog per operation, so a catalog edit that only adds or removes models
 * needs no re-registration.
 */
export class CamelApiRoute {
  private registration: AdapterRegistrationHandle | undefined
  private disposed = false

  /**
   * @param ctx - the mounting context carrying `llm`.
   * @param adapter - the adapter to register for the route.
   */
  constructor(
    private readonly ctx: Context,
    private readonly adapter: CamelApiAdapter,
  ) {}

  /**
   * Register or drop the route to match the catalog.
   * @param present - whether the catalog now lists a model on this route.
   */
  sync(present: boolean): void {
    if (this.disposed) return
    if (present && this.registration === undefined) {
      this.registration = this.ctx.llm.registerAdapter([CAMEL_API_PROVIDER], this.adapter)
      return
    }
    if (!present && this.registration !== undefined) {
      this.registration()
      this.registration = undefined
    }
  }

  /** Drop the route and stop reacting to catalog changes. */
  dispose(): void {
    this.disposed = true
    this.registration?.()
    this.registration = undefined
  }
}
