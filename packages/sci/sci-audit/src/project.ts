/**
 * The pure projection from session-log events to audit rows.
 *
 * The studied platform's design carried a 74-table operational schema whose
 * `audit_events` table was never written
 * (`ClawsGO-System/09-Target-Architecture/04-persistence-model.md`). Here the
 * append-only session log is the only source of truth and this module is the
 * whole projection: one event in, zero or more rows out, no I/O and no clock.
 * Every row is keyed by the log coordinate or the identity its source event
 * carries, so replaying a log twice writes the same keys and `rebuild` can
 * assert equality against the live projection.
 *
 * Three `sci/*` types are matched by their type STRING rather than through the
 * session event map, because `sci-guard` and `sci-tier` are being written after
 * this package. Their fields are read structurally against
 * `04-persistence-model.md`; each carries a `TODO(sci-audit)` to switch to the
 * imported payload type once it lands.
 * @module @deepseek-ai/dsh-sci-audit/src/project
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: merges the log vocabulary this projection reads into SessionEventMap.
import type {} from '@deepseek-ai/dsh-tool-workflow/types'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-sci-deliver'
import type {} from '@deepseek-ai/dsh-sci-memory'
import type {} from '@deepseek-ai/dsh-sci-plan'
import { SUBAGENT_TOOL_PREFIX } from '@deepseek-ai/dsh-sci-tier'
import type {} from '@deepseek-ai/dsh-sci-skills'
import type {} from '@deepseek-ai/dsh-sci-workspace'
import { AUDIT_TABLE, DELIVERY_TABLE, PLAN_TABLE } from './spec.ts'
import type { AuditActor, AuditKind, AuditRecord, PlanReconciliation, PlanRecord, ProjectedRow } from './types.ts'

/** Actor of work the projecting session performed itself. */
export const MAIN_ACTOR: AuditActor = 'main'

/**
 * Event type of one granted or refused authorization for an irreversible action.
 *
 * Typed as `string` rather than a `SessionEventMap` key: `dsh-sci-guard` owns
 * the declaration and is being written after this package, so this projection
 * matches the type string and reads its fields structurally.
 * TODO(sci-audit): import the payload type from `@deepseek-ai/dsh-sci-guard`.
 */
const AUTHORIZED: string = 'sci/authorized'

/**
 * Event type of one tool call refused by the tier or plan gate.
 * TODO(sci-audit): import the payload type from `@deepseek-ai/dsh-sci-guard`.
 */
const TOOL_DENIED: string = 'sci/tool-denied'

/**
 * Event type of the session's resolved tier.
 * TODO(sci-audit): import the payload type from `@deepseek-ai/dsh-sci-tier`.
 */
const TIER_RESOLVED: string = 'sci/tier-resolved'

/**
 * Event type of a suggested tier upgrade.
 * TODO(sci-audit): import the payload type from `@deepseek-ai/dsh-sci-tier`.
 */
const TIER_UPGRADE_SUGGESTED: string = 'sci/tier-upgrade-suggested'

/** The optional columns an audit draft may fill. */
interface AuditDraft {
  /** What the row records. */
  readonly kind: AuditKind
  /** Who acted; the projecting session itself when absent. */
  readonly actor?: AuditActor
  /** Tool the row is about; an explicit `undefined` leaves the column unfilled. */
  readonly toolName?: string | undefined
  /** Path, slug, or identity the row is about; an explicit `undefined` leaves the column unfilled. */
  readonly target?: string | undefined
  /** Stable machine-readable classifier; an explicit `undefined` leaves the column unfilled. */
  readonly rule?: string | undefined
  /** Human-readable detail; an explicit `undefined` leaves the column unfilled. */
  readonly reason?: string | undefined
  /** Digest the source event carried; an explicit `undefined` leaves the column unfilled. */
  readonly sha256?: string | undefined
}

const OPTIONAL_COLUMNS = ['toolName', 'target', 'rule', 'reason', 'sha256'] as const

/**
 * Key of one `sci_audit` row.
 *
 * The log coordinate, not a generated id: seq is stable across replay, so a
 * cold rebuild of the same log overwrites exactly the rows the live projection
 * wrote instead of appending duplicates.
 * @param sessionId - session whose log produced the row.
 * @param seq - seq of the source event within that log.
 * @returns the table key.
 */
export function auditKey(sessionId: SessionId, seq: number): string {
  return `${sessionId}#${seq}`
}

/**
 * Read one structural string field of an event payload whose owning package
 * has not landed yet.
 * @param data - the raw payload.
 * @param field - field name to read.
 * @returns the non-empty string value, or `undefined` when the field is absent, empty, or not a string.
 */
function text(data: unknown, field: string): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value: unknown = (data as Record<string, unknown>)[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Build one `sci_audit` row from an event and the columns it fills.
 * @param sessionId - session whose log produced the row.
 * @param event - the source event, supplying the row's coordinate and time.
 * @param draft - the audited kind and whichever optional columns apply.
 * @returns the tagged row, with unfilled optional columns absent rather than `undefined`.
 */
function auditRow(sessionId: SessionId, event: SessionEvent, draft: AuditDraft): ProjectedRow {
  const record: Record<string, unknown> = {
    sessionId,
    seq: event.seq,
    ts: event.time,
    kind: draft.kind,
    actor: draft.actor ?? MAIN_ACTOR,
  }
  for (const column of OPTIONAL_COLUMNS) {
    const value = draft[column]
    // An empty string is "no value": the read-side schema requires every
    // present optional column to be non-empty, and a malformed model stream
    // once produced a tool call with `name: ''` and a result targeting callId
    // `''` — one such row refused the whole profile at the next boot.
    if (value !== undefined && value !== '') record[column] = value
  }
  return { table: AUDIT_TABLE, key: auditKey(sessionId, event.seq), value: record as unknown as AuditRecord }
}

/**
 * Project the `sci/*` types whose owning packages have not landed yet.
 * @param sessionId - session whose log produced the rows.
 * @param event - the source event.
 * @returns the rows, or `undefined` when the event is not one of these types.
 */
function projectPending(sessionId: SessionId, event: SessionEvent): ProjectedRow[] | undefined {
  const data: unknown = event.data
  if (event.type === AUTHORIZED) {
    return [auditRow(sessionId, event, {
      kind: text(data, 'decision') === 'approved' ? 'authorized' : 'authorization-denied',
      rule: text(data, 'category'),
      reason: text(data, 'command'),
      sha256: text(data, 'sha256'),
    })]
  }
  if (event.type === TOOL_DENIED) {
    return [auditRow(sessionId, event, {
      kind: 'tool-denied',
      toolName: text(data, 'toolName'),
      rule: text(data, 'rule'),
      reason: text(data, 'reason'),
    })]
  }
  if (event.type === TIER_RESOLVED) {
    return [auditRow(sessionId, event, {
      kind: 'tier-resolved',
      rule: text(data, 'tier'),
      reason: text(data, 'presetName'),
    })]
  }
  if (event.type === TIER_UPGRADE_SUGGESTED) {
    return [auditRow(sessionId, event, { kind: 'tier-upgrade-suggested', reason: text(data, 'reason') })]
  }
  return undefined
}

/**
 * Project one session-log event into the rows it contributes.
 *
 * Pure and total: an event type outside the audited vocabulary contributes no
 * rows. The `sci_plan` row a plan declaration produces carries no
 * `workflowRunId` — correlating a run with the plan that authorized it needs
 * the events between them, which is {@link AuditFold}'s job.
 * @param event - one raw session-log event.
 * @param sessionId - the session the event belongs to; the log envelope does not carry it.
 * @returns the rows to write, in commit order; empty for an unaudited event.
 */
export function project(event: SessionEvent, sessionId: SessionId): ProjectedRow[] {
  switch (event.type) {
    case 'tool/call':
      return [auditRow(sessionId, event, { kind: 'tool-call', toolName: event.data.name })]
    case 'tool/result':
      return [auditRow(sessionId, event, {
        kind: 'tool-result',
        target: event.data.message.source.callId,
        ...event.data.error === undefined ? {} : { rule: event.data.error.code, reason: event.data.error.name },
      })]
    case 'tool-workflow/run-start':
      return [auditRow(sessionId, event, {
        kind: 'workflow-run-start',
        actor: `workflow:${event.data.runId}`,
        target: event.data.runId,
        reason: event.data.name,
      })]
    case 'tool-workflow/agent-start':
      return [auditRow(sessionId, event, {
        kind: 'workflow-agent-start',
        actor: `workflow:${event.data.runId}/${event.data.label}`,
        target: event.data.childId,
      })]
    case 'tool-workflow/agent-end':
      return [auditRow(sessionId, event, {
        kind: 'workflow-agent-end',
        actor: `workflow:${event.data.runId}/#${event.data.seq}`,
        rule: event.data.outcome,
      })]
    case 'tool-workflow/run-end':
      return [auditRow(sessionId, event, {
        kind: 'workflow-run-end',
        actor: `workflow:${event.data.runId}`,
        target: event.data.runId,
        rule: event.data.stopReason,
      })]
    case 'turn/end':
      return [auditRow(sessionId, event, {
        kind: 'turn-end',
        target: String(event.data.turn),
        rule: event.data.reason.kind,
      })]
    case 'request/context':
      return [auditRow(sessionId, event, {
        kind: 'request-context',
        rule: event.data.provider,
        reason: event.data.model,
      })]
    case 'approval/decided':
      return [auditRow(sessionId, event, {
        kind: 'approval-decided',
        target: event.data.id,
        rule: event.data.outcome,
      })]
    case 'sci/fs-denied':
      return [auditRow(sessionId, event, {
        kind: 'fs-denied',
        target: event.data.path,
        rule: `${event.data.op}:${event.data.rule}`,
        reason: event.data.reason,
      })]
    case 'sci/delivered':
      return [
        auditRow(sessionId, event, {
          kind: 'delivered',
          target: event.data.path,
          rule: event.data.kind,
          reason: event.data.title,
          sha256: event.data.sha256,
        }),
        {
          table: DELIVERY_TABLE,
          key: event.data.deliveryId,
          value: {
            deliveryId: event.data.deliveryId,
            sessionId,
            path: event.data.path,
            sha256: event.data.sha256,
            kind: event.data.kind,
            title: event.data.title,
            ...event.data.description === undefined ? {} : { description: event.data.description },
            ts: event.time,
          },
        },
      ]
    case 'sci/delivery-failed':
      return [auditRow(sessionId, event, {
        kind: 'delivery-failed',
        target: event.data.path,
        rule: event.data.via,
        reason: event.data.reason,
      })]
    case 'sci/plan-declared':
      return [
        auditRow(sessionId, event, { kind: 'plan-declared', target: event.data.planId }),
        {
          table: PLAN_TABLE,
          key: event.data.planId,
          value: {
            planId: event.data.planId,
            sessionId,
            agentsJson: JSON.stringify(event.data.agents),
            edgesJson: JSON.stringify(event.data.edges),
            declaredAgents: event.data.agents.length,
            spawnedAgents: 0,
            spawnedPersonasJson: '[]',
            reconciled: reconcile(event.data.agents.length, 0),
            ts: event.time,
          },
        },
      ]
    case 'sci/memory-written':
      return [auditRow(sessionId, event, { kind: 'memory-written', target: event.data.slug })]
    case 'sci/skills-synced':
      return [auditRow(sessionId, event, {
        kind: 'skills-synced',
        reason: `${event.data.changed.length} written, ${event.data.removed.length} removed`,
      })]
    // `SessionEventMap` is merge-extensible, so the default is reached by every
    // unaudited type and by the three sci types whose packages have not landed.
    default:
      return projectPending(sessionId, event) ?? []
  }
}

/**
 * Declared count against started count.
 * @param declared - agents the declaration named.
 * @param spawned - agents the fan-outs after it started.
 * @returns the reconciliation state.
 */
function reconcile(declared: number, spawned: number): PlanReconciliation {
  if (spawned < declared) return 'fewer'
  return spawned === declared ? 'match' : 'more'
}

/**
 * The persona one event starts an agent as, or `undefined` when the event
 * starts none. A `subagent_<persona>` tool call names its persona in the tool
 * name (`@deepseek-ai/dsh-sci-tier` derives that name once); a workflow agent
 * start carries only its label, so it is recorded as `workflow:<label>`.
 * @param event - one session-log event.
 * @returns the started persona, or `undefined`.
 */
function startedPersona(event: SessionEvent): string | undefined {
  if (event.type === 'tool/call' && event.data.name.startsWith(SUBAGENT_TOOL_PREFIX)) {
    return event.data.name.slice(SUBAGENT_TOOL_PREFIX.length)
  }
  if (event.type === 'tool-workflow/agent-start') return `workflow:${event.data.label}`
  return undefined
}

/**
 * The stateful part of the projection: everything {@link project} cannot decide
 * from one event alone.
 *
 * Two relations. A workflow run belongs to the plan declared before it, and
 * `tool-workflow/run-start` names only the run, so the fold attaches the run
 * id to the open declaration's row — once: a second run after the same
 * declaration is left unattributed. And the agents a fan-out actually starts
 * belong to that same declaration: every `subagent_<persona>` call and every
 * workflow agent start after it, until the next declaration, re-emits the
 * plan's row with its started count, its started personas, and the
 * reconciliation of the two counts. The studied platform never compared its
 * plan card with the swarm the script ran
 * (`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §2.2, §5 row 8); the row is where
 * that comparison lives. One instance per session; a fresh instance replaying a
 * whole log produces the same rows the live instance wrote.
 */
export class AuditFold {
  /** The most recent plan declaration, which later starts are counted against. */
  private openPlan: (ProjectedRow & { table: 'sci_plan' }) | undefined
  /** Whether a workflow run already claimed the open declaration. */
  private runClaimed = false
  /** The personas the open declaration's fan-outs started, in start order. */
  private spawned: string[] = []

  /**
   * @param sessionId - the session whose log this fold projects.
   */
  constructor(private readonly sessionId: SessionId) {}

  /**
   * Project one event, including the rows that depend on earlier events.
   * @param event - the next event of this fold's session, in log order.
   * @returns the rows to write, in commit order.
   */
  step(event: SessionEvent): ProjectedRow[] {
    const rows = project(event, this.sessionId)
    for (const row of rows) {
      if (row.table !== PLAN_TABLE) continue
      this.openPlan = row
      this.runClaimed = false
      this.spawned = []
    }
    const open = this.openPlan
    if (open === undefined) return rows
    if (event.type === 'tool-workflow/run-start') {
      if (this.runClaimed) return rows
      this.runClaimed = true
      this.openPlan = { ...open, value: { ...open.value, workflowRunId: event.data.runId } }
      return [...rows, this.openPlan]
    }
    const persona = startedPersona(event)
    if (persona === undefined) return rows
    this.spawned.push(persona)
    const declared = open.value.declaredAgents ?? 0
    this.openPlan = {
      ...open,
      value: {
        ...open.value,
        spawnedAgents: this.spawned.length,
        spawnedPersonasJson: JSON.stringify(this.spawned),
        reconciled: reconcile(declared, this.spawned.length),
      },
    }
    return [...rows, this.openPlan]
  }
}

/**
 * The settled `sci_plan` record of every declaration in one log: the last row
 * the fold emitted for each plan id.
 * @param sessionId - the session the events belong to.
 * @param events - the session's raw log, in ascending seq order.
 * @returns each declaration's settled record, in declaration order.
 */
export function planRecords(sessionId: SessionId, events: readonly SessionEvent[]): PlanRecord[] {
  const fold = new AuditFold(sessionId)
  const latest = new Map<string, PlanRecord>()
  for (const event of events) {
    for (const row of fold.step(event)) {
      if (row.table === PLAN_TABLE) latest.set(row.key, row.value)
    }
  }
  return [...latest.values()]
}

/**
 * Project one session's whole log.
 *
 * This is what `rebuild` replays and what a test compares the live projection
 * against; the live path drives the same {@link AuditFold} one event at a time.
 * @param sessionId - the session the events belong to.
 * @param events - that session's raw log, in ascending seq order.
 * @returns every row the log contributes, in commit order.
 */
export function projectLog(sessionId: SessionId, events: readonly SessionEvent[]): ProjectedRow[] {
  const fold = new AuditFold(sessionId)
  return events.flatMap(event => fold.step(event))
}
