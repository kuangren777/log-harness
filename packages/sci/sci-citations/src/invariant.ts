/**
 * Package-owned invariant for `@deepseek-ai/dsh-sci-citations`.
 *
 * The relationship this asserts, over the `sci_citation` table as it changes:
 * every committed row scoring below {@link QUARANTINE_BELOW} carries
 * `quarantined: true`. The flag is a disjunction of an automatic rule and a
 * person's decision, and only the decided half is anyone's to lower — but four
 * separate paths write the flag (`add` recomputes it, `rescan` recomputes it
 * for bib-only rows, `move` clears it on the way out of the `quarantine` group,
 * and `update` sets it from a patch), so the rule holds only as long as all
 * four keep agreeing. It matters because the flag is what keeps a low-confidence
 * work out of a manuscript: the prompt tells the model not to cite a quarantined
 * entry, `citations_list` marks it, and the view badges it, so a released row
 * scoring 30 would read as vouched-for on all three surfaces at once.
 *
 * The check runs on `domain/changed`, which carries the committed row, so it
 * sees mutable data at its commit point rather than registration presence. The
 * table's own schema cannot express it: the relation spans two columns and a
 * threshold constant.
 * @module @deepseek-ai/dsh-sci-citations/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { QUARANTINE_BELOW } from './config.ts'
import { CITATION_TABLE, sciCitationsDomainSpec } from './spec.ts'
import type { Citation } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-citations'

/** Cordis companion plugin name. */
export const name = 'sci-citations-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert that one committed citation below the threshold is held back.
 * @param change - the committed domain change.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== sciCitationsDomainSpec.name || change.table !== CITATION_TABLE) return
  if (change.operation !== 'put') return
  const citation = change.value as Citation
  if (citation.confidence >= QUARANTINE_BELOW || citation.quarantined) return
  fail(`citation ${citation.id} scores ${citation.confidence}, below the quarantine threshold of ${QUARANTINE_BELOW}, but is not quarantined`)
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
