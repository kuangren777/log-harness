// @vitest-environment jsdom
/**
 * The search view and its result cards: what the four states draw, which
 * gestures reach the injected face, and the proof that every count, duration,
 * and identifier on screen is read off the result the host returned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { LiteratureRecord, RecentQuery, SciSearchInjected, SearchOutcome } from '../src/client/contract.ts'
import { ResultCard, type ResultCardProps } from '../src/client/ResultCard.tsx'
import { SearchView, type SearchViewProps } from '../src/client/SearchView.tsx'
import { createSearchStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { BARE, FULL, resultOf } from './records.client.ts'

const t = makeTranslate(zh)

/** The host history both chip cases read. */
const RECENT: readonly RecentQuery[] = [
  { id: 'h1', query: 'n-type SnSe thermoelectric zT', at: 1, hits: 12 },
  { id: 'h2', query: 'perovskite 850K stability', at: 2, hits: 4 },
]

afterEach(cleanup)

/** The injected face, with every member stubbed and overridable per case. */
function faceOf(overrides: Partial<SciSearchInjected> = {}) {
  return {
    search: vi.fn(async (): Promise<SearchOutcome> => ({ ok: true, result: resultOf([FULL, BARE]) })),
    recent: vi.fn(async (): Promise<readonly RecentQuery[]> => RECENT),
    forget: vi.fn(async (): Promise<readonly RecentQuery[]> => [RECENT[1]!]),
    deepDive: vi.fn(),
    ...overrides,
  }
}

/** Mount the view over a live store instance, flushing its history read. */
async function mount(overrides: Partial<SciSearchInjected> = {}) {
  const store = createSearchStore().create()
  const face = faceOf(overrides)
  const props = {
    useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
  } as unknown as SearchViewProps
  await act(async () => { render(<SearchView {...props} />) })
  return { store, face }
}

/** Type one query into the box. */
function type(text: string): void {
  fireEvent.change(screen.getByLabelText('文献检索词'), { target: { value: text } })
}

describe('SearchView hero and query box', () => {
  it('names the four real sources it searches', async () => {
    await mount()
    expect(screen.getByRole('heading', { name: '检索一切科学知识' })).toBeTruthy()
    expect(screen.getByText('OpenAlex · Semantic Scholar · arXiv · Crossref')).toBeTruthy()
  })

  it('refuses a blank query without calling the host', async () => {
    const b = await mount()
    const button = screen.getByRole('button', { name: '检索' })
    expect(button.hasAttribute('disabled')).toBe(true)

    type('   ')
    fireEvent.keyDown(screen.getByLabelText('文献检索词'), { key: 'Enter' })
    expect(b.face.search).not.toHaveBeenCalled()
  })

  it('searches on Enter and shows the result the host returned', async () => {
    const b = await mount()
    type('n-type SnSe thermoelectric zT')
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('文献检索词'), { key: 'Enter' }) })

    expect(b.face.search).toHaveBeenCalledWith({ query: 'n-type SnSe thermoelectric zT' })
    expect(screen.getByText('检索结果 · 2 条 · 耗时 1.8 s')).toBeTruthy()
    expect(screen.getByRole('link', { name: FULL.title })).toBeTruthy()
    expect(screen.getByRole('link', { name: BARE.title })).toBeTruthy()
  })

  it('ignores a key that is not Enter', async () => {
    const b = await mount()
    type('zT')
    fireEvent.keyDown(screen.getByLabelText('文献检索词'), { key: 'a' })
    expect(b.face.search).not.toHaveBeenCalled()
  })

  it('disables the box and both chip controls while the search is in flight', async () => {
    let settle = (_outcome: SearchOutcome): void => {}
    const search = vi.fn(() => new Promise<SearchOutcome>((resolve) => { settle = resolve }))
    const b = await mount({ search })
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })

    expect(screen.getByLabelText('文献检索词').hasAttribute('disabled')).toBe(true)
    const running = screen.getByRole('button', { name: '检索中…' })
    expect(running.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'n-type SnSe thermoelectric zT' }).hasAttribute('disabled')).toBe(true)
    // A second Enter while the first search is still out changes nothing.
    fireEvent.keyDown(screen.getByLabelText('文献检索词'), { key: 'Enter' })
    expect(search).toHaveBeenCalledTimes(1)

    await act(async () => { settle({ ok: true, result: resultOf([]) }) })
    expect(b.store.getSnapshot().status).toBe('done')
  })

  it('states an empty search rather than drawing an empty list', async () => {
    await mount({ search: vi.fn(async () => ({ ok: true, result: resultOf([]) })) })
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })

    expect(screen.getByText('检索结果 · 0 条 · 耗时 1.8 s')).toBeTruthy()
    expect(screen.getByText('没有检索到文献。换个说法，或放宽年份范围再试。')).toBeTruthy()
  })

  it('reports the sources that failed beside the results that survived', async () => {
    const result = resultOf([FULL], [{ source: 'semanticscholar', code: 'LITERATURE_SOURCE_HTTP', message: '429' }])
    await mount({ search: vi.fn(async () => ({ ok: true, result })) })
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })

    expect(screen.getByText('来源错误 1')).toBeTruthy()
    expect(screen.getByText('Semantic Scholar：LITERATURE_SOURCE_HTTP')).toBeTruthy()
  })
})

describe('SearchView failure states', () => {
  it('says so plainly when no source answered', async () => {
    await mount({ search: vi.fn(async () => ({ ok: false, code: 'LITERATURE_ALL_SOURCES_FAILED' })) })
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })

    expect(screen.getByRole('alert').textContent).toBe('四个文献源都没有返回结果，稍后再试。')
  })

  it('shows the host code for every other failure', async () => {
    await mount({ search: vi.fn(async () => ({ ok: false, code: 'LITERATURE_QUERY_TOO_LONG' })) })
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })

    expect(screen.getByRole('alert').textContent).toBe('检索失败（LITERATURE_QUERY_TOO_LONG）。')
  })
})

describe('SearchView recent queries', () => {
  it('draws no strip when the host remembers nothing', async () => {
    await mount({ recent: vi.fn(async () => []) })
    expect(screen.queryByRole('group', { name: '最近检索' })).toBeNull()
  })

  it('refills and re-runs a remembered query', async () => {
    const b = await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'n-type SnSe thermoelectric zT' }))
    })

    expect(b.face.search).toHaveBeenCalledWith({ query: 'n-type SnSe thermoelectric zT' })
    expect(screen.getByLabelText('文献检索词').value).toBe('n-type SnSe thermoelectric zT')
    // The history is re-read after the search settles, so a new row appears
    // without a manual refresh.
    expect(b.face.recent).toHaveBeenCalledTimes(2)
  })

  it('forgets one row by its id and keeps the rest', async () => {
    const b = await mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '不再保留「n-type SnSe thermoelectric zT」' }))
    })

    expect(b.face.forget).toHaveBeenCalledWith('h1')
    expect(screen.queryByRole('button', { name: 'n-type SnSe thermoelectric zT' })).toBeNull()
    expect(screen.getByRole('button', { name: 'perovskite 850K stability' })).toBeTruthy()
  })
})

describe('SearchView deep dive', () => {
  it('hands the composed prompt to the research flow', async () => {
    const b = await mount()
    type('zT')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '检索' })) })
    fireEvent.click(screen.getAllByRole('button', { name: '在研究流中深入' })[0]!)

    expect(b.face.deepDive).toHaveBeenCalledWith(
      `请用 literature_search 检索「${FULL.title}」，读取前 5 篇的摘要，给出带 DOI 引用的综述提纲。`,
    )
  })
})

/** One card's props over a record. */
function cardProps(record: LiteratureRecord, onDeepDive = vi.fn()): ResultCardProps {
  return { record, onDeepDive, t }
}

describe('ResultCard', () => {
  it('draws every fact the record carries, and links out safely', () => {
    render(<ResultCard {...cardProps(FULL)} />)

    expect(screen.getByText('OpenAlex')).toBeTruthy()
    const title = screen.getByRole('link', { name: FULL.title })
    expect(title.getAttribute('href')).toBe(FULL.url)
    expect(title.getAttribute('rel')).toBe('noreferrer noopener')
    expect(screen.getByText('Zhao, Li-Dong · Chang, Cheng · Wang, Dongyang 等')).toBeTruthy()
    expect(screen.getByText('Nature · 2024')).toBeTruthy()
    expect(screen.getByText('被引 187')).toBeTruthy()
    expect(screen.getByText('doi:10.1038/s41586-024-07001-2')).toBeTruthy()
    expect(screen.getByText('arXiv:2607.09182')).toBeTruthy()
    expect(screen.getByRole('link', { name: '打开 PDF' }).getAttribute('href')).toBe(FULL.pdfUrl)
  })

  it('draws no line for a fact the record does not carry', () => {
    render(<ResultCard {...cardProps(BARE)} />)

    expect(screen.queryByText(/被引/u)).toBeNull()
    expect(screen.queryByText(/^doi:/u)).toBeNull()
    expect(screen.queryByRole('link', { name: '打开 PDF' })).toBeNull()
    expect(screen.queryByRole('button', { name: '展开摘要' })).toBeNull()
  })

  it('reads the bibliographic line from whichever half the record has', () => {
    const view = render(<ResultCard {...cardProps({ ...BARE, venue: 'Physical Review B' })} />)
    expect(screen.getByText('Physical Review B')).toBeTruthy()
    view.unmount()

    render(<ResultCard {...cardProps({ ...BARE, year: 2021, authors: ['Qin, Bingchao'] })} />)
    expect(screen.getByText('2021')).toBeTruthy()
    expect(screen.getByText('Qin, Bingchao')).toBeTruthy()
  })

  it('clamps a long abstract until the reader expands it', () => {
    render(<ResultCard {...cardProps(FULL)} />)
    const clamped = `${'A'.repeat(300)}…`
    expect(screen.getByText(clamped)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '展开摘要' }))
    expect(screen.getByText('A'.repeat(320))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收起摘要' }))
    expect(screen.getByText(clamped)).toBeTruthy()
  })

  it('shows a short abstract whole, with nothing to expand', () => {
    render(<ResultCard {...cardProps({ ...BARE, abstract: 'Short but real.' })} />)
    expect(screen.getByText('Short but real.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '展开摘要' })).toBeNull()
  })

  it('takes the record into the research flow', () => {
    const onDeepDive = vi.fn()
    render(<ResultCard {...cardProps(FULL, onDeepDive)} />)
    fireEvent.click(screen.getByRole('button', { name: '在研究流中深入' }))
    expect(onDeepDive).toHaveBeenCalledWith(FULL)
  })
})

describe('ResultCard citation copy', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  /** Install one clipboard face for the case under test. */
  function withClipboard(writeText: (text: string) => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  it('writes the BibTeX entry and retires the notice on its own', async () => {
    const writeText = vi.fn(async () => {})
    withClipboard(writeText)
    render(<ResultCard {...cardProps(FULL)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制引用' })) })
    expect(writeText.mock.calls[0]?.[0]).toContain('@article{Zhao2024,')
    expect(screen.getByText('已复制 BibTeX')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(2400) })
    expect(screen.queryByText('已复制 BibTeX')).toBeNull()
  })

  it('says the copy failed when the clipboard rejects it', async () => {
    withClipboard(vi.fn(async () => { throw new Error('denied') }))
    render(<ResultCard {...cardProps(FULL)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制引用' })) })
    expect(screen.getByText('复制失败，请手动选取。')).toBeTruthy()
  })

  it('says the same where the browser exposes no clipboard at all', async () => {
    render(<ResultCard {...cardProps(FULL)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制引用' })) })
    expect(screen.getByText('复制失败，请手动选取。')).toBeTruthy()
  })
})
