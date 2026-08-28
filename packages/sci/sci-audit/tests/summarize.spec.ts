// The on-demand session summary. Every figure is computed when a caller asks —
// this harness has no `session/end` event to hang a trigger on
// (10-Implementation-Plan/02-w0-adversary-resolution.md, M2) — so the tests
// drive the pure functions with a session's rows and its raw log.
import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import type { MemoryIndexRecord } from '@deepseek-ai/dsh-sci-memory'
import { citationMissing, summarizeSession } from '@deepseek-ai/dsh-sci-audit'
import type { AuditRecord } from '@deepseek-ai/dsh-sci-audit'

const SESSION = SessionId('11111111-2222-3333-4444-555555555555')
const TIME = 1_700_000_000_000

// The registered names `@deepseek-ai/dsh-tool-web` composes (packages/web/tool-web).
const WEB_TOOLS = ['web_search', 'web_fetch']

/**
 * Build one typed log record.
 * @param seq - the record's log coordinate.
 * @param type - the event type.
 * @param data - the event payload.
 * @returns the record.
 */
function event<T extends SessionEventType>(seq: number, type: T, data: SessionEventMap[T]): SessionEvent {
  return { seq, type, time: TIME + seq, data } as SessionEvent
}

/**
 * Build one `tool/call` record.
 * @param seq - the record's log coordinate.
 * @param name - the registered tool name.
 * @param callId - the call identity paired with its result.
 * @returns the record.
 */
function call(seq: number, name: string, callId: string): SessionEvent {
  return event(seq, 'tool/call', { turn: 1, step: 1, callId: CallId(callId), name, arguments: '{}' })
}

/**
 * Build one `tool/result` record.
 * @param seq - the record's log coordinate.
 * @param callId - the call this result settles.
 * @returns the record.
 */
function result(seq: number, callId: string): SessionEvent {
  return event(seq, 'tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId: CallId(callId), content: [{ type: 'text', text: 'ok' }], isError: false }),
  })
}

/**
 * Build one assistant answer.
 * @param seq - the record's log coordinate.
 * @param text - the visible answer text.
 * @returns the record.
 */
function answer(seq: number, text: string): SessionEvent {
  return event(seq, 'assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'reasoning', text: 'see ](https://ignored.example)' }, { type: 'text', text }],
      source: { provider: 'deepseek', model: 'deepseek-chat' },
    }),
  })
}

/**
 * Build one audit row of the given kind.
 * @param seq - the row's log coordinate.
 * @param kind - what the row records.
 * @returns the row.
 */
function row(seq: number, kind: AuditRecord['kind']): AuditRecord {
  return { sessionId: SESSION, seq, ts: TIME + seq, kind, actor: 'main' }
}

const MEMORY: MemoryIndexRecord = {
  slug: 'gh-auth-via-host-config',
  originSessionId: SESSION,
  writtenAtTurn: 1,
  turnsTotal: 4,
}

describe('citationMissing', () => {
  it('is true when the web answered and the final message carries no link', () => {
    expect(citationMissing([
      call(1, 'web_search', 'c-1'),
      result(2, 'c-1'),
      answer(3, 'The paper reports a 3x speedup.'),
    ], WEB_TOOLS)).toBe(true)
  })

  it('is false when the final message cites an inline link', () => {
    expect(citationMissing([
      call(1, 'web_fetch', 'c-1'),
      result(2, 'c-1'),
      answer(3, 'The paper reports a 3x speedup ([source](https://arxiv.org/abs/1)).'),
    ], WEB_TOOLS)).toBe(false)
  })

  it('is false when the session never consulted the web', () => {
    expect(citationMissing([
      call(1, 'read', 'c-1'),
      result(2, 'c-1'),
      answer(3, 'From the local notes.'),
    ], WEB_TOOLS)).toBe(false)
  })

  it('is false when a web call never returned a result to cite', () => {
    expect(citationMissing([
      call(1, 'web_search', 'c-1'),
      answer(2, 'No sources were reachable.'),
    ], WEB_TOOLS)).toBe(false)
  })

  it('measures the last assistant message, not an earlier one', () => {
    expect(citationMissing([
      call(1, 'web_search', 'c-1'),
      result(2, 'c-1'),
      answer(3, 'Working from ([source](https://arxiv.org/abs/1)).'),
      answer(4, 'In short: a 3x speedup.'),
    ], WEB_TOOLS)).toBe(true)
  })
})

describe('summarizeSession', () => {
  it('counts refusals, deliveries, and authorizations from the committed rows', () => {
    const summary = summarizeSession({
      sessionId: SESSION,
      auditRows: [
        row(1, 'tool-denied'),
        row(2, 'fs-denied'),
        row(3, 'delivered'),
        row(4, 'authorized'),
        row(5, 'authorization-denied'),
        row(6, 'tool-call'),
      ],
      events: [],
      memoryRows: [MEMORY],
      webToolNames: WEB_TOOLS,
    })

    expect(summary).toEqual({
      sessionId: SESSION,
      denied: 2,
      delivered: 1,
      authorized: 1,
      memoryTimingScore: 0.75,
      citationMissing: false,
    })
  })

  it('omits the memory-timing score for a session that indexed no node', () => {
    const summary = summarizeSession({
      sessionId: SESSION,
      auditRows: [],
      events: [call(1, 'web_search', 'c-1'), result(2, 'c-1'), answer(3, 'no link here')],
      memoryRows: [],
      webToolNames: WEB_TOOLS,
    })

    expect(summary).not.toHaveProperty('memoryTimingScore')
    expect(summary).toMatchObject({ denied: 0, delivered: 0, authorized: 0, citationMissing: true })
  })
})
