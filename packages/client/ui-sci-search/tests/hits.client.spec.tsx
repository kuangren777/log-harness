// @vitest-environment jsdom
/**
 * The `literature_search` tool row: what it draws from a well-formed result
 * meta, and every shape of meta it refuses to draw from. The row is the only
 * consumer of host-computed presentation data in this package, so its
 * validation is the suite's subject.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { LiteratureHits, literatureRecordsOf, type LiteratureHitsProps } from '../src/client/LiteratureHits.tsx'
import { zh } from '../src/client/locales.ts'
import { BARE, FULL } from './records.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** A settled call carrying `meta`, as ui-tool hands one to a keyed row. */
function settled(meta: unknown): ToolCallBlock {
  return { kind: 'tool-result', seq: 4, time: 0, callId: 'c1', call: null, callTime: null,
    content: [], isError: false, meta, callView: null, resultView: null, subCalls: [] } as unknown as ToolCallBlock
}

/** A still-running call, which carries no meta at all. */
function running(): ToolCallBlock {
  return { callId: 'c1', name: 'literature_search', argsRaw: '{}', turn: 1, step: 1, time: 0,
    callView: null, subCalls: [] }
}

/** The row's props over one call. */
function props(block: ToolCallBlock): LiteratureHitsProps {
  return { block, t } as unknown as LiteratureHitsProps
}

describe('literatureRecordsOf', () => {
  it('takes the records of a well-formed literature meta', () => {
    expect(literatureRecordsOf(settled({ kind: 'literature', records: [FULL] }))).toEqual([FULL])
  })

  it('refuses every meta that is not this tool s', () => {
    expect(literatureRecordsOf(running())).toBeNull()
    expect(literatureRecordsOf(settled(undefined))).toBeNull()
    expect(literatureRecordsOf(settled(null))).toBeNull()
    expect(literatureRecordsOf(settled('literature'))).toBeNull()
    expect(literatureRecordsOf(settled({ kind: 'search', records: [FULL] }))).toBeNull()
    expect(literatureRecordsOf(settled({ kind: 'literature', records: 'many' }))).toBeNull()
  })

  it('drops array entries that are not records', () => {
    const meta = { kind: 'literature', records: [
      FULL, null, 'paper', { id: 1 }, { ...FULL, title: 7 }, { ...FULL, url: undefined },
      { ...FULL, source: 'scopus' }, { ...BARE, source: 7 },
    ] }
    expect(literatureRecordsOf(settled(meta))).toEqual([FULL])
  })
})

describe('LiteratureHits', () => {
  it('lists every hit with the facts the record carries', () => {
    render(<LiteratureHits {...props(settled({ kind: 'literature', records: [FULL, BARE] }))} />)

    expect(screen.getByText('文献命中 2 篇')).toBeTruthy()
    const link = screen.getByRole('link', { name: FULL.title })
    expect(link.getAttribute('href')).toBe(FULL.url)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText('被引 187')).toBeTruthy()
    expect(screen.getByText('doi:10.1038/s41586-024-07001-2')).toBeTruthy()
    expect(screen.getByText('OpenAlex')).toBeTruthy()
    expect(screen.getByText('arXiv')).toBeTruthy()
  })

  it('draws no year, citation, or doi for a record that carries none', () => {
    render(<LiteratureHits {...props(settled({ kind: 'literature', records: [BARE] }))} />)

    expect(screen.getByRole('link', { name: BARE.title })).toBeTruthy()
    expect(screen.queryByText(/被引/u)).toBeNull()
    expect(screen.queryByText(/^doi:/u)).toBeNull()
  })

  it('leaves the seat empty for a meta it cannot read, so the generic card renders', () => {
    const { container, rerender } = render(<LiteratureHits {...props(settled({ kind: 'chart' }))} />)
    expect(container.firstChild).toBeNull()

    rerender(<LiteratureHits {...props(settled({ kind: 'literature', records: [] }))} />)
    expect(container.firstChild).toBeNull()
  })
})
