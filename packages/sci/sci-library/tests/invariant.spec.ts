// The file-containment invariant, asserted over the authoritative domain-change
// stream: three surfaces resolve a stored file's path independently, so a row
// whose file left its own directory is a row that should never have committed.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as SciLibraryInvariant from '../src/invariant.ts'
import { validateChange } from '../src/invariant.ts'
import { ENTRY_TABLE, sciLibraryDomainSpec } from '../src/spec.ts'
import type { LibraryEntry } from '../src/types.ts'
import { entry, file } from './fixtures.ts'

const ROW = entry({ files: [file()] })

/**
 * Build an entry put change.
 * @param record - the committed row.
 * @returns the change event.
 */
function put(record: LibraryEntry): DomainChanged {
  return {
    domain: sciLibraryDomainSpec.name,
    table: ENTRY_TABLE,
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

describe('sci-library file-containment invariant', () => {
  it.each([
    ['a row whose file is under its own directory', put(ROW)],
    ['a row with no files at all', put(entry())],
    ['a write to another table', { ...put(ROW), table: 'sci_literature_history' }],
    ['a write to another domain', { ...put(ROW), domain: 'sci_literature' }],
    ['a deletion', { domain: sciLibraryDomainSpec.name, table: ENTRY_TABLE, key: ROW.id, operation: 'deleted' }],
  ])('accepts %s', (_case, change) => {
    const { fail, messages } = reporter()

    validateChange(change as DomainChanged, fail)

    expect(messages).toEqual([])
  })

  it('rejects a file path that escaped the entry directory', () => {
    const { fail, messages } = reporter()

    validateChange(put(entry({ files: [file({ path: '../other/paper.pdf' })] })), fail)

    expect(messages).toEqual([expect.stringContaining('is not under its own directory')])
  })

  it('rejects a file stored under a directory that is not this entry’s', () => {
    const { fail, messages } = reporter()

    validateChange(put(entry({ id: 'note:1', files: [file()] })), fail)

    expect(messages).toEqual([expect.stringContaining('expected note-1/paper.pdf')])
  })

  it('registers the companion against the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(SciLibraryInvariant)).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
