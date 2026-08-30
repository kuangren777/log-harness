/** A `ctx.sciLiterature` stand-in, so the soft dependency can be present or absent. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { LiteratureRecord, LiteratureSearchResult } from '@deepseek-ai/dsh-sci-literature/types'

/** Records the stub answers with, keyed by nothing: every search returns them all. */
export let stubbedRecords: readonly LiteratureRecord[] = []

/**
 * Set what the next searches answer.
 * @param records - the records to return.
 */
export function setStubbedRecords(records: readonly LiteratureRecord[]): void {
  stubbedRecords = records
}

/** The queries the stub was asked for, in order. */
export const stubbedQueries: string[] = []

/** A literature service that answers from {@link stubbedRecords}. */
export class StubLiterature extends Service {
  /**
   * @param ctx - the mounting context.
   */
  constructor(ctx: Context) {
    super(ctx, 'sciLiterature')
  }

  /**
   * @param request - the search request; only the query is read.
   * @returns the configured records.
   */
  search(request: { query: string }): Promise<LiteratureSearchResult> {
    stubbedQueries.push(request.query)
    return Promise.resolve({ records: stubbedRecords, total: stubbedRecords.length, sourceErrors: [], elapsedMs: 1 })
  }
}
