/**
 * Public vocabulary of the science-research audit projection: the audited kind
 * of one log record, the three durable row types this package owns, the tagged
 * row a projection step emits, and the on-demand session summary.
 *
 * This module contains types only, so a Client or Remote face can read the row
 * and summary contracts without importing Host runtime code.
 * @module @deepseek-ai/dsh-sci-audit/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * What one `sci_audit` row records, derived from the session-log event it was
 * projected from. A closed union: an event type this package does not handle
 * produces no row at all rather than an untyped one.
 *
 * `authorized` and `authorization-denied` split the single `sci/authorized`
 * event by its `decision` field so a summary can count granted authorizations
 * without re-reading the log; the security model's own table lists only
 * `authorized` because it predates that field.
 */
export type AuditKind =
  | 'tool-call'
  | 'tool-result'
  | 'tool-denied'
  | 'fs-denied'
  | 'delivered'
  | 'delivery-failed'
  | 'authorized'
  | 'authorization-denied'
  | 'approval-decided'
  | 'plan-declared'
  | 'tier-resolved'
  | 'tier-upgrade-suggested'
  | 'memory-written'
  | 'skills-synced'
  | 'workflow-run-start'
  | 'workflow-agent-start'
  | 'workflow-agent-end'
  | 'workflow-run-end'
  | 'turn-end'
  | 'request-context'

/**
 * Who performed the audited action, as the projecting session's own log can
 * tell: `main` for work the session itself did, `workflow:<runId>` for a
 * workflow run record, and `workflow:<runId>/<label>` for one member of a run.
 * A subagent form is absent by construction — see the README's deferred work.
 */
export type AuditActor = string

/**
 * One projected `sci_audit` row: a single audited fact from one session-log
 * event, keyed by the log coordinate it came from so a cold replay of the same
 * log produces the identical key.
 */
export interface AuditRecord {
  /** Session whose log produced this row. */
  readonly sessionId: SessionId
  /** Seq of the source event within that log; with `sessionId` it is the row's key. */
  readonly seq: number
  /** Unix epoch milliseconds of the source event. */
  readonly ts: number
  /** What this row records. */
  readonly kind: AuditKind
  /** Who acted. */
  readonly actor: AuditActor
  /** Tool the row is about, when the source event names one. */
  readonly toolName?: string
  /** Path, slug, delivery id, plan id, or run id the row is about, when the source event names one. */
  readonly target?: string
  /** Stable machine-readable classifier (a gate's rule id, an authorization category, a tier), for counting. */
  readonly rule?: string
  /** Human-readable detail of the row: a denial sentence, a command, an outcome. */
  readonly reason?: string
  /** Lowercase hex sha256 the source event carried, when it carried one. */
  readonly sha256?: string
}

/** One projected `sci_delivery` row: a file that reached the user. */
export interface DeliveryRecord {
  /** Identity of the delivery; the table key. */
  readonly deliveryId: string
  /** Session the delivery happened in. */
  readonly sessionId: SessionId
  /** Absolute sandbox path that was delivered. */
  readonly path: string
  /** Lowercase hex sha256 of the delivered bytes at delivery time. */
  readonly sha256: string
  /** What was delivered, as the delivering package classified it. */
  readonly kind: string
  /** Card title shown to the user. */
  readonly title: string
  /** One-sentence explanation, absent when the delivery carried none. */
  readonly description?: string
  /** Unix epoch milliseconds of the delivery event. */
  readonly ts: number
}

/** One projected `sci_plan` row: a declared multi-agent plan and the run it drove. */
export interface PlanRecord {
  /** Identity of the plan; the table key. */
  readonly planId: string
  /** Session the plan was declared in. */
  readonly sessionId: SessionId
  /** The declared agent list, verbatim JSON, so a schema change needs no migration. */
  readonly agentsJson: string
  /** The declared edge list, verbatim JSON. */
  readonly edgesJson: string
  /** Workflow run this plan authorized, absent until a run starts under it. */
  readonly workflowRunId?: string
  /** Unix epoch milliseconds of the declaration. */
  readonly ts: number
}

/**
 * One row a projection step wants written, tagged by the table that owns it.
 * A tagged union rather than three parallel lists: the projector emits rows in
 * the order they must be committed, and the live and cold paths both replay
 * that order verbatim.
 */
export type ProjectedRow =
  | { readonly table: 'sci_audit'; readonly key: string; readonly value: AuditRecord }
  | { readonly table: 'sci_delivery'; readonly key: string; readonly value: DeliveryRecord }
  | { readonly table: 'sci_plan'; readonly key: string; readonly value: PlanRecord }

/**
 * The on-demand per-session audit summary. Computed when asked, never on a
 * session-end trigger: `session/end` does not exist in this harness.
 */
export interface AuditSummary {
  /** The session this summary describes. */
  readonly sessionId: SessionId
  /** Refusals by the tool and filesystem gates (`tool-denied` plus `fs-denied` rows). */
  readonly denied: number
  /** Files that reached the user. */
  readonly delivered: number
  /** Irreversible actions the user explicitly authorized. */
  readonly authorized: number
  /** Write-timing score of the memory nodes this session produced, absent when it produced none. */
  readonly memoryTimingScore?: number
  /**
   * Whether the session consulted the web and then answered without an inline
   * link: the second behavioral invariant, measured rather than gated.
   */
  readonly citationMissing: boolean
}

/** Outcome of one `rebuild` call over the sessions it was given. */
export interface RebuildReport {
  /** Sessions that were re-projected, in the order they were requested. */
  readonly sessionIds: readonly SessionId[]
  /** Rows deleted from the three owned tables before re-projection. */
  readonly removed: number
  /** Rows written by the re-projection. */
  readonly written: number
}
