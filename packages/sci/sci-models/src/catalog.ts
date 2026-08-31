/**
 * The gate's model catalog: the authenticated read, its JSON validation, and
 * the in-memory copy every later decision is made against.
 *
 * The answer crosses a process boundary, so every field is validated here
 * rather than trusted from the type. A gate that cannot answer leaves the
 * previous catalog in force — a stale selection serves the tenant better than
 * an empty one, which would refuse every model it had just been allowed.
 * @module @deepseek-ai/dsh-sci-models/catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CatalogModel, ModelCatalogSnapshot, ModelRoute } from './types.ts'

/** Path of the per-tenant catalog, relative to the gate's base URL. */
const CATALOG_PATH = '/gate/api/credit/models'

/** Machine code every catalog-read failure carries. */
export const CATALOG_UNAVAILABLE_CODE = 'SCI_MODELS_GATE_UNAVAILABLE'

/** The routes the gate is allowed to name; a row on any other route is unroutable here. */
const KNOWN_ROUTES: readonly ModelRoute[] = ['camel-api', 'deepseek-official']

/**
 * The gate could not be reached, timed out, refused the read, or answered
 * something this client cannot read. All four are one condition for the
 * caller: the tenant's current model selection is not known right now.
 */
export class CatalogUnavailableError extends Error {
  /** Stable machine-routable failure class. */
  readonly code: string = CATALOG_UNAVAILABLE_CODE

  /**
   * @param message - what specifically failed, for the operator's log.
   * @param options - optional cause chaining.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CatalogUnavailableError'
  }
}

/** Construction options for {@link GateCatalogClient}. */
export interface GateCatalogClientOptions {
  /** Base URL of the gate; a trailing slash is tolerated. */
  readonly gateUrl: string
  /** Bearer token identifying this VM's tenant. */
  readonly vmToken: string
  /** HTTP deadline for one read, after which it counts as unreachable. */
  readonly requestTimeoutMs: number
  /** Transport; tests substitute one, deployments get the platform's. */
  readonly fetch?: typeof fetch
}

/** A JSON object, or `undefined` when the value is not one. */
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** A non-empty string read off a JSON field, or `undefined`. */
function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The route named by a JSON field, or `undefined` when it is not one this harness can serve. */
function routeField(source: Record<string, unknown>): ModelRoute | undefined {
  return KNOWN_ROUTES.find(route => route === source['route'])
}

/**
 * Read the published catalog.
 *
 * A row missing an id, a label, or a routable route is skipped rather than
 * failing the whole answer: one malformed row must not revoke every other
 * model the institution opened.
 * @param body - the parsed JSON body.
 * @returns the catalog.
 * @throws CatalogUnavailableError when the version or the model list is unreadable.
 */
function readCatalog(body: unknown): ModelCatalogSnapshot {
  const source = objectValue(body)
  const version = source?.['version']
  const rows = source?.['models']
  if (source === undefined || typeof version !== 'number' || !Number.isSafeInteger(version) || !Array.isArray(rows)) {
    throw new CatalogUnavailableError('sci-models: gate catalog is missing version or models')
  }
  const models: CatalogModel[] = []
  for (const entry of rows) {
    const row = objectValue(entry)
    if (row === undefined) continue
    const model = stringField(row, 'model')
    const route = routeField(row)
    if (model === undefined || route === undefined) continue
    models.push({
      model,
      displayName: stringField(row, 'displayName') ?? model,
      providerLabel: stringField(row, 'providerLabel') ?? route,
      route,
    })
  }
  return { version, models }
}

/** The gate's catalog endpoint as one method. */
export class GateCatalogClient {
  private readonly transport: typeof fetch

  /**
   * @param options - endpoint, credential, deadline, and the injected transport.
   */
  constructor(private readonly options: GateCatalogClientOptions) {
    this.transport = options.fetch ?? globalThis.fetch
  }

  /**
   * Read the models this VM's tenant may call.
   * @returns the catalog.
   * @throws CatalogUnavailableError when the gate cannot be reached or answers unreadably.
   */
  async catalog(): Promise<ModelCatalogSnapshot> {
    const url = `${this.options.gateUrl.replace(/\/+$/, '')}${CATALOG_PATH}`
    let response: Response
    try {
      response = await this.transport(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.options.vmToken}` },
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new CatalogUnavailableError(`sci-models: GET ${CATALOG_PATH} did not reach the gate`, { cause: error })
    }
    if (!response.ok) {
      throw new CatalogUnavailableError(
        `sci-models: GET ${CATALOG_PATH} answered HTTP ${String(response.status)}`,
      )
    }
    try {
      return readCatalog(await response.json())
    } catch (error) {
      if (error instanceof CatalogUnavailableError) throw error
      throw new CatalogUnavailableError(`sci-models: GET ${CATALOG_PATH} answered unparseable JSON`, { cause: error })
    }
  }
}

/** Host facilities the catalog takes from outside so the suites can substitute them. */
export interface ModelCatalogDeps {
  /**
   * Schedules the next refresh and returns its canceller. The default uses an
   * unref'd `setTimeout`, so a pending refresh never holds the process open.
   */
  readonly setTimer?: (callback: () => void, delayMs: number) => () => void
  /** Called after every successful read, so the caller can re-sync what it derived from the catalog. */
  readonly onChange?: () => void
}

/** The default deferred-work scheduler: an unref'd timer that cannot keep Node alive. */
function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs)
  timer.unref()
  return () => { clearTimeout(timer) }
}

/**
 * The catalog in force over one mounted context: read at boot, re-read on a
 * timer, and never emptied by a failed read.
 */
export class ModelCatalog {
  private readonly setTimer: (callback: () => void, delayMs: number) => () => void
  private readonly onChange: () => void
  private readonly outstanding = new Set<Promise<void>>()
  private snapshot: ModelCatalogSnapshot | undefined
  private timer: (() => void) | undefined
  private disposed = false

  /**
   * @param ctx - the mounting context, whose logger reports a failed read.
   * @param client - the gate endpoint to read.
   * @param refreshMs - how long to wait between reads.
   * @param deps - injected scheduler and change callback.
   */
  constructor(
    private readonly ctx: Context,
    private readonly client: GateCatalogClient,
    private readonly refreshMs: number,
    deps: ModelCatalogDeps = {},
  ) {
    this.setTimer = deps.setTimer ?? defaultSetTimer
    this.onChange = deps.onChange ?? ((): void => {})
  }

  /**
   * The catalog in force, or `undefined` while no read has ever succeeded.
   * `undefined` and an empty model list are different answers: the first means
   * the tenant's selection is unknown, the second that it is empty.
   */
  get current(): ModelCatalogSnapshot | undefined {
    return this.snapshot
  }

  /**
   * The catalogued models on one provider route, in catalog order.
   *
   * A catalog that has never been read answers with none, which is what both
   * callers need: no route is opened and no model is advertised on one.
   * @param route - the provider route to select.
   * @returns the models on that route.
   */
  modelsOn(route: ModelRoute): readonly CatalogModel[] {
    return this.snapshot?.models.filter(entry => entry.route === route) ?? []
  }

  /** Read the catalog now and keep re-reading it; the first read is not awaited. */
  start(): void {
    this.refresh()
  }

  /**
   * Wait for every read this catalog still owes. Called by the suites for their
   * assertions and by teardown, so a disposed fiber leaves none running.
   * @returns nothing, once no read is outstanding.
   */
  async settled(): Promise<void> {
    while (this.outstanding.size > 0) await Promise.all([...this.outstanding])
  }

  /** Cancel the timer and stop scheduling new reads. */
  dispose(): void {
    this.disposed = true
    this.timer?.()
    this.timer = undefined
  }

  /** Read the catalog once, keep the previous one on failure, and arm the next read. */
  private refresh(): void {
    const read = (async (): Promise<void> => {
      try {
        this.snapshot = await this.client.catalog()
        this.onChange()
      } catch (error) {
        // The previous catalog (or none at all) stays in force: emptying it
        // would revoke every model the institution opened while the gate blinked.
        this.ctx.logger.warn('sci-models: keeping the previous model catalog; the gate did not serve one: %o', error)
      }
      if (this.disposed) return
      this.timer = this.setTimer(() => {
        this.timer = undefined
        this.refresh()
      }, this.refreshMs)
    })()
    this.outstanding.add(read)
    void read.then(() => { this.outstanding.delete(read) })
  }
}
