// @vitest-environment jsdom
/**
 * The `citations_list` and `citations_add` tool rows: what they draw from a
 * well-formed result meta, and every shape of meta they refuse to draw from.
 * These rows are the only consumers of host-computed presentation data in
 * this package, so their validation is the suite's subject.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { CitationAdded, type CitationAddedProps } from '../src/client/CitationAdded.tsx'
import { CitationsTable, type CitationsTableProps } from '../src/client/CitationsTable.tsx'
import { addedCitationOf, citationRowsOf, metaGroupLabel } from '../src/client/tool-meta.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

/** A well-formed listing row carrying every optional field. */
const FULL = {
  citekey: 'zhao2024',
  title: 'Halide doping raises the zT of n-type SnSe above 2.4',
  year: 2024,
  group: 'halogen',
  confidence: 96,
  uses: 7,
  quarantined: false,
}

/** A listing row carrying only the two fields every row must have. */
const BARE = { citekey: 'wang', title: 'Unreviewed preprint on SnSe single crystals' }

afterEach(cleanup)

/** A settled call carrying `meta`, as ui-tool hands one to a keyed row. */
function settled(meta: unknown): ToolCallBlock {
  return { kind: 'tool-result', seq: 4, time: 0, callId: 'c1', call: null, callTime: null,
    content: [], isError: false, meta, callView: null, resultView: null, subCalls: [] } as unknown as ToolCallBlock
}

/** A still-running call, which carries no meta at all. */
function running(): ToolCallBlock {
  return { callId: 'c1', name: 'citations_list', argsRaw: '{}', turn: 1, step: 1, time: 0,
    callView: null, subCalls: [] }
}

/** The listing row's props over one call. */
function listProps(block: ToolCallBlock): CitationsTableProps {
  return { block, t } as unknown as CitationsTableProps
}

/** The confirmation row's props over one call. */
function addProps(block: ToolCallBlock): CitationAddedProps {
  return { block, t } as unknown as CitationAddedProps
}

describe('citationRowsOf', () => {
  it('takes the rows of a well-formed citations meta', () => {
    expect(citationRowsOf(settled({ kind: 'citations', project: 'thermo-2026', citations: [FULL, BARE] })))
      .toEqual([FULL, BARE])
  })

  it('refuses every meta that is not this tool s', () => {
    expect(citationRowsOf(running())).toBeNull()
    expect(citationRowsOf(settled(undefined))).toBeNull()
    expect(citationRowsOf(settled(null))).toBeNull()
    expect(citationRowsOf(settled('citations'))).toBeNull()
    expect(citationRowsOf(settled({ kind: 'literature', citations: [FULL] }))).toBeNull()
    expect(citationRowsOf(settled({ kind: 'citations', citations: 'many' }))).toBeNull()
  })

  it('drops array entries that are not rows, field by field', () => {
    const citations = [
      FULL, null, 'zhao2024', 7, { title: FULL.title }, { citekey: 'k' },
      { ...FULL, citekey: 1 }, { ...FULL, title: null }, { ...FULL, year: '2024' },
      { ...FULL, group: 3 }, { ...FULL, confidence: '96' }, { ...FULL, uses: null },
      { ...FULL, quarantined: 'yes' },
    ]
    expect(citationRowsOf(settled({ kind: 'citations', citations }))).toEqual([FULL])
  })
})

describe('addedCitationOf', () => {
  it('takes the single citation of a well-formed add meta', () => {
    expect(addedCitationOf(settled({ kind: 'citation', project: 'thermo-2026', citation: FULL }))).toEqual(FULL)
  })

  it('also accepts the one-element listing spelling', () => {
    expect(addedCitationOf(settled({ kind: 'citations', citations: [BARE, FULL] }))).toEqual(BARE)
  })

  it('refuses a meta it cannot read', () => {
    expect(addedCitationOf(settled(null))).toBeNull()
    expect(addedCitationOf(settled({ kind: 'citation', citation: { title: 'no key' } }))).toBeNull()
    expect(addedCitationOf(settled({ kind: 'citations', citations: [] }))).toBeNull()
  })
})

describe('metaGroupLabel', () => {
  it('localizes the two reserved keys and states any other one', () => {
    expect(metaGroupLabel(undefined, t)).toBeUndefined()
    expect(metaGroupLabel('ungrouped', t)).toBe('未分组')
    expect(metaGroupLabel('quarantine', t)).toBe('隔离')
    expect(metaGroupLabel('halogen', t)).toBe('halogen')
  })
})

describe('CitationsTable', () => {
  it('lists every row with the facts its meta carries', () => {
    render(<CitationsTable {...listProps(settled({ kind: 'citations', citations: [FULL, BARE] }))} />)

    expect(screen.getByText('引用池 2 条')).toBeTruthy()
    expect(screen.getByText('[zhao2024]')).toBeTruthy()
    expect(screen.getByText(FULL.title)).toBeTruthy()
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText('halogen')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('置信 96%')).toBeTruthy()
    // Every column header the table promises, so the bare row's empty cells
    // are readable as "the host reported none".
    for (const head of ['citekey', '标题', '年', '分组', '正文引用', '置信']) {
      expect(screen.getByRole('columnheader', { name: head })).toBeTruthy()
    }
  })

  it('marks a quarantined row and leaves the absent cells empty', () => {
    render(<CitationsTable {...listProps(settled({
      kind: 'citations', citations: [{ ...BARE, quarantined: true }],
    }))} />)

    expect(screen.getByText('隔离', { exact: false })).toBeTruthy()
    // The confidence column stays, its cell stays empty: the meta reported none.
    expect(screen.queryByText(/置信 \d/u)).toBeNull()
  })

  it('leaves the seat empty for a meta it cannot read, so the generic card renders', () => {
    const { container, rerender } = render(<CitationsTable {...listProps(settled({ kind: 'chart' }))} />)
    expect(container.firstChild).toBeNull()

    rerender(<CitationsTable {...listProps(settled({ kind: 'citations', citations: [] }))} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('CitationAdded', () => {
  it('confirms the citation with the facts its meta carries', () => {
    render(<CitationAdded {...addProps(settled({ kind: 'citation', citation: FULL }))} />)

    expect(screen.getByText('已加入引用池')).toBeTruthy()
    expect(screen.getByText('[zhao2024]')).toBeTruthy()
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText('halogen')).toBeTruthy()
    expect(screen.getByText('置信 96%')).toBeTruthy()
    expect(screen.queryByText('隔离')).toBeNull()
  })

  it('states a quarantined addition, and claims nothing the meta omits', () => {
    render(<CitationAdded {...addProps(settled({
      kind: 'citation', citation: { ...BARE, quarantined: true },
    }))} />)

    expect(screen.getByText(BARE.title)).toBeTruthy()
    expect(screen.getByText('隔离')).toBeTruthy()
    expect(screen.queryByText(/置信/u)).toBeNull()
    expect(screen.queryByText('2024')).toBeNull()
  })

  it('leaves the seat empty for a call that added nothing', () => {
    const { container } = render(<CitationAdded {...addProps(running())} />)
    expect(container.firstChild).toBeNull()
  })
})
