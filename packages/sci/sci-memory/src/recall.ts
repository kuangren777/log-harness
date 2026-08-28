/**
 * Pure projections behind the recall RPC.
 *
 * The studied platform recalled past work with a `transcribe.py` that globbed
 * raw JSONL transcripts out of the sandbox and reassembled the dialogue itself
 * (`ClawsGO-System/05-Chat-History/README.md`). Here the same two views —
 * one line per session, and one session's clean dialogue — are folds over the
 * session log the harness already keeps, so recall never depends on a private
 * on-disk format.
 * @module @deepseek-ai/dsh-sci-memory/src/recall
 */

import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
// Type-only: merges `compaction/summary` into the event map read below.
import type {} from '@deepseek-ai/dsh-compaction'
import type { RecallIndexRow, RecallSessionValue, RecallTranscriptEntry } from './types.ts'

/**
 * Event type carrying a delivered file's title.
 *
 * Typed as `string` rather than a `SessionEventMap` key on purpose:
 * `@deepseek-ai/dsh-sci-deliver` owns the event, and recall reads it without
 * depending on that package so a deployment that mounts memory without
 * delivery still produces an index — with empty `deliveries` lists.
 */
const DELIVERED_EVENT: string = 'sci/delivered'

/** Ellipsis appended to an opening request that exceeds its character budget. */
const ELLIPSIS = '…'

/**
 * Join the visible text of one message's content, dropping tool traffic.
 * @param content - the message's content blocks.
 * @returns the newline-joined text blocks, trimmed.
 */
function visibleText(content: readonly SessionEvent<'user/message'>['data']['content'][number][]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * Read the title of one delivery event without depending on its owning package.
 * @param event - a raw log event.
 * @returns the delivered file's title, or `undefined` for any other event.
 */
function deliveredTitle(event: SessionEvent): string | undefined {
  if (event.type !== DELIVERED_EVENT) return undefined
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const title: unknown = (data as { title?: unknown }).title
  return typeof title === 'string' && title.length > 0 ? title : undefined
}

/**
 * Bound one opening request to a character budget.
 * @param text - the complete request text.
 * @param limit - maximum characters to keep, including the ellipsis.
 * @returns the text, ellipsized when it exceeds the budget.
 */
function bound(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}${ELLIPSIS}`
}

/**
 * Project one index row from a session's header and raw log.
 *
 * The opening request is the first human-sourced `user/message`; a message a
 * plugin, tool, or compaction replacement produced is not what the human asked
 * for and never becomes the row's opening line.
 * @param header - the session's header.
 * @param events - the session's raw log, in ascending seq order.
 * @param openingRequestLimit - maximum characters kept of the opening request.
 * @returns the index row.
 */
export function projectRecallIndexRow(
  header: SessionHeader,
  events: readonly SessionEvent[],
  openingRequestLimit: number,
): RecallIndexRow {
  let openingRequest = ''
  const deliveries: string[] = []
  for (const event of events) {
    if (openingRequest === '' && event.type === 'user/message' && event.data.source.kind === 'user') {
      openingRequest = bound(visibleText(event.data.content), openingRequestLimit)
    }
    const title = deliveredTitle(event)
    if (title !== undefined) deliveries.push(title)
  }
  return {
    sessionId: header.id,
    startedAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    openingRequest,
    deliveries,
  }
}

/**
 * Project one session's clean dialogue from its raw log.
 *
 * Only human input and model prose survive: tool calls, tool results, stream
 * chunks, and turn/step boundaries are dropped, and reasoning blocks are
 * dropped with them. A compaction keeps a marker in place of the history it
 * replaced, so a reader sees where the transcript is no longer continuous.
 * @param header - the session's header.
 * @param events - the session's raw log, in ascending seq order.
 * @returns the transcript in log order.
 */
export function projectRecallSession(
  header: SessionHeader,
  events: readonly SessionEvent[],
): RecallSessionValue {
  const entries: RecallTranscriptEntry[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      const text = visibleText(event.data.content)
      if (text !== '') entries.push({ kind: 'message', role: 'user', at: event.time, text })
      continue
    }
    if (event.type === 'assistant/message') {
      const text = visibleText(event.data.message.content)
      if (text !== '') entries.push({ kind: 'message', role: 'assistant', at: event.time, text })
      continue
    }
    if (event.type === 'compaction/summary') {
      entries.push({ kind: 'compaction', at: event.time, shadowedEvents: event.data.shadowedSeqs.length })
    }
  }
  return { sessionId: header.id, startedAt: header.createdAt, entries }
}
