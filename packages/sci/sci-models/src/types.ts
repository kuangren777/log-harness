/**
 * The gate's per-tenant model catalog as this plugin reads it: which models an
 * institution has opened, what to call them, and which provider route serves
 * each one.
 * @module @deepseek-ai/dsh-sci-models/types
 */

/**
 * Which provider route serves one catalogued model. The value doubles as the
 * `ctx.llm` provider route name, so the gate's routing decision and the
 * harness's adapter selection are the same string rather than two vocabularies
 * kept in step by hand.
 */
export type ModelRoute = 'camel-api' | 'deepseek-official'

/** One model the gate has opened to this VM's tenant. */
export interface CatalogModel {
  /** Wire model id, sent to the provider and named by a request. */
  readonly model: string
  /** Selector label the user picks by. */
  readonly displayName: string
  /** Vendor label the selector groups this model under. */
  readonly providerLabel: string
  /** Provider route that serves it. */
  readonly route: ModelRoute
}

/** One complete answer of the gate's model catalog. */
export interface ModelCatalogSnapshot {
  /**
   * Catalog version the answer was served at. Recorded rather than compared:
   * the gate raises it on every catalog edit, so an operator reading a log can
   * tell which edit a VM was serving.
   */
  readonly version: number
  /** Every model this tenant may call, in the gate's own order. */
  readonly models: readonly CatalogModel[]
}
