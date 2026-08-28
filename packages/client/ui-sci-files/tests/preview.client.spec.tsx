// @vitest-environment jsdom
/**
 * The preview pane: the empty seat, every read-failure state, the renderer
 * each media type lands on, and the office frame's three outcomes (connected,
 * read-only, runtime absent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  FileReadErrorCode, FileReadOutcome, OfficeStateOutcome, SciFileContent,
} from '../src/client/contract.ts'
import type { SciFilesKey } from '../src/client/locales.ts'
import { FilePreview } from '../src/client/FilePreview.tsx'
import { OfficeFrame } from '../src/client/OfficeFrame.tsx'

const SESSION = 's1' as SessionId
const t: Translate<SciFilesKey> = (key, params) =>
  params === undefined ? key : `${key}(${Object.values(params).join('|')})`

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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function content(overrides: Partial<SciFileContent> = {}): SciFileContent {
  return {
    path: '/p/notes.md', size: 12, mediaType: 'text/markdown', encoding: 'utf8', content: '# Title',
    ...overrides,
  }
}

/** Mount the preview over one settled read outcome. */
async function preview(path: string | undefined, outcome: FileReadOutcome, office?: OfficeStateOutcome) {
  const readFile = vi.fn(async (): Promise<FileReadOutcome> => outcome)
  const officeState = vi.fn(async (): Promise<OfficeStateOutcome> => office ?? { ok: false })
  const view = render(
    <FilePreview sessionId={SESSION} path={path} readFile={readFile} officeState={officeState} t={t} />,
  )
  // Let the read (and any office follow-up) settle before asserting.
  await act(async () => {})
  return { view, readFile, officeState }
}

describe('FilePreview', () => {
  it('asks for a file before showing one', async () => {
    const { readFile } = await preview(undefined, { ok: true, file: content() })
    expect(screen.getByText('preview.none')).toBeTruthy()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('shows the reading note until the read settles', async () => {
    let settle: (outcome: FileReadOutcome) => void = () => {}
    const readFile = vi.fn(async () => new Promise<FileReadOutcome>((resolve) => { settle = resolve }))
    render(
      <FilePreview
        sessionId={SESSION} path="/p/notes.md" readFile={readFile}
        officeState={vi.fn(async (): Promise<OfficeStateOutcome> => ({ ok: false }))} t={t}
      />,
    )
    expect(screen.getByText('preview.loading')).toBeTruthy()
    await act(async () => { settle({ ok: true, file: content() }) })
    expect(screen.getByText('Title')).toBeTruthy()
  })

  it('drops a read that settles after the pane is gone', async () => {
    let settle: (outcome: FileReadOutcome) => void = () => {}
    const readFile = vi.fn(async () => new Promise<FileReadOutcome>((resolve) => { settle = resolve }))
    const view = render(
      <FilePreview
        sessionId={SESSION} path="/p/notes.md" readFile={readFile}
        officeState={vi.fn(async (): Promise<OfficeStateOutcome> => ({ ok: false }))} t={t}
      />,
    )
    view.unmount()
    await act(async () => { settle({ ok: true, file: content() }) })
    expect(screen.queryByText('Title')).toBeNull()
  })

  it('gives every read failure its own reason', async () => {
    const codes: readonly FileReadErrorCode[] = [
      'file-not-found', 'not-a-file', 'file-too-large', 'path-out-of-scope',
      'session-not-found', 'cancelled', 'internal',
    ]
    for (const code of codes) {
      await preview('/p/gone.md', { ok: false, code })
      expect(screen.getByRole('alert').textContent).toBe(`preview.error.${code}`)
      cleanup()
    }
  })

  it('renders markdown as prose, with no size line to read past', async () => {
    await preview('/p/notes.md', { ok: true, file: content({ content: '# Title\n\nbody' }) })
    expect(screen.getByText('Title').tagName).toBe('H1')
    expect(screen.queryByText(/preview\.size/)).toBeNull()
  })

  it('renders source as highlighted code under its size line', async () => {
    await preview('/p/main.py', {
      ok: true,
      file: content({ path: '/p/main.py', mediaType: 'text/x-python', content: 'print(1)', size: 8 }),
    })
    expect(screen.getByText('preview.size(8 B|text/x-python)')).toBeTruthy()
    expect(screen.getByText(/print/)).toBeTruthy()
  })

  it('renders an image from a data URL, named by its file', async () => {
    await preview('/p/fig.png', {
      ok: true,
      file: content({ path: '/p/fig.png', mediaType: 'image/png', encoding: 'base64', content: 'AAA=', size: 3 }),
    })
    const image = screen.getByRole('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAA=')
    expect(image.alt).toBe('fig.png')
  })

  it('hands a PDF to the browser viewer through a blob URL, released with the pane', async () => {
    const { view } = await preview('/p/paper.pdf', {
      ok: true,
      file: content({ path: '/p/paper.pdf', mediaType: 'application/pdf', encoding: 'base64', content: 'JVBERi0=', size: 6 }),
    })
    const embed = view.container.querySelector('embed')
    expect(embed?.getAttribute('type')).toBe('application/pdf')
    expect(embed?.getAttribute('src')).toBe(objectUrls[0])
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrls[0])
  })

  it('states that opaque bytes cannot be previewed, and says how many there are', async () => {
    await preview('/p/data.bin', {
      ok: true,
      file: content({
        path: '/p/data.bin', mediaType: 'application/octet-stream', encoding: 'base64', content: 'AAAA', size: 2048,
      }),
    })
    expect(screen.getByText('preview.size(2 KB|application/octet-stream)')).toBeTruthy()
    expect(screen.getByText('preview.binary')).toBeTruthy()
  })

  it('frames an office path without reading a byte of it', async () => {
    const { readFile } = await preview('/p/w/book.univer', { ok: true, file: content() }, {
      ok: true, viewerUrl: '/univer-gw/?file=x', gatewayRunning: true,
    })
    expect(readFile).not.toHaveBeenCalled()
    expect(screen.getByTitle('office.title(book.univer)')).toBeTruthy()
  })

  it('frames a file the backend labelled office even when its path did not say so', async () => {
    await preview('/p/w/sheet', {
      ok: true,
      file: content({ path: '/p/w/sheet', mediaType: 'application/x-univer', content: '' }),
    }, { ok: true, viewerUrl: '/univer-gw/?file=x', gatewayRunning: true })
    expect(screen.getByTitle('office.title(sheet)')).toBeTruthy()
  })
})

describe('OfficeFrame', () => {
  /** Mount the frame over one settled runtime answer. */
  async function frame(outcome: OfficeStateOutcome, path = '/p/w/book.univer') {
    const officeState = vi.fn(async (): Promise<OfficeStateOutcome> => outcome)
    const view = render(<OfficeFrame sessionId={SESSION} path={path} officeState={officeState} t={t} />)
    await act(async () => {})
    return { view, officeState }
  }

  it('waits for the runtime before drawing anything', async () => {
    const officeState = vi.fn(async () => new Promise<OfficeStateOutcome>(() => {}))
    render(<OfficeFrame sessionId={SESSION} path="/p/w/book.univer" officeState={officeState} t={t} />)
    expect(screen.getByText('office.loading')).toBeTruthy()
  })

  it('grants editing on the trunk while collaboration is connected', async () => {
    const { view } = await frame({ ok: true, viewerUrl: '/univer-gw/?file=%2Fp%2Fbook.univer', gatewayRunning: true })
    expect(screen.getByText('office.connected')).toBeTruthy()
    expect(view.container.querySelector('iframe')?.getAttribute('src'))
      .toBe('/univer-gw/?file=%2Fp%2Fbook.univer&mode=embedded&scope=trunk&editable=true')
  })

  it('bounds the frame to the capabilities the Viewer needs', async () => {
    const { view } = await frame({ ok: true, viewerUrl: '/univer-gw/?file=a', gatewayRunning: true })
    const sandbox = view.container.querySelector('iframe')?.getAttribute('sandbox')
    // allow-same-origin is required for the Gateway WebSocket's session
    // cookie; the capabilities NOT granted are the point of the assertion.
    expect(sandbox).toBe('allow-scripts allow-same-origin allow-forms')
    for (const denied of ['allow-popups', 'allow-top-navigation', 'allow-downloads', 'allow-modals']) {
      expect(sandbox).not.toContain(denied)
    }
  })

  it('falls back to a read-only frame when the Gateway is down', async () => {
    const { view } = await frame({ ok: true, viewerUrl: '/univer-gw/?file=a', gatewayRunning: false })
    expect(screen.getByText('office.readonly')).toBeTruthy()
    expect(view.container.querySelector('iframe')?.getAttribute('src'))
      .toBe('/univer-gw/?file=a&mode=embedded&scope=trunk&editable=false')
  })

  it('states the runtime is unavailable instead of framing nothing', async () => {
    const absent = await frame({ ok: false })
    expect(screen.getByRole('alert').textContent).toBe('office.unavailable')
    expect(absent.view.container.querySelector('iframe')).toBeNull()
    cleanup()
    // The runtime answered, but holds no Viewer target for this document.
    const targetless = await frame({ ok: true, viewerUrl: null, gatewayRunning: true })
    expect(screen.getByRole('alert').textContent).toBe('office.unavailable')
    expect(targetless.view.container.querySelector('iframe')).toBeNull()
  })

  it('drops a runtime answer that arrives after the frame is gone', async () => {
    let settle: (outcome: OfficeStateOutcome) => void = () => {}
    const officeState = vi.fn(async () => new Promise<OfficeStateOutcome>((resolve) => { settle = resolve }))
    const view = render(<OfficeFrame sessionId={SESSION} path="/p/w/book.univer" officeState={officeState} t={t} />)
    view.unmount()
    await act(async () => { settle({ ok: true, viewerUrl: '/univer-gw/?file=a', gatewayRunning: true }) })
    expect(screen.queryByText('office.connected')).toBeNull()
  })
})
