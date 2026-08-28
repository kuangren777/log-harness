// The two recall views over a seeded session log: one line per session, and
// one session's dialogue with tool traffic stripped and the compaction seam kept.
import { describe, expect, it } from 'vitest'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { projectRecallIndexRow, projectRecallSession } from '@deepseek-ai/dsh-sci-memory'

const SESSION = SessionId('11111111-2222-3333-4444-555555555555')
const STARTED_AT = 1_700_000_000_000

/**
 * Create a detached session carrying a header.
 * @param cwd - working directory recorded on the header, when any.
 * @returns the empty session.
 */
function seed(cwd?: string): Session {
  return Session.create(SESSION, [], {
    version: 0,
    id: SESSION,
    createdAt: STARTED_AT,
    ...cwd === undefined ? {} : { cwd },
  })
}

/**
 * Forge one `sci/delivered` record.
 *
 * `@deepseek-ai/dsh-sci-deliver` owns the type and this package deliberately
 * does not depend on it, so the log entry is built directly rather than through
 * a typed `append`; the projection under test reads exactly this raw form.
 * @param data - the event payload to place in the log.
 * @returns the raw log event.
 */
function delivered(data: unknown): SessionEvent {
  return { type: 'sci/delivered', seq: 0, time: STARTED_AT, data } as unknown as SessionEvent
}

/**
 * Append one human turn opener.
 * @param session - the session to append to.
 * @param text - the visible request text.
 */
function userSays(session: Session, text: string): void {
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

/**
 * Append one model reply carrying reasoning, visible text, and a tool call.
 * @param session - the session to append to.
 * @param text - the visible reply text.
 */
function assistantSays(session: Session, text: string): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [
        { type: 'reasoning', text: 'private deliberation' },
        { type: 'text', text },
        { type: 'tool-call', id: CallId('call-1'), name: 'write', arguments: '{}' },
      ],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

describe('projectRecallIndexRow', () => {
  it('summarizes a session by its opening human request and working directory', () => {
    const session = seed('/home/user/sci')
    userSays(session, 'Survey agent fuzzing and write the paper.')
    assistantSays(session, 'Starting the survey.')
    expect(projectRecallIndexRow(session.header, session.events, 120)).toEqual({
      sessionId: SESSION,
      startedAt: STARTED_AT,
      cwd: '/home/user/sci',
      openingRequest: 'Survey agent fuzzing and write the paper.',
      deliveries: [],
    })
  })

  it('collects the titles of delivery records and ignores untitled ones', () => {
    const session = seed()
    userSays(session, 'Plot the results.')
    const events = [
      ...session.events,
      delivered({ title: 'figure-1.png' }),
      delivered({ title: 'figure-2.png' }),
      delivered({ title: '' }),
      delivered({ path: 'no-title.png' }),
      delivered(42),
    ]
    const row = projectRecallIndexRow(session.header, events, 120)
    expect(row.deliveries).toEqual(['figure-1.png', 'figure-2.png'])
    expect(row.cwd).toBeUndefined()
  })

  it('ellipsizes an opening request past the configured budget', () => {
    const session = seed()
    userSays(session, 'x'.repeat(40))
    expect(projectRecallIndexRow(session.header, session.events, 10).openingRequest).toBe(`${'x'.repeat(9)}…`)
  })

  it('ignores a plugin-sourced message and reports an empty request when the human never spoke', () => {
    const session = seed()
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'injected context' }],
        source: { kind: 'plugin', plugin: 'sci-prompt' },
      }),
      { surfaceOp: 'append' },
    )
    expect(projectRecallIndexRow(session.header, session.events, 120).openingRequest).toBe('')
  })
})

describe('projectRecallSession', () => {
  it('keeps human and model prose in order and drops tool traffic', () => {
    const session = seed()
    userSays(session, 'Plot the results.')
    assistantSays(session, 'Rendering the figure.')
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('call-1'), name: 'write', arguments: '{}' })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-1'),
        content: [{ type: 'text', text: 'wrote figure.py' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const projected = projectRecallSession(session.header, session.events)
    expect(projected.sessionId).toBe(SESSION)
    expect(projected.startedAt).toBe(STARTED_AT)
    expect(projected.entries).toEqual([
      { kind: 'message', role: 'user', at: expect.any(Number) as number, text: 'Plot the results.' },
      { kind: 'message', role: 'assistant', at: expect.any(Number) as number, text: 'Rendering the figure.' },
    ])
  })

  it('keeps a compaction marker in place of the history it replaced', () => {
    const session = seed()
    userSays(session, 'Continue.')
    session.append('compaction/summary', {
      compactionId: CompactionId('c1'),
      summary: [{ type: 'text', text: 'earlier work' }],
      shadowedRange: { start: 0, end: 4 },
      shadowedSeqs: [0, 1, 2],
      shadowedTokenCount: 900,
      provider: 'mock',
      model: 'mock',
    })
    const projected = projectRecallSession(session.header, session.events)
    expect(projected.entries.at(-1)).toEqual({
      kind: 'compaction',
      at: session.events.at(-1)!.time,
      shadowedEvents: 3,
    })
  })

  it('drops a non-human user message and a message with no visible text', () => {
    const session = seed()
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'injected' }],
        source: { kind: 'plugin', plugin: 'sci-prompt' },
      }),
      { surfaceOp: 'append' },
    )
    userSays(session, '   ')
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: CallId('call-1'), name: 'write', arguments: '{}' }],
        source: { provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    expect(projectRecallSession(session.header, session.events).entries).toEqual([])
  })
})
