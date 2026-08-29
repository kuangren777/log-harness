/**
 * The one session event this package appends.
 *
 * Only the tool path records it. A search run from the browser view has no
 * agent session — the "recent queries" table is that path's whole record — so
 * the event exists to make the model-visible half reconstructable: a reader
 * replaying the log sees which query the model ran and how many records came
 * back beside the `tool/call` that produced them.
 * @module @deepseek-ai/dsh-sci-literature/src/events
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { formatSourceErrors } from './history.ts'
import type { LiteratureSearchResult, SciLiteratureSearchedData } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One `literature_search` call finished and its records reached the model.
     *
     * The record text itself is already in the `tool/result` this event sits
     * beside, so nothing here is required to rebuild a model request; the event
     * adds only the merged hit count and which sources failed, which the result
     * text summarizes but does not carry as data. A build that does not know
     * this type may therefore skip it, and it is appended `ignorable: true`.
     * @mode append
     * @param data - the query, the merged hit count before truncation, and one
     *   `<source>:<code>` pair per source that did not answer.
     */
    'sci/literature-searched': SciLiteratureSearchedData
  }
}

/**
 * Project one search result into the event payload.
 * @param query - the query the tool call carried.
 * @param result - the completed search result.
 * @returns the payload, with an empty `sourceErrors` list when every source answered.
 */
export function literatureSearchedData(query: string, result: LiteratureSearchResult): SciLiteratureSearchedData {
  const joined = formatSourceErrors(result.sourceErrors)
  return {
    query,
    hits: result.total,
    sourceErrors: joined === undefined ? [] : joined.split(','),
  }
}

/**
 * Append the search record to the calling agent's session.
 * @param session - the session the tool call ran in.
 * @param query - the query the tool call carried.
 * @param result - the completed search result.
 */
export function recordLiteratureSearch(session: Session, query: string, result: LiteratureSearchResult): void {
  session.append('sci/literature-searched', literatureSearchedData(query, result), { ignorable: true })
}
