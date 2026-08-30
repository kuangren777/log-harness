// The quarantine-floor invariant, asserted over the authoritative domain-change
// stream: four separate paths write the flag, and a row released below the
// threshold would read as vouched-for in the prompt, the tool output, and the
// view at once.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { QUARANTINE_BELOW } from '../src/config.ts'
import * as SciCitationsInvariant from '../src/invariant.ts'
import { validateChange } from '../src/invariant.ts'
import { CITATION_GROUP_TABLE, CITATION_TABLE, sciCitationsDomainSpec } from '../src/spec.ts'
import type { Citation } from '../src/types.ts'
import { citation } from './fixtures.ts'

/**
 * Build a citation put change.
 * @param row - the committed row.
 * @returns the change event.
 */
function put(row: Citation): DomainChanged {
  return {
    domain: sciCitationsDomainSpec.name,
    table: CITATION_TABLE,
    key: row.id,
    operation: 'put',
    value: row,
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

const RELEASED_WEAK = put(citation({ confidence: QUARANTINE_BELOW - 1, quarantined: false }))

describe('sci-citations quarantine-floor invariant', () => {
  it.each([
    ['a strong row nobody held back', put(citation({ confidence: 90, quarantined: false }))],
    ['a strong row somebody held back by hand', put(citation({ confidence: 90, quarantined: true }))],
    ['a weak row that is held back', put(citation({ confidence: 30, quarantined: true }))],
    ['a row exactly at the threshold', put(citation({ confidence: QUARANTINE_BELOW, quarantined: false }))],
    ['a write to the group table', { ...RELEASED_WEAK, table: CITATION_GROUP_TABLE }],
    ['a write to another domain', { ...RELEASED_WEAK, domain: 'sci_library' }],
    ['a deletion', { ...RELEASED_WEAK, operation: 'deleted', value: undefined }],
  ])('accepts %s', (_case, change) => {
    const { fail, messages } = reporter()

    validateChange(change as DomainChanged, fail)

    expect(messages).toEqual([])
  })

  it('rejects a row released below the threshold', () => {
    const { fail, messages } = reporter()

    validateChange(RELEASED_WEAK, fail)

    expect(messages).toEqual([expect.stringContaining('but is not quarantined')])
    expect(messages[0]).toContain(String(QUARANTINE_BELOW))
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciCitationsInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
