/**
 * Package-owned projection invariant for `@deepseek-ai/dsh-sci-audit`.
 *
 * The relationship this asserts, over the authoritative `sci_audit` projection
 * as it changes: a committed row must name a log coordinate its own session
 * really holds. `sessionId` plus `seq` is the row's key, and both the live fold
 * and the cold rebuild derive it from the event they are projecting, so a row
 * pointing at a `seq` its session never logged — or at a different event's
 * timestamp — means the two paths have diverged and `rebuild` would silently
 * write a different table than the one it replaced.
 *
 * The check runs only while the session store still holds the row's session.
 * `sci-audit rebuild` replays sessions the corpus persisted after they left
 * memory, and those rows have no live log to relate to; asserting that every
 * projected `sessionId` is live would fail on exactly the operation this
 * package exists to perform.
 * @module @deepseek-ai/dsh-sci-audit/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
// Type-only: merges the session store onto Context for the optional read below.
import type {} from '@deepseek-ai/dsh-session'
import { AUDIT_TABLE, sciAuditDomainSpec } from './spec.ts'
import type { AuditRecord } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-audit'

/** Cordis companion plugin name. */
export const name = 'sci-audit-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert that one committed audit row names an event of its own session's log.
 * @param change - the committed domain change.
 * @param sessions - the session store, or `undefined` in a composition without one.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(
  change: DomainChanged,
  sessions: SessionStore | undefined,
  fail: InvariantFailure,
): void {
  if (change.domain !== sciAuditDomainSpec.name || change.table !== AUDIT_TABLE) return
  if (change.operation !== 'put') return
  const record = change.value as AuditRecord
  const session = sessions?.get(record.sessionId)
  if (session === undefined) return
  const source = session.events.find(event => event.seq === record.seq)
  if (source === undefined) {
    fail(`audit row ${JSON.stringify(change.key)} was projected from seq ${record.seq}, which session ${record.sessionId} has never logged`)
    return
  }
  if (source.time !== record.ts) {
    fail(`audit row ${JSON.stringify(change.key)} carries time ${record.ts}, but seq ${record.seq} of session ${record.sessionId} happened at ${source.time}`)
  }
}

/** Install validation on the authoritative domain-change stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change: DomainChanged) => {
    validateChange(change, ctx.get('sessions'), fail)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
