/**
 * Package-owned invariant for `@deepseek-ai/dsh-sci-literature`.
 *
 * The relationship this asserts, over the `sci_literature_history` table as it
 * changes: a row's `hits` never exceeds the merged total that produced it, and
 * its `id` is always the digest of its own `query`. The id is what the browser
 * view's `forget` call spends, and it is derived rather than minted, so a row
 * whose key stopped matching its query would leave a chip the user cannot
 * remove — the delete would silently hit nothing. `domain/changed` carries the
 * committed row, so the check runs on mutable data at its commit point rather
 * than on registration presence.
 * @module @deepseek-ai/dsh-sci-literature/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { historyId } from './history.ts'
import { HISTORY_TABLE, sciLiteratureDomainSpec } from './spec.ts'
import type { LiteratureHistoryEntry } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-literature'

/** Cordis companion plugin name. */
export const name = 'sci-literature-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert that one committed history row is keyed by its own query.
 * @param change - the committed domain change.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== sciLiteratureDomainSpec.name || change.table !== HISTORY_TABLE) return
  if (change.operation !== 'put') return
  const record = change.value as LiteratureHistoryEntry
  const expected = historyId(record.query)
  if (record.id !== expected) {
    fail(`literature history row for ${JSON.stringify(record.query)} was stored under ${record.id}, which no forget call can name (expected ${expected})`)
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
