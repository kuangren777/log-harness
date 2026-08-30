// @vitest-environment jsdom
/**
 * The panel header: what it says about a selection with and without a read
 * behind it, which gestures stay inert until there is one, and the download
 * it assembles from the bytes the preview already has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SciFileContent } from '../src/client/contract.ts'
import { PanelHeader, type PanelHeaderProps } from '../src/client/PanelHeader.tsx'
import { toBlob, triggerDownload } from '../src/client/download.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function content(overrides: Partial<SciFileContent> = {}): SciFileContent {
  return {
    path: '/p/deliverables/report.md', size: 2048, mediaType: 'text/markdown', encoding: 'utf8', content: '# Title',
    ...overrides,
  }
}

/** Mount the header over one selection, returning every gesture spy. */
function header(overrides: Partial<PanelHeaderProps> = {}) {
  const onView = vi.fn()
  const onDownload = vi.fn()
  const onClose = vi.fn()
  const props: PanelHeaderProps = {
    path: '/p/deliverables/report.md',
    file: content(),
    view: 'preview',
    canSource: true,
    onView,
    onDownload,
    onClose,
    t: makeTranslate(zh),
    ...overrides,
  }
  render(<PanelHeader {...props} />)
  return { onView, onDownload, onClose }
}

describe('PanelHeader', () => {
  it('names the file from its path and sizes it from the read', () => {
    header()
    expect(screen.getByText('report.md')).toBeTruthy()
    expect(screen.getByText('2 KB · text/markdown')).toBeTruthy()
    expect(screen.getByText('MD')).toBeTruthy()
  })

  it('badges the extension in at most four characters, uppercased', () => {
    header({ path: '/p/w/slides.pptx', file: null })
    expect(screen.getByText('PPTX')).toBeTruthy()
    cleanup()
    header({ path: '/p/w/book.univer', file: null })
    expect(screen.getByText('UNIV')).toBeTruthy()
  })

  it('badges an extensionless file with the head of its own name', () => {
    header({ path: '/p/Makefile', file: null })
    expect(screen.getByText('MAKE')).toBeTruthy()
    expect(screen.getByText('Makefile')).toBeTruthy()
  })

  it('says nothing about a file when nothing is selected', () => {
    header({ path: undefined, file: null })
    expect(screen.getByText(zh['panel.empty'])).toBeTruthy()
    expect(screen.queryByText(/KB/)).toBeNull()
  })

  it('omits the size line for a document no read produced bytes for', () => {
    header({ path: '/p/w/book.univer', file: null })
    expect(screen.queryByText(/text\/markdown/)).toBeNull()
  })

  it('switches the reading, and refuses to offer one the file does not have', () => {
    const spies = header()
    fireEvent.click(screen.getByText(zh['panel.source']))
    expect(spies.onView).toHaveBeenCalledWith('source')
    fireEvent.click(screen.getByText(zh['panel.preview']))
    expect(spies.onView).toHaveBeenCalledWith('preview')
    expect(screen.getByText(zh['panel.preview']).getAttribute('aria-pressed')).toBe('true')

    cleanup()
    const inert = header({ canSource: false })
    const source = screen.getByText(zh['panel.source']) as HTMLButtonElement
    expect(source.disabled).toBe(true)
    fireEvent.click(source)
    expect(inert.onView).not.toHaveBeenCalled()
  })

  it('marks the active reading', () => {
    header({ view: 'source' })
    expect(screen.getByText(zh['panel.source']).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(zh['panel.preview']).getAttribute('aria-pressed')).toBe('false')
  })

  it('drives the close gesture, and offers no width control', () => {
    const spies = header()
    fireEvent.click(screen.getByLabelText(zh['panel.close']))
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    // The column's width is the frame's fixed share: nothing here changes it.
    expect(screen.queryByLabelText('展开 / 还原')).toBeNull()
  })

  it('offers the download only once bytes have arrived', () => {
    const spies = header()
    fireEvent.click(screen.getByLabelText(zh['panel.download']))
    expect(spies.onDownload).toHaveBeenCalledTimes(1)

    cleanup()
    const inert = header({ file: null })
    const button = screen.getByLabelText(zh['panel.download']) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(inert.onDownload).not.toHaveBeenCalled()
  })
})

describe('download', () => {
  const objectUrls: string[] = []
  let revokeObjectURL = vi.fn<(url: string) => void>()

  beforeEach(() => {
    objectUrls.length = 0
    revokeObjectURL = vi.fn<(url: string) => void>()
    // jsdom implements neither half of the object-URL pair.
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        const url = `blob:mock/${String(objectUrls.length)}`
        objectUrls.push(url)
        return url
      }),
      revokeObjectURL,
    }))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('carries UTF-8 content and its media type into the blob', async () => {
    const blob = toBlob(content({ content: '# Title', mediaType: 'text/markdown' }))
    expect(blob.type).toBe('text/markdown')
    await expect(blob.text()).resolves.toBe('# Title')
  })

  it('decodes base64 content rather than saving its transport spelling', async () => {
    const blob = toBlob(content({ path: '/p/a.png', mediaType: 'image/png', encoding: 'base64', content: 'aGk=' }))
    expect(blob.type).toBe('image/png')
    await expect(blob.text()).resolves.toBe('hi')
  })

  it('saves through an anchor named by the file, releasing the URL with the click', () => {
    const clicks: string[] = []
    const anchor = document.createElement('a')
    anchor.click = () => {
      clicks.push(`${anchor.download}|${anchor.getAttribute('href') ?? ''}|${String(document.body.contains(anchor))}`)
    }
    const doc = {
      createElement: vi.fn(() => anchor),
      body: document.body,
    } as unknown as Document

    triggerDownload(content(), doc)
    // Named by the file, pointed at the blob, and in the document when clicked.
    expect(clicks).toEqual(['report.md|blob:mock/0|true'])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock/0')
    // The transient anchor does not outlive the download.
    expect(document.body.contains(anchor)).toBe(false)
  })
})
