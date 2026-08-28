/**
 * Package-owned lifecycle invariant for `@deepseek-ai/dsh-sci-skills`.
 *
 * The relationship this asserts, over the authoritative `sci_skill_lifecycle`
 * projection as it changes: a pinned skill is never demoted. Pinning is the
 * operator's exemption from ageing, so a pinned row reaching `stale` or
 * `archived` would silently shrink or drop a skill the deployment declared it
 * always wants listed — a model-visible defect in the one surface this package
 * owns. `domain/changed` carries the committed rows, so the check runs on
 * mutable data at its commit point rather than on registration presence.
 * @module @deepseek-ai/dsh-sci-skills/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { LIFECYCLE_TABLE, sciSkillsDomainSpec } from './spec.ts'
import type { SkillLifecycleRecord } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sci-skills'

/** Cordis companion plugin name. */
export const name = 'sci-skills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Assert the pin exemption for one committed lifecycle write.
 * @param change - the committed domain change.
 * @param fail - the package-attributed invariant reporter.
 */
export function validateChange(change: DomainChanged, fail: InvariantFailure): void {
  if (change.domain !== sciSkillsDomainSpec.name || change.table !== LIFECYCLE_TABLE) return
  if (change.operation !== 'put') return
  const record = change.value as SkillLifecycleRecord
  if (record.pinned && record.state !== 'active') {
    fail(`pinned skill ${JSON.stringify(record.skillName)} was projected as ${JSON.stringify(record.state)}; pinning exempts a skill from every demotion`)
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
