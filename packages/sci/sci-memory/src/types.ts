/**
 * Public vocabulary of the science-research memory layer: the parsed memory
 * node, the durable index row, the recall request/response types, and the one
 * session event this package appends.
 *
 * This module contains types only, so a generated Remote client can consume it
 * without importing Host runtime code.
 * @module @deepseek-ai/dsh-sci-memory/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Classification the studied platform gave every memory node. `user` records
 * who the human is, `feedback` records how they want work done, `project`
 * records ongoing work, and `reference` points at an external resource.
 */
export type MemoryNodeType = 'user' | 'feedback' | 'project' | 'reference'

/** Fields the memory-node frontmatter contributes to the index. */
export interface MemoryFrontmatter {
  /** Frontmatter `name`; the slug the node is filed under. */
  readonly name?: string
  /** Frontmatter `description`; the one line recall uses to judge relevance. */
  readonly description?: string
  /** Frontmatter `metadata.type`, when it names one of the four known kinds. */
  readonly type?: MemoryNodeType
  /** Frontmatter `metadata.originSessionId`; the transcript this node was distilled from. */
  readonly originSessionId?: SessionId
}

/**
 * Projected `sci_memory_index` row: one memory node and the point in its
 * originating session at which the model wrote it.
 */
export interface MemoryIndexRecord {
  /** Slug the node is filed under; the table key. */
  readonly slug: string
  /** Session whose work produced the node. */
  readonly originSessionId: SessionId
  /** Frontmatter `metadata.type`, absent when the node declares none. */
  readonly type?: MemoryNodeType
  /** Frontmatter `description`, absent when the node declares none. */
  readonly description?: string
  /** One-based turn of the originating session during which the node was written. */
  readonly writtenAtTurn: number
  /** Turns the originating session had completed when this row was last folded. */
  readonly turnsTotal: number
}

/** Payload of {@link SessionEventMap['sci/memory-written']}. */
export interface SciMemoryWrittenData {
  /** Slug the node is filed under, from frontmatter `name` or the file's base name. */
  readonly slug: string
  /** Session the node points back at, after backfill when the file omitted it. */
  readonly originSessionId: SessionId
  /** One-based turn during which the write landed. */
  readonly turnIndex: number
}

/** One recall index row: the coarse identity of one past session. */
export interface RecallIndexRow {
  /** The session this row describes. */
  readonly sessionId: SessionId
  /** Unix epoch milliseconds when the session was created. */
  readonly startedAt: number
  /** Working directory the session was created in; the only project identity a session header carries. */
  readonly cwd?: string
  /** Opening human request, truncated to the configured character budget. */
  readonly openingRequest: string
  /** Titles of the files delivered during the session, in log order. */
  readonly deliveries: readonly string[]
}

/** The complete recall index, newest session first. */
export interface RecallIndexValue {
  /** One row per session in the logical corpus. */
  readonly sessions: readonly RecallIndexRow[]
}

/** One human or model utterance in a recalled transcript. */
export interface RecallMessageEntry {
  readonly kind: 'message'
  /** Who produced the text. */
  readonly role: 'user' | 'assistant'
  /** Unix epoch milliseconds the event was logged at. */
  readonly at: number
  /** Visible text only; tool calls, tool results, and reasoning are stripped. */
  readonly text: string
}

/** The point at which history was compacted away, kept so a recall reader sees the seam. */
export interface RecallCompactionEntry {
  readonly kind: 'compaction'
  /** Unix epoch milliseconds the compaction summary was logged at. */
  readonly at: number
  /** How many surface events the summary replaced. */
  readonly shadowedEvents: number
}

/** One entry of a recalled transcript. */
export type RecallTranscriptEntry = RecallMessageEntry | RecallCompactionEntry

/** Read one past session's clean dialogue. */
export interface RecallSessionRequest {
  /** Live or persisted session to transcribe. */
  readonly sessionId: SessionId
}

/** One recalled transcript and the header it was projected from. */
export interface RecallSessionValue {
  /** The session this transcript belongs to. */
  readonly sessionId: SessionId
  /** Unix epoch milliseconds when the session was created. */
  readonly startedAt: number
  /** Dialogue and compaction markers in log order. */
  readonly entries: readonly RecallTranscriptEntry[]
}

/** No live or persisted session exists for the requested id. */
export interface RecallSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** Successful recall result. */
export interface RecallSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected recall result carrying a stable business failure. */
export interface RecallRejected<E> {
  readonly ok: false
  readonly error: E
}

/** Result returned by the recall `session` operation. */
export type RecallSessionResult =
  | RecallSuccess<RecallSessionValue>
  | RecallRejected<RecallSessionNotFound>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The model wrote or edited a memory node under the configured memory
     * directory: log-only, non-surface, one record per accepted write. Purely
     * a projection source — nothing later in the log is interpreted
     * differently by its presence — so the producer appends it with the
     * envelope's `ignorable` marker and a reader that does not know the type
     * skips it instead of refusing the log.
     */
    'sci/memory-written': SciMemoryWrittenData
  }
}
