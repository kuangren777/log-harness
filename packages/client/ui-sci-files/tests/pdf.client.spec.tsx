// @vitest-environment jsdom
/**
 * The native PDF pane: parse lifecycle, the batched canvas render loop, the
 * explicit remainder gesture, and every way a document refuses to draw.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({ promise: new Promise(() => {}), destroy: vi.fn() })),
}))
vi.mock('pdfjs-dist/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }))

import { getDocument } from 'pdfjs-dist'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PdfPages } from '../src/client/pdf-pages.tsx'
import { zh } from '../src/client/locales.ts'
import type { SciFileContent } from '../src/client/contract.ts'

const t = makeTranslate(zh)

/** One read PDF as the preview hands it over. */
const FILE: SciFileContent = {
  path: '/p/paper.pdf', mediaType: 'application/pdf', encoding: 'base64', content: 'JVBERi0=', size: 6,
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A pdf.js page double whose render resolves at once. */
function pageOf(width = 100, height = 140) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  }
}

/** Stub one parse outcome on the mocked module. */
function stubDocument(pages: number, page = pageOf()) {
  const destroy = vi.fn()
  const getPage = vi.fn(async () => page)
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({ numPages: pages, getPage }),
    destroy,
  } as never)
  return { destroy, getPage }
}

/** jsdom canvases have no 2d context; hand them an inert one. */
function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
}

describe('PdfPages', () => {
  it('renders the first batch as canvases and skips pages already drawn', async () => {
    stubCanvas()
    const b = stubDocument(2)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    expect(screen.getByText('共 2 页')).toBeTruthy()
    const canvases = view.container.querySelectorAll('canvas')
    expect(canvases).toHaveLength(2)
    expect([...canvases].every(canvas => canvas.dataset['rendered'] === 'true')).toBe(true)
    expect(b.getPage).toHaveBeenCalledTimes(2)

    // Re-render (same state): the drawn pages are skipped, not redrawn.
    view.rerender(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    expect(b.getPage).toHaveBeenCalledTimes(2)
  })

  it('caps the first pass at eight pages and renders the rest on the stated gesture', async () => {
    stubCanvas()
    const b = stubDocument(11)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    expect(view.container.querySelectorAll('canvas')).toHaveLength(8)

    await act(async () => { fireEvent.click(screen.getByText('继续渲染剩余 3 页')) })
    await act(async () => {})
    expect(view.container.querySelectorAll('canvas')).toHaveLength(11)
    expect(screen.queryByText(/继续渲染/)).toBeNull()
    expect(b.getPage).toHaveBeenCalledTimes(11)
  })

  it('says it is rendering until the parse lands, and destroys the task with the pane', async () => {
    const destroy = vi.fn()
    vi.mocked(getDocument).mockReturnValue({ promise: new Promise(() => {}), destroy } as never)
    const view = render(<PdfPages file={FILE} t={t} />)
    expect(screen.getByText('正在渲染 PDF…')).toBeTruthy()
    view.unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('ignores a parse that settles after the pane is gone', async () => {
    let settle: (value: { numPages: number; getPage: () => unknown }) => void = () => {}
    let reject: (reason: Error) => void = () => {}
    vi.mocked(getDocument)
      .mockReturnValueOnce({ promise: new Promise((res) => { settle = res }), destroy: vi.fn() } as never)
      .mockReturnValueOnce({ promise: new Promise((_res, rej) => { reject = rej }), destroy: vi.fn() } as never)
    const first = render(<PdfPages file={FILE} t={t} />)
    first.unmount()
    await act(async () => { settle({ numPages: 3, getPage: () => pageOf() }) })

    const second = render(<PdfPages file={FILE} t={t} />)
    second.unmount()
    await act(async () => { reject(new Error('late')) })
    // Neither late settlement threw or rendered anything into a dead pane.
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
  })

  it('states a document that would not parse', async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.reject(new Error('bad pdf')), destroy: vi.fn(),
    } as never)
    render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('这份 PDF 无法解析。')
  })

  it('states a page that failed mid-render rather than hanging the stack', async () => {
    stubCanvas()
    const destroy = vi.fn()
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => { throw new Error('render boom') }) }),
      destroy,
    } as never)
    render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe('这份 PDF 无法解析。')
  })


  it('re-runs the batch over existing undrawn canvases after the gesture', async () => {
    // No 2d context: canvases exist but stay undrawn; the second pass walks
    // over them (existing, unrendered) instead of minting duplicates.
    const b = stubDocument(9)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    expect(view.container.querySelectorAll('canvas')).toHaveLength(8)
    await act(async () => { fireEvent.click(screen.getByText('继续渲染剩余 1 页')) })
    await act(async () => {})
    expect(view.container.querySelectorAll('canvas')).toHaveLength(9)
    expect(b.getPage.mock.calls.length).toBeGreaterThanOrEqual(9)
  })

  it('stops the loop cold when the pane unmounts mid-render, and swallows a late page error', async () => {
    stubCanvas()
    vi.stubGlobal('devicePixelRatio', 0)
    let releaseRender: () => void = () => {}
    let rejectPage: (reason: Error) => void = () => {}
    const slowPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
      render: vi.fn(() => ({ promise: new Promise<void>((res) => { releaseRender = res }) })),
    }
    const getPage = vi.fn()
      .mockImplementationOnce(async () => slowPage)
      .mockImplementationOnce(() => new Promise((_res, rej) => { rejectPage = rej }))
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
      destroy: vi.fn(),
    } as never)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    view.unmount()
    // Page one settles after unmount: the loop returns instead of touching
    // page two; a second pane's page error after ITS unmount stays silent.
    await act(async () => { releaseRender() })
    expect(getPage).toHaveBeenCalledTimes(1)

    const second = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    second.unmount()
    await act(async () => { rejectPage(new Error('late boom')) })
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
    vi.unstubAllGlobals()
  })


  it('drops a page fetched after the pane is gone before sizing any canvas', async () => {
    stubCanvas()
    let releasePage: (page: unknown) => void = () => {}
    const getPage = vi.fn(() => new Promise((res) => { releasePage = res }))
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
      destroy: vi.fn(),
    } as never)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    view.unmount()
    await act(async () => { releasePage(pageOf()) })
    const canvas = document.querySelector('canvas')
    expect(canvas?.dataset['rendered']).toBeUndefined()
  })

  it('leaves a canvas undrawn when jsdom hands back no 2d context, without marking it rendered', async () => {
    stubDocument(1)
    const view = render(<PdfPages file={FILE} t={t} />)
    await act(async () => {})
    const canvas = view.container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.dataset['rendered']).toBeUndefined()
  })
})
