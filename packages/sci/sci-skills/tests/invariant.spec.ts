// The pin exemption, asserted over the authoritative domain-change stream:
// pinning is the operator's promise that a skill stays fully listed, so a
// pinned row committed as stale or archived is a defect in the one
// model-visible surface this package owns.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as SciSkillsInvariant from '@deepseek-ai/dsh-sci-skills/invariant'
import { LIFECYCLE_TABLE, USAGE_TABLE, sciSkillsDomainSpec } from '@deepseek-ai/dsh-sci-skills'
import { validateChange } from '@deepseek-ai/dsh-sci-skills/src/invariant.ts'
import type { SkillLifecycleRecord } from '@deepseek-ai/dsh-sci-skills'

/**
 * Build a lifecycle put change.
 * @param record - the committed row.
 * @returns the change event.
 */
function put(record: SkillLifecycleRecord): DomainChanged {
  return {
    domain: sciSkillsDomainSpec.name,
    table: LIFECYCLE_TABLE,
    key: record.skillName,
    operation: 'put',
    value: record,
  }
}

/**
 * Build a reporter that records instead of throwing, so one call site can
 * assert both the accepting and the rejecting paths.
 * @returns the reporter and the messages it has recorded.
 */
function reporter(): { fail: InvariantFailure; messages: string[] } {
  const messages: string[] = []
  const fail = ((message: string) => { messages.push(message) }) as unknown as InvariantFailure
  return { fail, messages }
}

const pinnedRow: SkillLifecycleRecord = {
  skillName: 'sci-plot',
  state: 'active',
  pinned: true,
  firstSeenAt: 1,
  updatedAt: 1,
}

describe('sci-skills pin-exemption invariant', () => {
  it.each([
    ['an active pinned row', put(pinnedRow)],
    ['an unpinned stale row', put({ ...pinnedRow, pinned: false, state: 'stale' })],
    ['a usage-table write', { ...put(pinnedRow), table: USAGE_TABLE }],
    ['another domain', { ...put(pinnedRow), domain: 'other' }],
    ['a lifecycle deletion', { domain: sciSkillsDomainSpec.name, table: LIFECYCLE_TABLE, key: 'sci-plot', operation: 'deleted' }],
  ])('accepts %s', (_case, change) => {
    const { fail, messages } = reporter()

    validateChange(change as DomainChanged, fail)

    expect(messages).toEqual([])
  })

  it.each([['stale'], ['archived']] as const)('rejects a pinned row committed as %s', (state) => {
    const { fail, messages } = reporter()

    validateChange(put({ ...pinnedRow, state }), fail)

    expect(messages).toEqual([expect.stringContaining(`pinned skill "sci-plot" was projected as "${state}"`)])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciSkillsInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
