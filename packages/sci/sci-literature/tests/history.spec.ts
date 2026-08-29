// Row identity, the optional-column filter, and retention.
import { describe, expect, it } from 'vitest'
import {
  HISTORY_TABLE,
  expiredHistoryIds,
  formatSourceErrors,
  historyId,
  historyRow,
  literatureHistoryEntrySchema,
  sciLiteratureDomainSpec,
  sortHistory,
} from '@deepseek-ai/dsh-sci-literature'
import type { LiteratureHistoryEntry } from '@deepseek-ai/dsh-sci-literature'

/**
 * Build one stored row.
 * @param query - the query the row records.
 * @param at - the epoch milliseconds the search completed.
 * @returns the row.
 */
function entry(query: string, at: number): LiteratureHistoryEntry {
  return { id: historyId(query), query, at, hits: 3 }
}

describe('historyId', () => {
  it('keys one query stably', () => {
    expect(historyId('n-type SnSe')).toMatch(/^[0-9a-f]{40}$/)
    expect(historyId('n-type SnSe')).toBe(historyId('n-type SnSe'))
  })

  it('folds case and repeated whitespace, so a re-search moves the chip instead of adding one', () => {
    expect(historyId('  N-type   SnSe ')).toBe(historyId('n-type snse'))
  })

  it('keys different queries differently', () => {
    expect(historyId('a')).not.toBe(historyId('b'))
  })
})

describe('formatSourceErrors', () => {
  it('joins each source with its code', () => {
    expect(formatSourceErrors([
      { source: 'semanticscholar', code: 'LITERATURE_SOURCE_HTTP', message: 'x' },
      { source: 'arxiv', code: 'LITERATURE_ABORTED', message: 'y' },
    ])).toBe('semanticscholar:LITERATURE_SOURCE_HTTP,arxiv:LITERATURE_ABORTED')
  })

  it('answers undefined when every source answered', () => {
    expect(formatSourceErrors([])).toBeUndefined()
  })
})

describe('historyRow', () => {
  it('leaves an unfilled optional column absent rather than undefined', () => {
    expect(Object.keys(historyRow(entry('a', 1)))).toEqual(['id', 'query', 'at', 'hits'])
  })

  it('drops an empty optional column, which the read-side schema would refuse', () => {
    const row = historyRow({ ...entry('a', 1), sourceErrors: '' })
    expect('sourceErrors' in row).toBe(false)
    expect(() => literatureHistoryEntrySchema.parse({ ...entry('a', 1), sourceErrors: '' })).toThrow()
  })

  it('keeps a filled optional column', () => {
    expect(historyRow({ ...entry('a', 1), sourceErrors: 'arxiv:X' }).sourceErrors).toBe('arxiv:X')
  })
})

describe('sortHistory', () => {
  it('orders newest first', () => {
    expect(sortHistory([entry('a', 1), entry('c', 3), entry('b', 2)]).map(row => row.query))
      .toEqual(['c', 'b', 'a'])
  })

  it('leaves two rows of the same query and time in place', () => {
    const row = entry('a', 1)
    expect(sortHistory([row, row])).toEqual([row, row])
  })

  it('orders equal timestamps by id, so the result is stable', () => {
    const rows = [entry('a', 1), entry('b', 1)]
    expect(sortHistory(rows)).toEqual(sortHistory([...rows].reverse()))
  })
})

describe('expiredHistoryIds', () => {
  it('names the rows beyond the limit, oldest first', () => {
    expect(expiredHistoryIds([entry('a', 1), entry('b', 2), entry('c', 3)], 1))
      .toEqual([historyId('a'), historyId('b')])
  })

  it('names nothing while the table is inside the limit', () => {
    expect(expiredHistoryIds([entry('a', 1)], 50)).toEqual([])
  })
})

describe('sciLiteratureDomainSpec', () => {
  it('declares the history table under the literature domain', () => {
    expect(sciLiteratureDomainSpec.name).toBe('sci_literature')
    expect(Object.keys(sciLiteratureDomainSpec.tables)).toEqual([HISTORY_TABLE])
    expect(HISTORY_TABLE).toBe('sci_literature_history')
  })

  it('accepts a stored row', () => {
    expect(literatureHistoryEntrySchema.parse(entry('a', 1))).toEqual(entry('a', 1))
  })
})
