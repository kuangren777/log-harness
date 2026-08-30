// @vitest-environment jsdom
/**
 * The citation-pool view: what the header states, what each left-column
 * selection shows, which gestures reach the injected face, and the proof that
 * every count, confidence, and use count on screen is read off the pool the
 * host returned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { BibtexOutcome, PoolOutcome, SciCitationsInjected } from '../src/client/contract.ts'
import { CitationsView, type CitationsViewProps } from '../src/client/CitationsView.tsx'
import { createCitationsStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { BARE, GROUPS, poolOf, PROJECT, PROJECTS, QIN, ZHAO } from './citations.client.ts'

const t = makeTranslate(zh)

/** The BibTeX the fake host renders. */
const BIBTEX = '@article{zhao2024,\n  title = {Halide doping},\n}\n'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The injected face, with every member stubbed and overridable per case. */
function faceOf(overrides: Partial<SciCitationsInjected> = {}) {
  const settled = async (): Promise<PoolOutcome> => ({ ok: true, pool: poolOf() })
  return {
    projects: vi.fn(async () => PROJECTS),
    pool: vi.fn(settled),
    createGroup: vi.fn(settled),
    removeGroup: vi.fn(settled),
    move: vi.fn(settled),
    remove: vi.fn(settled),
    rescan: vi.fn(settled),
    exportBibtex: vi.fn(async (): Promise<BibtexOutcome> => ({ ok: true, bibtex: BIBTEX })),
    ...overrides,
  }
}

/** Let both mount effects and the promise chains they start settle. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

/** Mount the view over a live store instance, flushing its two reads. */
async function mount(overrides: Partial<SciCitationsInjected> = {}) {
  const store = createCitationsStore().create()
  const face = faceOf(overrides)
  const props = {
    useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
  } as unknown as CitationsViewProps
  await act(async () => { render(<CitationsView {...props} />) })
  await flush()
  return { store, face }
}

/** One left-column bucket button, by the label it starts with. */
function bucket(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`, 'u') })
}

/** The group tag of one row. */
function tagOf(citekey: string): HTMLElement {
  return screen.getByRole('button', { name: `把「${citekey}」移到别的分组` })
}

/** The remove button of one row. */
function removeOf(citekey: string): HTMLElement {
  return screen.getByRole('button', { name: `把「${citekey}」移出引用池` })
}

/** Click one button and let the write it starts settle. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(element) })
  await flush()
}

describe('the pool header', () => {
  it('opens the first project the host names and states that pool s own counts', async () => {
    const b = await mount()

    expect(b.face.projects).toHaveBeenCalledTimes(1)
    expect(b.face.pool).toHaveBeenCalledWith(PROJECT)
    expect(screen.getByRole('heading', { name: '引用池' })).toBeTruthy()
    expect(screen.getByText('3 条引用 · 平均置信 72% · 1 条隔离')).toBeTruthy()
    expect(screen.getByText('上次扫描读了 12 个文件')).toBeTruthy()
    expect(screen.getByLabelText<HTMLSelectElement>('论文项目').value).toBe(PROJECT)
  })

  it('says nothing about a scan that has not run', async () => {
    await mount({ pool: vi.fn(async () => ({ ok: true, pool: poolOf([ZHAO], GROUPS, 0) })) })
    expect(screen.queryByText(/上次扫描/u)).toBeNull()
  })

  it('reads the pool of another project when the selector changes', async () => {
    const b = await mount()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('论文项目'), { target: { value: 'perovskite-2025' } })
    })
    await flush()

    expect(b.face.pool).toHaveBeenLastCalledWith('perovskite-2025')
    // The selection follows the project: a group key of the old project would
    // filter the new pool down to nothing.
    expect(b.store.getSnapshot().group).toBe('all')
  })

  it('states an unreadable pool and draws no list', async () => {
    await mount({ pool: vi.fn(async () => ({ ok: false, code: 'CITATIONS_STORAGE_UNAVAILABLE' })) })

    expect(screen.getByRole('alert').textContent)
      .toBe('读不出这个项目的引用池（CITATIONS_STORAGE_UNAVAILABLE）。')
    expect(screen.queryByText('[zhao2024]')).toBeNull()
  })

  it('states that the host named no project at all', async () => {
    const b = await mount({ projects: vi.fn(async () => []) })

    expect(screen.getByText('还没有论文项目。在 papers/ 下建一个项目后再回到引用池。')).toBeTruthy()
    expect(screen.queryByLabelText('论文项目')).toBeNull()
    expect(b.face.pool).not.toHaveBeenCalled()
  })
})

describe('the group column', () => {
  it('counts every bucket off the same citations the list draws', async () => {
    await mount()

    expect(bucket('全部').textContent).toContain('3')
    expect(bucket('卤素掺杂').textContent).toContain('1')
    expect(bucket('缺陷工程').textContent).toContain('1')
    expect(bucket('隔离').textContent).toContain('1')
  })

  it('filters the list to one group, and to the quarantined citations', async () => {
    await mount()
    await click(bucket('卤素掺杂'))

    expect(screen.getByText('[zhao2024]')).toBeTruthy()
    expect(screen.queryByText('[qin2025]')).toBeNull()

    await click(bucket('隔离'))
    expect(screen.getByText('[wang]')).toBeTruthy()
    expect(screen.queryByText('[zhao2024]')).toBeNull()
  })

  it('states an empty group and an empty pool differently', async () => {
    await mount({ pool: vi.fn(async () => ({ ok: true, pool: poolOf([ZHAO]) })) })
    await click(bucket('缺陷工程'))
    expect(screen.getByText('该分组暂无引用 · 用条目上的分组标签把引用移进来')).toBeTruthy()

    cleanup()
    await mount({ pool: vi.fn(async () => ({ ok: true, pool: poolOf([]) })) })
    expect(screen.getByText(
      '这个项目还没有引用。让智能体用 citations_add 添加，或点「重新扫描」读入 refs.bib。',
    )).toBeTruthy()
  })

  it('creates one group from the label the user typed', async () => {
    const b = await mount()
    await click(screen.getByRole('button', { name: '新建分组' }))

    const input = screen.getByLabelText('新分组名称')
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(input, { target: { value: '  器件验证  ' } })
    await click(screen.getByRole('button', { name: '创建' }))

    expect(b.face.createGroup).toHaveBeenCalledWith(PROJECT, '器件验证')
    // The input closes itself: the next group starts from the button again.
    expect(screen.queryByLabelText('新分组名称')).toBeNull()
  })

  it('creates on Enter, refuses a blank label, and cancels without writing', async () => {
    const b = await mount()
    await click(screen.getByRole('button', { name: '新建分组' }))
    const input = screen.getByLabelText('新分组名称')

    fireEvent.change(input, { target: { value: '   ' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(b.face.createGroup).not.toHaveBeenCalled()

    // Typing is not submitting: only Enter and the button write.
    fireEvent.change(input, { target: { value: '器件' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'a' }) })
    expect(b.face.createGroup).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '器件验证' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await flush()
    expect(b.face.createGroup).toHaveBeenCalledWith(PROJECT, '器件验证')

    await click(screen.getByRole('button', { name: '新建分组' }))
    fireEvent.change(screen.getByLabelText('新分组名称'), { target: { value: '弃掉' } })
    await click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('新分组名称')).toBeNull()
    expect(b.face.createGroup).toHaveBeenCalledTimes(1)
  })

  it('asks before it deletes a group', async () => {
    const b = await mount()
    await click(screen.getByRole('button', { name: '删除分组「卤素掺杂」' }))
    expect(b.face.removeGroup).not.toHaveBeenCalled()

    await click(screen.getByRole('button', { name: '确认删除' }))
    expect(b.face.removeGroup).toHaveBeenCalledWith(PROJECT, 'halogen')
  })
})

describe('one citation row', () => {
  it('draws every fact the record carries, and skips the ones it does not', async () => {
    await mount()

    expect(screen.getByText(ZHAO.title)).toBeTruthy()
    expect(screen.getByText('openalex / crossref · 2024')).toBeTruthy()
    expect(screen.getByText('正文引用 7 处')).toBeTruthy()
    expect(screen.getByText('置信 96%')).toBeTruthy()
    expect(screen.getByText('分组：卤素掺杂')).toBeTruthy()
    // The bib-only row: no source, no year, and the reserved ungrouped label.
    expect(screen.getByText('分组：未分组')).toBeTruthy()
    expect(screen.getByText('置信 42%')).toBeTruthy()
    expect(screen.getAllByText('隔离').length).toBeGreaterThan(0)
  })

  it('states a partial origin line rather than an invented one', async () => {
    await mount({
      pool: vi.fn(async () => ({ ok: true, pool: poolOf([
        { ...QIN, sources: [] },
        { ...ZHAO, year: undefined },
      ]) })),
    })

    expect(screen.getByText('2025')).toBeTruthy()
    expect(screen.getByText('openalex / crossref')).toBeTruthy()
  })

  it('names a group the project no longer declares by its bare key', async () => {
    await mount({ pool: vi.fn(async () => ({ ok: true, pool: poolOf([{ ...QIN, group: 'device' }]) })) })
    expect(screen.getByText('分组：device')).toBeTruthy()
  })

  it('moves one citation through the group menu', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(tagOf('zhao2024')) })

    expect(screen.getByRole('menu')).toBeTruthy()
    await click(screen.getByRole('menuitem', { name: '缺陷工程' }))

    expect(b.face.move).toHaveBeenCalledWith(PROJECT, 'zhao2024', 'defect')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves one citation back out of every group', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(tagOf('qin2025')) })
    await click(screen.getByRole('menuitem', { name: '未分组' }))

    expect(b.face.move).toHaveBeenCalledWith(PROJECT, 'qin2025', 'ungrouped')
  })

  it('writes nothing when the menu picks the group the citation is already in', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(tagOf('zhao2024')) })
    const current = screen.getByRole('menuitem', { name: '卤素掺杂' })
    expect(current.getAttribute('aria-current')).toBe('true')

    await click(current)
    expect(b.face.move).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape and on a second click', async () => {
    await mount()
    await act(async () => { fireEvent.click(tagOf('zhao2024')) })
    // Any other key is the row's business, not the menu's.
    await act(async () => { fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' }) })
    expect(screen.getByRole('menu')).toBeTruthy()

    await act(async () => { fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }) })
    expect(screen.queryByRole('menu')).toBeNull()

    await act(async () => { fireEvent.click(tagOf('zhao2024')) })
    await act(async () => { fireEvent.click(tagOf('zhao2024')) })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('asks before it drops a citation, and takes no for an answer', async () => {
    const b = await mount()
    await act(async () => { fireEvent.click(removeOf('zhao2024')) })
    await click(screen.getByRole('button', { name: '取消' }))
    expect(b.face.remove).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(removeOf('zhao2024')) })
    await click(screen.getByRole('button', { name: '确认移出' }))
    expect(b.face.remove).toHaveBeenCalledWith(PROJECT, 'zhao2024')
  })

  it('keeps the list on screen when a write fails, and says so', async () => {
    await mount({ move: vi.fn(async () => ({ ok: false, code: 'CITATIONS_UNKNOWN_GROUP' })) })
    await act(async () => { fireEvent.click(tagOf('zhao2024')) })
    await click(screen.getByRole('menuitem', { name: '缺陷工程' }))

    expect(screen.getByRole('alert').textContent).toBe('刚才那次操作没有成功（CITATIONS_UNKNOWN_GROUP）。')
    expect(screen.getByText('[zhao2024]')).toBeTruthy()
  })
})

describe('rescan, export, and copy', () => {
  it('says it is scanning while the host scans, and draws what came back', async () => {
    let release: ((outcome: PoolOutcome) => void) | undefined
    const rescan = vi.fn(async () => new Promise<PoolOutcome>((resolve) => { release = resolve }))
    await mount({ rescan })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新扫描' })) })
    expect(screen.getByRole('button', { name: '扫描中…' }).hasAttribute('disabled')).toBe(true)

    await act(async () => { release?.({ ok: true, pool: poolOf([{ ...ZHAO, uses: 11 }]) }) })
    await flush()
    expect(rescan).toHaveBeenCalledWith(PROJECT)
    expect(screen.getByText('正文引用 11 处')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeTruthy()
  })

  it('saves the host s BibTeX as one named file', async () => {
    const createObjectURL = vi.fn(() => 'blob:bib')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const b = await mount()

    await click(screen.getByRole('button', { name: '导出 BibTeX' }))

    expect(b.face.exportBibtex).toHaveBeenCalledWith(PROJECT, undefined)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('已导出 thermo-2026.bib')
    clicked.mockRestore()
  })

  it('exports the selected group, and the whole project for the two that are not groups', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:bib'), revokeObjectURL: vi.fn() })
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const b = await mount()

    await click(bucket('缺陷工程'))
    expect(screen.getByRole('button', { name: '导出 BibTeX' }).getAttribute('title'))
      .toBe('导出「缺陷工程」分组的 BibTeX')
    await click(screen.getByRole('button', { name: '导出 BibTeX' }))
    expect(b.face.exportBibtex).toHaveBeenLastCalledWith(PROJECT, 'defect')

    await click(bucket('隔离'))
    expect(screen.getByRole('button', { name: '导出 BibTeX' }).getAttribute('title'))
      .toBe('导出这个项目全部引用的 BibTeX')
    await click(screen.getByRole('button', { name: '导出 BibTeX' }))
    expect(b.face.exportBibtex).toHaveBeenLastCalledWith(PROJECT, undefined)
    clicked.mockRestore()
  })

  it('states a refused export and a browser that cannot download at all', async () => {
    await mount({ exportBibtex: vi.fn(async () => ({ ok: false, code: 'CITATIONS_EMPTY_EXPORT' })) })
    await click(screen.getByRole('button', { name: '导出 BibTeX' }))
    expect(screen.getByRole('status').textContent).toBe('导出失败（CITATIONS_EMPTY_EXPORT）。')

    cleanup()
    vi.stubGlobal('URL', {})
    await mount()
    await click(screen.getByRole('button', { name: '导出 BibTeX' }))
    expect(screen.getByRole('status').textContent).toBe('导出失败（CITATIONS_DOWNLOAD_UNAVAILABLE）。')
  })

  it('copies the listed citations as the block the pool derives', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount()

    await click(screen.getByRole('button', { name: '复制引用块' }))
    expect(screen.getByRole('status').textContent).toBe('已复制 3 条引用')
    const written = writeText.mock.calls[0]?.[0] as unknown as string
    expect(written.split('\n')).toHaveLength(3)
    expect(written.startsWith('[zhao2024] Zhao, Li-Dong, Chang, Cheng.')).toBe(true)

    // The selection is what gets copied, not the whole pool.
    await click(bucket('缺陷工程'))
    await click(screen.getByRole('button', { name: '复制引用块' }))
    expect(screen.getByRole('status').textContent).toBe('已复制 1 条引用')
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('states a clipboard that refused, and offers no copy of an empty list', async () => {
    await mount({ pool: vi.fn(async () => ({ ok: true, pool: poolOf([BARE]) })) })
    await click(screen.getByRole('button', { name: '复制引用块' }))
    expect(screen.getByRole('status').textContent).toBe('复制失败，请手动选取。')

    await click(bucket('卤素掺杂'))
    expect(screen.getByRole('button', { name: '复制引用块' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('the copy notice', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('retires itself', async () => {
    await mount()
    await click(screen.getByRole('button', { name: '复制引用块' }))
    expect(screen.getByRole('status')).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(2400) })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
