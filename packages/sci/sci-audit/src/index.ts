/**
 * Session-log audit projection, on-demand session summary, and cold rebuild for
 * the science-research agent profile.
 *
 * The studied platform designed a 74-table operational schema whose
 * `audit_events` table was never written
 * ([04-persistence-model.md](../../../../ClawsGO-System/09-Target-Architecture/04-persistence-model.md)).
 * Here the append-only session log is the only source of truth and the tables
 * are projections of it: this service folds the log forward as it is written and
 * `rebuild` replays it cold into the same rows, so a schema change is a
 * truncate-and-replay rather than a migration.
 *
 * The service owns three contributions, all effects of the mounting fiber:
 *
 * - A `session/event` observer that folds every audited record of every live
 *   session into `sci_audit`, `sci_delivery`, and `sci_plan`.
 * - The `/audit-rebuild` human command, which truncates those three tables for
 *   the named sessions and re-projects them from the session-query corpus.
 * - {@link SciAuditService.summarize}, computed when a caller asks. There is no
 *   session-end trigger because this harness has no `session/end` event
 *   ([02-w0-adversary-resolution.md](../../../../ClawsGO-System/10-Implementation-Plan/02-w0-adversary-resolution.md),
 *   M2).
 *
 * Only the session log is read (M6): `tools/post-execute`, `workflow/end`, and
 * the other Cordis-only events never reach a projection, because a row folded
 * from them could not be reproduced by a cold replay.
 *
 * The three remaining tables of the persistence model belong to other packages:
 * `sci_skill_usage` and `sci_skill_lifecycle` to `@deepseek-ai/dsh-sci-skills`,
 * `sci_memory_index` to `@deepseek-ai/dsh-sci-memory`. This package reads the
 * memory index through `ctx.sciMemory` for one summary figure and writes none
 * of them.
 * @module @deepseek-ai/dsh-sci-audit
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: merges the services this plugin injects or optionally reads onto Context.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-sci-memory'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { AuditFold, projectLog } from './project.ts'
import { AUDIT_TABLE, DELIVERY_TABLE, PLAN_TABLE, sciAuditDomainSpec } from './spec.ts'
import { summarizeSession } from './summarize.ts'
import type { AuditRecord, AuditSummary, DeliveryRecord, PlanRecord, ProjectedRow, RebuildReport } from './types.ts'

export type * from './types.ts'
export { AuditFold, MAIN_ACTOR, auditKey, project, projectLog } from './project.ts'
export {
  AUDIT_KINDS,
  AUDIT_TABLE,
  DELIVERY_TABLE,
  PLAN_TABLE,
  auditKindSchema,
  auditRecordSchema,
  deliveryRecordSchema,
  planRecordSchema,
  sciAuditDomainSpec,
} from './spec.ts'
export { citationMissing, summarizeSession } from './summarize.ts'
export type { SummaryInput } from './summarize.ts'

/** Cordis service key this package publishes itself under. */
export const SERVICE_KEY = 'sciAudit'

/** Registered name of the human command that re-projects the owned tables. */
export const REBUILD_COMMAND = 'audit-rebuild'

/** Deployment-varying choices of the science-research audit projection. */
export interface Config {
  /**
   * Registered names of the tools that consult the web, used by the
   * citation-missing figure of a summary. Tool registration is a composition
   * choice — a deployment may rename or replace `web_search` / `web_fetch` —
   * so the names cannot be fixed in this package.
   */
  webToolNames: string[]
}

/** Registered names of the web tools `@deepseek-ai/dsh-tool-web` composes by default. */
const DEFAULT_WEB_TOOL_NAMES = ['web_search', 'web_fetch']

/** Schemastery schema for the science-research audit projection. */
export const Config: z<Config> = z.object({
  webToolNames: z.array(z.string()).default(DEFAULT_WEB_TOOL_NAMES),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciAudit: SciAuditService
  }
}

/** Fail loudly if the locally closed row union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown projected table: ${String(value)}`)
}
/* v8 ignore stop */

/**
 * The audit projection, its cold rebuild, and the per-session summary.
 *
 * The service reads the session log and writes only its own three tables; it
 * never creates, resumes, or drives an Agent or Session.
 */
export class SciAuditService extends Service {
  static inject = ['commands', 'sessionQuery', 'storageDomain']

  /** Loader validation for the audit projection's deployment policy. */
  static Config: z<Config> = Config

  private readonly webToolNames: readonly string[]
  /** One fold per session seen live, so the live path replays a log exactly as {@link projectLog} does. */
  private readonly folds = new Map<SessionId, AuditFold>()
  /**
   * Tail of the single write chain. `session/event` is synchronous, so two
   * events in one tick would otherwise both read the table and the second write
   * would drop the first; a rebuild joins the same chain so it cannot interleave
   * with a live commit on the session it is truncating.
   */
  private chain: Promise<unknown> = Promise.resolve()
  /** Assigned by `Service.init` before Cordis publishes the service or attaches its listeners. */
  private audit!: KvTable<string, AuditRecord>
  /** Assigned by `Service.init` before Cordis publishes the service or attaches its listeners. */
  private delivery!: KvTable<string, DeliveryRecord>
  /** Assigned by `Service.init` before Cordis publishes the service or attaches its listeners. */
  private plan!: KvTable<string, PlanRecord>

  /**
   * @param ctx - Host context carrying the command registry, session query, and storage-domain form.
   * @param config - the resolved deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, SERVICE_KEY)
    this.webToolNames = config.webToolNames
  }

  /** Open the projection, attach the log observer, and register the command. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sciAuditDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sci-audit.domainClose')
    this.audit = domain.table(AUDIT_TABLE)
    this.delivery = domain.table(DELIVERY_TABLE)
    this.plan = domain.table(PLAN_TABLE)

    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.observe(session.header.id, event)
    })

    const commands = this.ctx.commands
    const drain = async (): Promise<void> => { await this.chain }
    const handler = (invocation: CommandInvocation): Promise<CommandResult> => this.runRebuildCommand(invocation)
    this.ctx.effect(function* () {
      // Yield drain before registration: composite teardown is LIFO, so no new
      // invocation can enter while an in-flight rebuild finishes writing.
      yield drain
      yield commands.register({
        name: REBUILD_COMMAND,
        description: 'Re-project the audit tables from the session log',
        input: { hint: '[sessionId ...] — every session in the corpus when empty' },
        handler,
      })
    }, 'sci-audit.rebuildCommand')
  }

  /**
   * Truncate the three owned tables for the named sessions and re-project them
   * from their logs.
   *
   * The cold read goes through `sessionQuery`, which is live-preferred, so a
   * session still in memory is replayed from the same events the live fold saw
   * and the two paths produce identical rows. Truncation runs for every session
   * before any re-projection so a `sci_plan` row a later session claimed is not
   * deleted after being rewritten.
   * @param sessionIds - the sessions to re-project, in the order they were requested.
   * @returns how many rows were deleted and written.
   * @throws SessionQueryError when the corpus does not hold one of the ids.
   */
  rebuild(sessionIds: readonly SessionId[]): Promise<RebuildReport> {
    const requested = [...sessionIds]
    return this.serialize(async () => {
      let removed = 0
      for (const sessionId of requested) removed += await this.truncate(sessionId)
      let written = 0
      for (const sessionId of requested) {
        const snapshot = await this.ctx.sessionQuery.readSession(sessionId)
        written += await this.commit(projectLog(sessionId, snapshot.events))
      }
      return { sessionIds: requested, removed, written }
    })
  }

  /**
   * Compute one session's audit summary from the committed rows and its log.
   * @param sessionId - the session to summarize.
   * @returns the summary.
   * @throws SessionQueryError when the corpus does not hold the id.
   */
  async summarize(sessionId: SessionId): Promise<AuditSummary> {
    const snapshot = await this.ctx.sessionQuery.readSession(sessionId)
    const memoryRows = (this.ctx.get('sciMemory')?.memoryIndex() ?? [])
      .filter(record => record.originSessionId === sessionId)
    return summarizeSession({
      sessionId,
      auditRows: this.auditRows(sessionId),
      events: snapshot.events,
      memoryRows,
      webToolNames: this.webToolNames,
    })
  }

  /**
   * Snapshot one session's committed `sci_audit` rows in log order.
   * @param sessionId - the session to read.
   * @returns the rows, ascending by the log coordinate they were projected from.
   */
  auditRows(sessionId: SessionId): readonly AuditRecord[] {
    return [...this.audit.entries()]
      .map(([, record]) => record)
      .filter(record => record.sessionId === sessionId)
      .sort((left, right) => left.seq - right.seq)
  }

  /**
   * Snapshot every committed `sci_delivery` row.
   * @returns the rows, in table order.
   */
  deliveryRows(): readonly DeliveryRecord[] {
    return [...this.delivery.entries()].map(([, record]) => record)
  }

  /**
   * Snapshot every committed `sci_plan` row.
   * @returns the rows, in table order.
   */
  planRows(): readonly PlanRecord[] {
    return [...this.plan.entries()].map(([, record]) => record)
  }

  /** Fold one live log record and queue whatever rows it contributes. */
  private observe(sessionId: SessionId, event: SessionEvent): void {
    const rows = this.foldFor(sessionId).step(event)
    if (rows.length === 0) return
    // A commit failure must not take the process down under Node's default
    // `--unhandled-rejections=throw`, and one unprojected event must not stop
    // the session that produced it.
    void this.serialize(() => this.commit(rows)).catch((error: unknown) => {
      this.ctx.logger.warn(`sci-audit could not project ${event.type}: ${String(error)}`)
    })
  }

  /** The fold of one session, created on its first audited record. */
  private foldFor(sessionId: SessionId): AuditFold {
    const existing = this.folds.get(sessionId)
    if (existing !== undefined) return existing
    const created = new AuditFold(sessionId)
    this.folds.set(sessionId, created)
    return created
  }

  /** Append one task to the single write chain, which survives a failed task. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task)
    this.chain = result.catch(() => {})
    return result
  }

  /** Write projected rows in commit order; returns how many landed. */
  private async commit(rows: readonly ProjectedRow[]): Promise<number> {
    for (const row of rows) {
      switch (row.table) {
        case AUDIT_TABLE: await this.audit.put(row.key, row.value); break
        case DELIVERY_TABLE: await this.delivery.put(row.key, row.value); break
        case PLAN_TABLE: await this.plan.put(row.key, row.value); break
        /* v8 ignore next 2 -- ProjectedRow is closed and every table is handled above */
        default: return assertNever(row)
      }
    }
    return rows.length
  }

  /** Delete every owned row of one session; returns how many were removed. */
  private async truncate(sessionId: SessionId): Promise<number> {
    return await removeSession(this.audit, sessionId)
      + await removeSession(this.delivery, sessionId)
      + await removeSession(this.plan, sessionId)
  }

  /**
   * Resolve the requested sessions and re-project them for one command invocation.
   *
   * The requested ids are checked against the corpus before any table is
   * truncated: {@link rebuild} deletes first and reads second, so an id the
   * corpus cannot serve would otherwise leave the tables emptied for it.
   */
  private async runRebuildCommand(invocation: CommandInvocation): Promise<CommandResult> {
    const corpus = await this.ctx.sessionQuery.listSessions(invocation.signal)
    const known = new Set(corpus.map(record => record.header.id))
    const requested = invocation.rawInput.trim()
    const sessionIds = requested === '' ? [...known] : requested.split(/\s+/u).map(id => SessionId(id))
    const missing = sessionIds.filter(sessionId => !known.has(sessionId))
    if (missing.length > 0) {
      return { kind: 'error', text: `No session log is available for ${missing.length} of the ${sessionIds.length} requested sessions; nothing was re-projected.` }
    }
    const report = await this.rebuild(sessionIds)
    return {
      kind: 'success',
      text: `Re-projected ${report.sessionIds.length} session(s): removed ${report.removed} rows, wrote ${report.written}.`,
    }
  }
}

/**
 * Delete every row of one table whose session matches.
 * @param table - the table to truncate.
 * @param sessionId - the session whose rows are removed.
 * @returns how many rows were deleted.
 */
async function removeSession<V extends { readonly sessionId: SessionId }>(
  table: KvTable<string, V>,
  sessionId: SessionId,
): Promise<number> {
  let removed = 0
  for (const [key, record] of [...table.entries()]) {
    if (record.sessionId !== sessionId) continue
    await table.delete(key)
    removed += 1
  }
  return removed
}

export default SciAuditService
