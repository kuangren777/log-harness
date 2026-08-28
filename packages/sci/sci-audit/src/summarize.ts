/**
 * The on-demand per-session summary.
 *
 * The studied platform's stats page was specified against a session-end hook.
 * This harness has none — `session/end` does not exist — so every figure here
 * is computed when a caller asks, from the durable audit rows plus the log they
 * were projected from
 * (`ClawsGO-System/10-Implementation-Plan/02-w0-adversary-resolution.md`, M2).
 * @module @deepseek-ai/dsh-sci-audit/src/summarize
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { memoryTimingScore } from '@deepseek-ai/dsh-sci-memory'
import type { MemoryIndexRecord } from '@deepseek-ai/dsh-sci-memory'
import type { AuditRecord, AuditSummary } from './types.ts'

/**
 * The inline-citation marker: the start of a Markdown link whose target is a
 * URL. A format constant of the answer the behavioral invariant is about, not
 * a deployment choice, so it is fixed rather than configurable.
 */
const CITATION_MARKER = '](http'

/** Everything the summary is computed from, already narrowed to one session. */
export interface SummaryInput {
  /** The session being summarized. */
  readonly sessionId: SessionId
  /** This session's `sci_audit` rows. */
  readonly auditRows: readonly AuditRecord[]
  /** This session's raw log, in ascending seq order. */
  readonly events: readonly SessionEvent[]
  /** The memory-index rows whose origin is this session; empty when memory is not mounted. */
  readonly memoryRows: readonly MemoryIndexRecord[]
  /** Registered names of the tools that consult the web. */
  readonly webToolNames: readonly string[]
}

/**
 * Join the visible text of one assistant message, dropping tool traffic and
 * reasoning.
 * @param content - the message's content blocks.
 * @returns the newline-joined text blocks.
 */
function visibleText(content: SessionEvent<'assistant/message'>['data']['message']['content']): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Whether the session consulted the web and then answered without an inline link.
 *
 * A web tool CALL alone is not enough: a call that failed or was refused
 * produced no fact to cite. The measured condition is a returned result, paired
 * to its call by `callId` because `tool/result` does not repeat the tool name.
 * @param events - the session's raw log, in ascending seq order.
 * @param webToolNames - registered names of the tools that consult the web.
 * @returns whether the second behavioral invariant was missed in this session.
 */
export function citationMissing(
  events: readonly SessionEvent[],
  webToolNames: readonly string[],
): boolean {
  const webCalls = new Set<string>()
  let consulted = false
  let finalText = ''
  for (const event of events) {
    if (event.type === 'tool/call') {
      if (webToolNames.includes(event.data.name)) webCalls.add(event.data.callId)
      continue
    }
    if (event.type === 'tool/result') {
      if (webCalls.has(event.data.message.source.callId)) consulted = true
      continue
    }
    if (event.type === 'assistant/message') finalText = visibleText(event.data.message.content)
  }
  return consulted && !finalText.includes(CITATION_MARKER)
}

/**
 * Compute one session's audit summary.
 *
 * Counts come from the durable rows rather than the log so the figures a caller
 * sees are the figures the projection committed; a divergence between the two
 * is exactly what `rebuild` exists to expose.
 * @param input - the session's rows, log, memory rows, and web tool names.
 * @returns the summary.
 */
export function summarizeSession(input: SummaryInput): AuditSummary {
  let denied = 0
  let delivered = 0
  let authorized = 0
  for (const row of input.auditRows) {
    if (row.kind === 'tool-denied' || row.kind === 'fs-denied') denied += 1
    else if (row.kind === 'delivered') delivered += 1
    else if (row.kind === 'authorized') authorized += 1
  }
  const score = memoryTimingScore(input.memoryRows)
  return {
    sessionId: input.sessionId,
    denied,
    delivered,
    authorized,
    ...score === undefined ? {} : { memoryTimingScore: score },
    citationMissing: citationMissing(input.events, input.webToolNames),
  }
}
