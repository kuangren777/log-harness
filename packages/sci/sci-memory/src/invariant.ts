/**
 * Package-owned projection invariant for `@deepseek-ai/dsh-sci-memory`.
 *
 * The relationship this asserts, over the authoritative `sci_memory_index`
 * projection as it changes: a row's `turnsTotal` never falls below its
 * `writtenAtTurn`. A memory node cannot have been written in a turn its own
 * session never reached, and `memoryTimingScore` divides one by the other, so
 * an inverted row would silently produce a score outside `[0, 1]` instead of
 * failing anything. `domain/changed` carries the committed rows, so the check
 * runs on mutable data at its commit point rather than on registration presence.
 * @module @deepseek-ai/dsh-sci-memory/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { MEMORY_INDEX_TABLE, sciMemoryDomainSpec } from './spec.ts'
import type { MemoryIndexRecord } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-memory'

/** Cordis companion plugin name. */
export const name = 'sci-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the turn ordering of one committed memory-index write.
 * @param change - the committed domain change.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== sciMemoryDomainSpec.name || change.table !== MEMORY_INDEX_TABLE) return
  if (change.operation !== 'put') return
  const record = change.value as MemoryIndexRecord
  if (record.turnsTotal < record.writtenAtTurn) {
    fail(`memory node ${JSON.stringify(record.slug)} was projected as written in turn ${record.writtenAtTurn} of a session that reached only ${record.turnsTotal}`)
  }
}

/** Install validation on the authoritative domain-change stream. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change: DomainChanged) => { validateChange(change, fail) }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
