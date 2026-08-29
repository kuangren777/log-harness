// The history-key invariant, asserted over the authoritative domain-change
// stream: a row the browser view cannot forget is a row that should never have
// been committed.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as SciLiteratureInvariant from '@deepseek-ai/dsh-sci-literature/invariant'
import { HISTORY_TABLE, historyId, sciLiteratureDomainSpec } from '@deepseek-ai/dsh-sci-literature'
import { validateChange } from '@deepseek-ai/dsh-sci-literature/src/invariant.ts'
import type { LiteratureHistoryEntry } from '@deepseek-ai/dsh-sci-literature'

const ROW: LiteratureHistoryEntry = {
  id: historyId('n-type SnSe thermoelectric'),
  query: 'n-type SnSe thermoelectric',
  at: 1_800_000_000_000,
  hits: 18,
}

/**
 * Build a history put change.
 * @param record - the committed row.
 * @returns the change event.
 */
function put(record: LiteratureHistoryEntry): DomainChanged {
  return {
    domain: sciLiteratureDomainSpec.name,
    table: HISTORY_TABLE,
    key: record.id,
    operation: 'put',
    value: record,
  }
}

/**
 * Build a reporter that records instead of throwing.
 * @returns the reporter and the messages it has recorded.
 */
function reporter(): { fail: InvariantFailure; messages: string[] } {
  const messages: string[] = []
  const fail = ((message: string) => { messages.push(message) }) as unknown as InvariantFailure
  return { fail, messages }
}

describe('sci-literature history-key invariant', () => {
  it.each([
    ['a row keyed by its own query', put(ROW)],
    ['a row whose query differs only in case and spacing', put({ ...ROW, query: '  N-type   SnSe   thermoelectric ' })],
    ['a write to another table', { ...put(ROW), table: 'sci_skill_usage' }],
    ['a write to another domain', { ...put(ROW), domain: 'sci_skills' }],
    ['a deletion', { domain: sciLiteratureDomainSpec.name, table: HISTORY_TABLE, key: ROW.id, operation: 'deleted' }],
  ])('accepts %s', (_case, change) => {
    const { fail, messages } = reporter()

    validateChange(change as DomainChanged, fail)

    expect(messages).toEqual([])
  })

  it('rejects a row stored under a key its query does not derive', () => {
    const { fail, messages } = reporter()

    validateChange(put({ ...ROW, id: 'hand-minted' }), fail)

    expect(messages).toEqual([expect.stringContaining(
      'literature history row for "n-type SnSe thermoelectric" was stored under hand-minted',
    )])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciLiteratureInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
