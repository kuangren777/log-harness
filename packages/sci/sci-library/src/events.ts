/**
 * The one session event this package appends.
 *
 * Only the tool path records it. A change made from the browser view has no
 * agent session, and the row itself is that path's whole record — so the event
 * exists to make the model-visible half reconstructable: a reader replaying the
 * log sees which entry the model put in the library beside the `tool/call` that
 * did it.
 * @module @deepseek-ai/dsh-sci-library/src/events
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { LibraryEntry, SciLibraryChangedData } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One tool call changed the knowledge base.
     *
     * The entry's own text is already in the `tool/result` this event sits
     * beside, so nothing here is required to rebuild a model request; the event
     * adds only which row changed and how, which the result text states but does
     * not carry as data. A build that does not know this type may therefore skip
     * it, and it is appended `ignorable: true`.
     * @param data - what happened, the entry id it happened to, and that entry's kind.
     */
    'sci/library-changed': SciLibraryChangedData
  }
}

/**
 * Project one changed entry into the event payload.
 * @param op - what happened to the entry.
 * @param entry - the entry as it stood after the operation.
 * @returns the payload.
 */
export function libraryChangedData(op: SciLibraryChangedData['op'], entry: LibraryEntry): SciLibraryChangedData {
  return { op, id: entry.id, kind: entry.kind }
}

/**
 * Append one knowledge-base change to the calling agent's session.
 * @param session - the session the tool call ran in.
 * @param op - what happened to the entry.
 * @param entry - the entry as it stood after the operation.
 */
export function recordLibraryChange(session: Session, op: SciLibraryChangedData['op'], entry: LibraryEntry): void {
  session.append('sci/library-changed', libraryChangedData(op, entry), { ignorable: true })
}
