// @vitest-environment jsdom
/**
 * The two library tool rows: what they draw from a well-formed result meta,
 * and every shape of meta they refuse to draw from. These rows are the only
 * consumers of host-computed presentation data in this package, so their
 * validation is the suite's subject.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  LibraryAdded, LibraryHits, libraryCreatedOf, libraryEntriesOf, type LibraryHitsProps,
} from '../src/client/LibraryHits.tsx'
import { zh } from '../src/client/locales.ts'
import { BARE, FULL } from './entries.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** A settled call carrying `meta`, as ui-tool hands one to a keyed row. */
function settled(meta: unknown): ToolCallBlock {
  return { kind: 'tool-result', seq: 4, time: 0, callId: 'c1', call: null, callTime: null,
    content: [], isError: false, meta, callView: null, resultView: null, subCalls: [] } as unknown as ToolCallBlock
}

/** A still-running call, which carries no meta at all. */
function running(): ToolCallBlock {
  return { callId: 'c1', name: 'library_search', argsRaw: '{}', turn: 1, step: 1, time: 0,
    callView: null, subCalls: [] } as unknown as ToolCallBlock
}

/** The row's props over one call. */
function props(block: ToolCallBlock): LibraryHitsProps {
  return { block, t } as unknown as LibraryHitsProps
}

describe('libraryEntriesOf', () => {
  it('takes the entries of a well-formed library meta', () => {
    expect(libraryEntriesOf(settled({ kind: 'library', entries: [FULL] }))).toEqual([FULL])
  })

  it('refuses a meta of another kind, another shape, or none at all', () => {
    expect(libraryEntriesOf(running())).toBeNull()
    expect(libraryEntriesOf(settled(undefined))).toBeNull()
    expect(libraryEntriesOf(settled(null))).toBeNull()
    expect(libraryEntriesOf(settled('library'))).toBeNull()
    expect(libraryEntriesOf(settled({ kind: 'literature', records: [] }))).toBeNull()
    expect(libraryEntriesOf(settled({ kind: 'library', entries: 'one' }))).toBeNull()
  })

  it('drops an array element that is not an entry it can draw', () => {
    const bad = [
      null,
      'entry',
      { ...FULL, id: 7 },
      { ...FULL, title: undefined },
      { ...FULL, kind: 'preprint' },
      { ...FULL, status: 'skimmed' },
      { ...FULL, tags: 'thermoelectric' },
      { ...FULL, files: null },
    ]
    expect(libraryEntriesOf(settled({ kind: 'library', entries: [...bad, FULL] }))).toEqual([FULL])
  })
})

describe('libraryCreatedOf', () => {
  it('reads the flag the host stated, and nothing else', () => {
    expect(libraryCreatedOf(settled({ kind: 'library', entries: [FULL], created: true }))).toBe(true)
    expect(libraryCreatedOf(settled({ kind: 'library', entries: [FULL], created: false }))).toBe(false)
    expect(libraryCreatedOf(settled({ kind: 'library', entries: [FULL] }))).toBeUndefined()
    expect(libraryCreatedOf(settled({ kind: 'library', entries: [FULL], created: 'yes' }))).toBeUndefined()
    expect(libraryCreatedOf(settled(null))).toBeUndefined()
    expect(libraryCreatedOf(running())).toBeUndefined()
  })
})

describe('LibraryHits', () => {
  it('lists what the call found, drawing only the facts each entry carries', () => {
    render(<LibraryHits {...props(settled({ kind: 'library', entries: [FULL, BARE] }))} />)

    expect(screen.getByText('知识库命中 2 条')).toBeTruthy()
    expect(screen.getByText(FULL.title)).toBeTruthy()
    expect(screen.getByText('2024')).toBeTruthy()
    expect(screen.getByText('在读')).toBeTruthy()
    expect(screen.getByText('doi:10.1038/s41586-024-07001-2')).toBeTruthy()
    expect(screen.getByText('2 个文件')).toBeTruthy()
    // The dataset carries none of those, so its row draws none of them.
    expect(screen.getByText(BARE.title)).toBeTruthy()
    expect(screen.getByText('数据集')).toBeTruthy()
    expect(screen.getAllByText(/个文件/u)).toHaveLength(1)
  })

  it('leaves its seat empty for a call it cannot draw', () => {
    const empty = render(<LibraryHits {...props(settled({ kind: 'library', entries: [] }))} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()

    const other = render(<LibraryHits {...props(running())} />)
    expect(other.container.firstChild).toBeNull()
  })
})

describe('LibraryAdded', () => {
  it('confirms the one entry the call stored, saying which outcome it was', () => {
    const created = render(
      <LibraryAdded {...props(settled({ kind: 'library', entries: [FULL], created: true }))} />)
    expect(screen.getByText('已加入知识库')).toBeTruthy()
    expect(screen.getByText(FULL.title)).toBeTruthy()
    expect(screen.getByText('文献')).toBeTruthy()
    created.unmount()

    const merged = render(
      <LibraryAdded {...props(settled({ kind: 'library', entries: [FULL], created: false }))} />)
    expect(screen.getByText('已在知识库中')).toBeTruthy()
    merged.unmount()

    render(<LibraryAdded {...props(settled({ kind: 'library', entries: [FULL] }))} />)
    expect(screen.getByText('已写入知识库')).toBeTruthy()
  })

  it('leaves its seat empty for a call that stored nothing', () => {
    const empty = render(<LibraryAdded {...props(settled({ kind: 'library', entries: [] }))} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()

    const other = render(<LibraryAdded {...props(running())} />)
    expect(other.container.firstChild).toBeNull()
  })
})
