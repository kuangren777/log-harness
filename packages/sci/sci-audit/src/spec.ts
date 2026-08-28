/**
 * Durable storage-domain declaration for the three audit projections this
 * package owns.
 *
 * All three are projections of the session log, never a second source of
 * truth: every row folds from one logged event, keyed by the log coordinate or
 * the identity that event carries, so dropping the medium and replaying
 * rebuilds them exactly. `sci audit rebuild` is that replay.
 *
 * The other three tables of the persistence model are NOT declared here:
 * `sci_skill_usage` and `sci_skill_lifecycle` belong to
 * `@deepseek-ai/dsh-sci-skills` and `sci_memory_index` belongs to
 * `@deepseek-ai/dsh-sci-memory`. This package only reads them, through those
 * packages' own services, to compute a summary.
 * @module @deepseek-ai/dsh-sci-audit/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AuditKind, AuditRecord, DeliveryRecord, PlanRecord } from './types.ts'

const epochMillis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sessionId = z.string().min(1).transform(value => value as SessionId)
const nonEmpty = z.string().min(1)

/** Every audited kind, in the order the vocabulary is documented. */
export const AUDIT_KINDS: readonly AuditKind[] = [
  'tool-call',
  'tool-result',
  'tool-denied',
  'fs-denied',
  'delivered',
  'delivery-failed',
  'authorized',
  'authorization-denied',
  'approval-decided',
  'plan-declared',
  'tier-resolved',
  'tier-upgrade-suggested',
  'memory-written',
  'skills-synced',
  'workflow-run-start',
  'workflow-agent-start',
  'workflow-agent-end',
  'workflow-run-end',
  'turn-end',
  'request-context',
]

/** Runtime schema for the closed audit vocabulary. */
// The literal tuple is derived from AUDIT_KINDS so the vocabulary has one home;
// `satisfies` proves the derivation still covers the type.
export const auditKindSchema = z.enum(
  AUDIT_KINDS as unknown as [AuditKind, ...AuditKind[]],
) as unknown as z.ZodType<AuditKind>

/** Runtime schema for one `sci_audit` row. */
export const auditRecordSchema = z.object({
  sessionId,
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ts: epochMillis,
  kind: auditKindSchema,
  actor: nonEmpty,
  toolName: nonEmpty.optional(),
  target: nonEmpty.optional(),
  rule: nonEmpty.optional(),
  reason: nonEmpty.optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
}) as unknown as z.ZodType<AuditRecord>

/** Runtime schema for one `sci_delivery` row. */
export const deliveryRecordSchema = z.object({
  deliveryId: nonEmpty,
  sessionId,
  path: nonEmpty,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  kind: nonEmpty,
  title: nonEmpty,
  description: nonEmpty.optional(),
  ts: epochMillis,
}) as unknown as z.ZodType<DeliveryRecord>

/** Runtime schema for one `sci_plan` row. */
export const planRecordSchema = z.object({
  planId: nonEmpty,
  sessionId,
  agentsJson: nonEmpty,
  edgesJson: nonEmpty,
  workflowRunId: nonEmpty.optional(),
  ts: epochMillis,
}) as unknown as z.ZodType<PlanRecord>

/** Table name of the audit projection, matching the persistence model. */
export const AUDIT_TABLE = 'sci_audit'

/** Table name of the delivery projection, matching the persistence model. */
export const DELIVERY_TABLE = 'sci_delivery'

/** Table name of the plan projection, matching the persistence model. */
export const PLAN_TABLE = 'sci_plan'

/** The three audit projections this package owns and rebuilds. */
export const sciAuditDomainSpec = defineDomain({
  name: 'sci_audit',
  version: 0,
  tables: {
    [AUDIT_TABLE]: domainTable<string, AuditRecord>(auditRecordSchema),
    [DELIVERY_TABLE]: domainTable<string, DeliveryRecord>(deliveryRecordSchema),
    [PLAN_TABLE]: domainTable<string, PlanRecord>(planRecordSchema),
  },
})
