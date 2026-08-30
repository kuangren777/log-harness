// @vitest-environment jsdom
/**
 * The entry detail page: what it draws off the entry the host returned, the
 * three writes it can make, what each stored file offers, and the four
 * page-level actions — copy, open, fetch, delete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { LibraryEntry } from '../src/client/contract.ts'
import { EntryDetail, NOTE_DEBOUNCE_MS, type EntryDetailProps } from '../src/client/EntryDetail.tsx'
import { zh } from '../src/client/locales.ts'
import { BARE, CSV_FILE, FULL, HUGE_FILE, PDF_FILE } from './entries.client.ts'

const t = makeTranslate(zh)

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** The page's props over one entry, with every callback stubbed. */
function detailProps(entry: LibraryEntry, overrides: Partial<EntryDetailProps> = {}) {
  return {
    entry,
    related: [BARE],
    onBack: vi.fn(),
    onOpen: vi.fn(),
    onPatched: vi.fn(),
    onRemoved: vi.fn(),
    update: vi.fn(async (_id: string, patch): Promise<{ ok: true; value: LibraryEntry }> =>
      ({ ok: true, value: { ...entry, ...patch } as LibraryEntry })),
    remove: vi.fn(async () => ({ ok: true as const, value: null })),
    fetchPdf: vi.fn(async () => ({ ok: true as const, value: entry })),
    upload: vi.fn(async () => ({ ok: true as const, entry: BARE })),
    readText: vi.fn(async () => ({ ok: true as const, text: 'a,b\n1,2' })),
    t,
    ...overrides,
  } as unknown as EntryDetailProps & { update: ReturnType<typeof vi.fn> }
}

/** Render the page over one entry. */
function mount(entry: LibraryEntry, overrides: Partial<EntryDetailProps> = {}) {
  const props = detailProps(entry, overrides)
  render(<EntryDetail {...props} />)
  return props
}

describe('EntryDetail metadata', () => {
  it('draws every fact the entry carries, each read off the entry', () => {
    mount(FULL)
    expect(screen.getByRole('heading', { name: FULL.title })).toBeTruthy()
    expect(screen.getByText('OpenAlex')).toBeTruthy()
    expect(screen.getByText('Crossref')).toBeTruthy()
    // Twice on purpose: the metadata badge, and the option the select stands on.
    expect(screen.getAllByText('在读')).toHaveLength(2)
    expect(screen.getByLabelText<HTMLSelectElement>('状态').value).toBe('reading')
    expect(screen.getByText('被引 187')).toBeTruthy()
    expect(screen.getByText('Zhao, Li-Dong, Chang, Cheng · doi:10.1038/s41586-024-07001-2 · arXiv:2607.09182'))
      .toBeTruthy()
    expect(screen.getByText(FULL.abstract as string)).toBeTruthy()
  })

  it('reads the three statistics off the entry, and says so when there is none', () => {
    mount(FULL)
    expect(screen.getByText('被引').previousSibling?.textContent).toBe('187')
    expect(screen.getByText('年份').previousSibling?.textContent).toBe('2024')
    expect(screen.getByText('来源数').previousSibling?.textContent).toBe('2')
    cleanup()

    mount(BARE)
    expect(screen.getByText('被引').previousSibling?.textContent).toBe('—')
    expect(screen.getByText('年份').previousSibling?.textContent).toBe('—')
    expect(screen.getByText('来源数').previousSibling?.textContent).toBe('1')
    expect(screen.getByText('这条记录没有摘要。')).toBeTruthy()
  })

  it('returns to the list', () => {
    const props = mount(FULL)
    fireEvent.click(screen.getByRole('button', { name: '← 返回知识库' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})

describe('EntryDetail writes', () => {
  it('adds a tag and reports the entry the host returned', async () => {
    const props = mount(FULL)
    fireEvent.change(screen.getByLabelText('添加标签'), { target: { value: ' halide ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加标签' })) })

    expect(props.update).toHaveBeenCalledWith(FULL.id, { tags: [...FULL.tags, 'halide'] })
    expect(props.onPatched).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已保存')).toBeTruthy()
  })

  it('adds a tag on Enter, and refuses a blank or duplicate one', async () => {
    const props = mount(FULL)
    const field = screen.getByLabelText('添加标签')

    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.update).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'snse' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.update).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'halide' } })
    fireEvent.keyDown(field, { key: 'a' })
    expect(props.update).not.toHaveBeenCalled()

    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(props.update).toHaveBeenCalledWith(FULL.id, { tags: [...FULL.tags, 'halide'] })
  })

  it('removes one tag and keeps the rest', async () => {
    const props = mount(FULL)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '移除标签「snse」' }))
    })
    expect(props.update).toHaveBeenCalledWith(FULL.id, { tags: ['thermoelectric', 'doping'] })
  })

  it('writes the status the select was moved to', async () => {
    const props = mount(FULL)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'verified' } })
    })
    expect(props.update).toHaveBeenCalledWith(FULL.id, { status: 'verified' })
  })

  it('lets the note rest before it is written, and writes it once', async () => {
    vi.useFakeTimers()
    try {
      const props = mount(FULL)
      const field = screen.getByLabelText('笔记')
      fireEvent.change(field, { target: { value: '第一稿' } })
      fireEvent.change(field, { target: { value: '第二稿' } })
      expect(props.update).not.toHaveBeenCalled()

      await act(async () => { vi.advanceTimersByTime(NOTE_DEBOUNCE_MS) })
      expect(props.update).toHaveBeenCalledTimes(1)
      expect(props.update).toHaveBeenCalledWith(FULL.id, { note: '第二稿' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a note equal to the stored one alone', async () => {
    vi.useFakeTimers()
    try {
      const props = mount(FULL)
      fireEvent.change(screen.getByLabelText('笔记'), { target: { value: 'draft' } })
      fireEvent.change(screen.getByLabelText('笔记'), { target: { value: FULL.note as string } })
      await act(async () => { vi.advanceTimersByTime(NOTE_DEBOUNCE_MS) })
      expect(props.update).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the note of an entry that has none as an empty field', () => {
    mount(BARE)
    expect(screen.getByLabelText<HTMLTextAreaElement>('笔记').value).toBe('')
  })

  it('says a write is out, then states the host code when it is refused', async () => {
    let settle = (_outcome: unknown): void => {}
    const update = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    mount(FULL, { update } as unknown as Partial<EntryDetailProps>)

    fireEvent.change(screen.getByLabelText('添加标签'), { target: { value: 'halide' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加标签' })) })
    expect(screen.getByText('保存中…')).toBeTruthy()
    expect(screen.getByLabelText('状态').hasAttribute('disabled')).toBe(true)

    await act(async () => { settle({ ok: false, code: 'LIBRARY_NOT_FOUND' }) })
    expect(screen.getByRole('alert').textContent).toBe('保存失败（LIBRARY_NOT_FOUND）。')
  })
})

describe('EntryDetail files', () => {
  it('offers a preview and a download for each stored file', () => {
    mount(FULL)
    expect(screen.getByText('snse.pdf')).toBeTruthy()
    expect(screen.getByText('2.3 MB · application/pdf')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '预览' })).toHaveLength(2)
    const download = screen.getAllByRole('link', { name: '下载' })[0]
    expect(download?.getAttribute('href'))
      .toBe('/library-api/file?entryId=doi%3A10.1038%2Fs41586-024-07001-2&name=snse.pdf')
  })

  it('offers only the download for a file it cannot draw', () => {
    mount({ ...FULL, files: [HUGE_FILE] })
    expect(screen.queryByRole('button', { name: '预览' })).toBeNull()
    expect(screen.getByRole('link', { name: '下载' })).toBeTruthy()
  })

  it('renders a PDF from the library route rather than reading its bytes', () => {
    const props = mount({ ...FULL, files: [PDF_FILE] })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    const frame = document.querySelector('embed')
    expect(frame?.getAttribute('src'))
      .toBe('/library-api/file?entryId=doi%3A10.1038%2Fs41586-024-07001-2&name=snse.pdf')
    expect(props.readText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '收起预览' }))
    expect(document.querySelector('embed')).toBeNull()
  })

  it('renders an image from the same route', () => {
    const image = { ...PDF_FILE, name: 'plot.png', mediaType: 'image/png', size: 12_000 }
    mount({ ...FULL, files: [image] })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.getByRole('img', { name: 'plot.png' }).getAttribute('src'))
      .toBe('/library-api/file?entryId=doi%3A10.1038%2Fs41586-024-07001-2&name=plot.png')
  })

  it('fetches the text of a source file and shows it', async () => {
    const props = mount({ ...FULL, files: [CSV_FILE] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览' })) })
    expect(props.readText).toHaveBeenCalledWith(FULL.id, 'zt.csv')
    expect(screen.getByText(/a,b/u)).toBeTruthy()
  })

  it('renders a markdown file as prose', async () => {
    const md = { ...CSV_FILE, name: 'notes.md', mediaType: 'text/markdown' }
    mount({ ...FULL, files: [md] }, {
      readText: vi.fn(async () => ({ ok: true, text: '# 标题' })),
    } as unknown as Partial<EntryDetailProps>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览' })) })
    expect(screen.getByRole('heading', { name: '标题' })).toBeTruthy()
  })

  it('says it is reading, then states a file it could not read', async () => {
    let settle = (_outcome: unknown): void => {}
    const readText = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    mount({ ...FULL, files: [CSV_FILE] }, { readText } as unknown as Partial<EntryDetailProps>)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览' })) })
    expect(screen.getByText('正在读取文件…')).toBeTruthy()

    await act(async () => { settle({ ok: false, code: 'LIBRARY_FILE_HTTP_404' }) })
    expect(screen.getByRole('alert').textContent).toBe('读不出这个文件（LIBRARY_FILE_HTTP_404）。')
  })

  it('drops a read that lands after the preview is gone', async () => {
    let settle = (_outcome: unknown): void => {}
    const readText = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    mount({ ...FULL, files: [CSV_FILE] }, { readText } as unknown as Partial<EntryDetailProps>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览' })) })

    // Collapsing the preview unmounts the pane; the late answer must not set
    // state on it.
    fireEvent.click(screen.getByRole('button', { name: '收起预览' }))
    await act(async () => { settle({ ok: true, text: 'a,b' }) })
    expect(screen.queryByText(/a,b/u)).toBeNull()
  })

  it('says so when the entry carries no file, and still offers the upload', () => {
    mount(BARE)
    expect(screen.getByText('这条记录还没有文件。')).toBeTruthy()
    expect(screen.getByLabelText('上传到本条')).toBeTruthy()
  })

  it('uploads into this entry and reports the entry the route returned', async () => {
    const props = mount(FULL)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('上传到本条'), {
        target: { files: [new File(['%PDF'], 'extra.pdf', { type: 'application/pdf' })] },
      })
    })
    expect(props.upload).toHaveBeenCalledWith({
      entryId: FULL.id, kind: 'paper', file: expect.any(File) as File,
    })
    expect(props.onPatched).toHaveBeenCalledWith(BARE)
  })
})

describe('EntryDetail actions', () => {
  it('points 「打开 PDF」 at the stored PDF, and offers none without one', () => {
    mount(FULL)
    expect(screen.getByRole('link', { name: '打开 PDF' }).getAttribute('href'))
      .toBe('/library-api/file?entryId=doi%3A10.1038%2Fs41586-024-07001-2&name=snse.pdf')
    cleanup()

    mount(BARE)
    expect(screen.queryByRole('link', { name: '打开 PDF' })).toBeNull()
  })

  it('copies the BibTeX entry and says whether the clipboard took it', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(FULL)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制引用' })) })
    expect(writeText.mock.calls[0]?.[0]).toContain('@article{Zhao2024,')
    expect(screen.getByText('已复制 BibTeX')).toBeTruthy()
  })

  it('says the copy failed where the browser took nothing', async () => {
    mount(FULL)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制引用' })) })
    expect(screen.getByText('复制失败，请手动选取。')).toBeTruthy()
  })

  it('has the host save the open-access PDF, and states a refusal', async () => {
    const props = mount(FULL)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存 OA PDF 到库' })) })
    expect(props.fetchPdf).toHaveBeenCalledWith(FULL.id)
    expect(props.onPatched).toHaveBeenCalledWith(FULL)
    cleanup()

    const failing = mount(FULL, {
      fetchPdf: vi.fn(async () => ({ ok: false, code: 'LIBRARY_NOT_A_PDF' })),
    } as unknown as Partial<EntryDetailProps>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存 OA PDF 到库' })) })
    expect(screen.getByRole('alert').textContent).toBe('拉取 OA PDF 失败（LIBRARY_NOT_A_PDF）。')
    expect(failing.onPatched).not.toHaveBeenCalled()
  })

  it('says it is fetching while the host is still out', async () => {
    mount(FULL, { fetchPdf: vi.fn(() => new Promise(() => {})) } as unknown as Partial<EntryDetailProps>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存 OA PDF 到库' })) })
    expect(screen.getByRole('button', { name: '正在拉取…' }).hasAttribute('disabled')).toBe(true)
  })

  it('offers no OA fetch for an entry with no open-access url', () => {
    mount(BARE)
    expect(screen.queryByRole('button', { name: '保存 OA PDF 到库' })).toBeNull()
  })

  it('deletes only after a second, explicit confirmation', async () => {
    const props = mount(FULL)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(props.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })) })
    expect(props.remove).toHaveBeenCalledWith(FULL.id)
    expect(props.onRemoved).toHaveBeenCalledWith(FULL.id)
  })

  it('states a refused delete and leaves the entry where it is', async () => {
    const props = mount(FULL, {
      remove: vi.fn(async () => ({ ok: false, code: 'LIBRARY_NOT_FOUND' })),
    } as unknown as Partial<EntryDetailProps>)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })) })

    expect(props.onRemoved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('删除失败（LIBRARY_NOT_FOUND）。')
    expect(screen.getByRole('button', { name: '删除' })).toBeTruthy()
  })
})

describe('EntryDetail related entries', () => {
  it('opens one related entry', () => {
    const props = mount(FULL)
    fireEvent.click(screen.getByText(BARE.title))
    expect(props.onOpen).toHaveBeenCalledWith(BARE.id)
  })

  it('says so when the host scores nothing as related', () => {
    mount(FULL, { related: [] })
    expect(screen.getByText('库里还没有与它相关的条目。')).toBeTruthy()
  })

  it('draws the year of a related entry that has one', () => {
    mount(BARE, { related: [FULL] })
    expect(screen.getByText('2024')).toBeTruthy()
  })
})

describe('EntryDetail busy discipline', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('refuses a second tag write while the first is out', async () => {
    const update = vi.fn(() => new Promise(() => {}))
    mount(FULL, { update } as unknown as Partial<EntryDetailProps>)
    fireEvent.change(screen.getByLabelText('添加标签'), { target: { value: 'halide' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加标签' })) })

    expect(screen.getByLabelText('添加标签').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '移除标签「snse」' }).hasAttribute('disabled')).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
