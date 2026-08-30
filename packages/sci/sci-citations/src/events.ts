/**
 * The one session event this package appends.
 *
 * Only the tool path records it. A change made from the browser view has no
 * agent session to fold, and the pool tables are that path's whole record; the
 * event exists so a reader replaying the log sees which citekey the model put
 * into the manuscript's bibliography, beside the `tool/call` that did it.
 * @module @deepseek-ai/dsh-sci-citations/src/events
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { CitationOp, SciCitationsChangedData } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One citation-pool change the model made reached the tables.
     *
     * The citekey and what happened to it are already in the `tool/result` this
     * event sits beside, so nothing here is required to rebuild a model
     * request; the event adds only the project the change landed in, which the
     * result text states but does not carry as data. A build that does not know
     * this type may therefore skip it, and it is appended `ignorable: true`.
     * @param data - the project, the operation, and the citekey when one was named.
     */
    'sci/citations-changed': SciCitationsChangedData
  }
}

/**
 * Project one completed change into the event payload.
 * @param project - the project whose pool changed.
 * @param op - what the tool call did.
 * @param citekey - the citekey involved, when the operation named one.
 * @returns the payload, with `citekey` absent for a project-wide change.
 */
export function citationsChangedData(
  project: string,
  op: CitationOp,
  citekey?: string,
): SciCitationsChangedData {
  return { project, op, ...citekey === undefined ? {} : { citekey } }
}

/**
 * Append the change to the calling agent's session.
 * @param session - the session the tool call ran in.
 * @param project - the project whose pool changed.
 * @param op - what the tool call did.
 * @param citekey - the citekey involved, when the operation named one.
 */
export function recordCitationsChange(
  session: Session,
  project: string,
  op: CitationOp,
  citekey?: string,
): void {
  session.append('sci/citations-changed', citationsChangedData(project, op, citekey), { ignorable: true })
}
