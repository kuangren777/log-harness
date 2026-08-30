/**
 * Session-log fixtures the roster's folds are asserted over.
 *
 * The records are built from the real `SessionEventMap` payloads — the tool
 * result carries a real `ToolResultMessage` — so a fold that would break on a
 * production log breaks here too. Only the envelope is assembled by hand: a
 * `Session` would need a store, and these folds never touch one.
 */
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'

/** Envelope shared by every hand-built record. */
function record(type: string, seq: number, time: number, data: unknown): SessionEvent {
  // The envelope is the log's own shape; the payloads above it are the real
  // typed ones, so the cast covers assembly rather than content.
  return { type, seq, time, data } as unknown as SessionEvent
}

/** One `tool/call` record for a delegation tool. */
export function toolCall(
  seq: number,
  time: number,
  name: string,
  args: Record<string, unknown>,
  callId = `call-${seq}`,
): SessionEvent {
  return record('tool/call', seq, time, {
    turn: 1,
    step: 1,
    callId: CallId(callId),
    name,
    arguments: JSON.stringify(args),
  })
}

/** A `tool/call` whose arguments are not the JSON the schema promised. */
export function malformedCall(seq: number, time: number, name: string, args: string): SessionEvent {
  return record('tool/call', seq, time, { turn: 1, step: 1, callId: CallId(`call-${seq}`), name, arguments: args })
}

/** One `tool/result` record pairing with {@link toolCall}. */
export function toolResult(
  seq: number,
  time: number,
  callId: string,
  options: { isError?: boolean; meta?: JsonValue; error?: { name: string; code: string } } = {},
): SessionEvent {
  const message = createToolResultMessage({
    callId: CallId(callId),
    content: [{ type: 'text', text: 'done' }],
    isError: options.isError === true,
  })
  return record('tool/result', seq, time, {
    turn: 1,
    step: 1,
    message,
    ...options.meta === undefined ? {} : { meta: options.meta },
    ...options.error === undefined ? {} : { error: options.error },
  })
}

/** A child session's own log: descriptor, then the turns the timing fold counts. */
export function childLog(
  label: string | undefined,
  persona: string | undefined,
  turns: readonly { start: number; end?: number }[],
): SessionEvent[] {
  const descriptor = persona === undefined
    ? snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: 'spawn',
      // A one-shot provider may establish a child with no creation label.
      ...label === undefined ? {} : { label },
    })
    : snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: label ?? '', persona })
  const events: SessionEvent[] = [record('subagent/descriptor', 1, 100, descriptor)]
  let seq = 2
  for (const turn of turns) {
    events.push(record('turn/start', seq++, turn.start, { turn: 1 }))
    if (turn.end !== undefined) events.push(record('turn/end', seq++, turn.end, { turn: 1 }))
  }
  return events
}
