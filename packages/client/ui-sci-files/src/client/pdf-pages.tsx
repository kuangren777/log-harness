/**
 * Native in-panel PDF rendering over pdf.js, replacing the browser's plugin
 * `<embed>`: the plugin drew its own chrome and a dark backdrop that fought
 * the workbench palette, and headless or plugin-less browsers showed nothing
 * at all. Here every page is a canvas the panel styles like the rest of the
 * product — paper on the panel's own background.
 *
 * pdf.js normally spawns a Web Worker from a separate script URL, which this
 * plugin's single-file client bundle cannot serve. Importing the worker
 * module and publishing it as `globalThis.pdfjsWorker` makes pdf.js take its
 * main-thread path instead (its documented fallback), so no second file and
 * no worker URL exist. Parsing on the main thread is acceptable at preview
 * sizes; the read RPC already caps the bytes.
 *
 * Pages render in batches of {@link PAGE_BATCH} so a hundred-page document
 * does not freeze the panel on selection; the remainder renders on an
 * explicit gesture that names the real count.
 */
import { useEffect, useRef, useState } from 'react'
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { SciFileContent } from './contract.ts'
import type { SciFilesKey } from './locales.ts'
import { decodeBase64 } from './download.ts'
import css from './FilePreview.module.css'

;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker

/** Pages rendered per gesture; the first batch renders on selection. */
const PAGE_BATCH = 8

/** Canvas backing-store scale cap: crisp on retina without runaway memory. */
const MAX_RENDER_SCALE = 2

/** What the pane knows about the document it is rendering. */
type PdfState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly pageCount: number }

/**
 * Render one PDF's pages as canvases, batch by batch.
 * @param props - the read file (base64 bytes) and the locale seat.
 * @returns the page stack with its count line, a loading line, or the stated failure.
 */
export function PdfPages({ file, t }: { file: SciFileContent; t: Translate<SciFilesKey> }) {
  const [state, setState] = useState<PdfState>({ phase: 'loading' })
  const [shown, setShown] = useState(PAGE_BATCH)
  const holder = useRef<HTMLDivElement | null>(null)
  const doc = useRef<PDFDocumentProxy | null>(null)

  // Parse once per content; destroying the loading task on unmount also
  // cancels an in-flight parse so a quick reselection does not stack work.
  useEffect(() => {
    setState({ phase: 'loading' })
    setShown(PAGE_BATCH)
    const task = getDocument({ data: decodeBase64(file.content) })
    let live = true
    task.promise.then((loaded) => {
      if (!live) return
      doc.current = loaded
      setState({ phase: 'ready', pageCount: loaded.numPages })
    }, () => {
      if (live) setState({ phase: 'error' })
    })
    return () => {
      live = false
      doc.current = null
      void task.destroy()
    }
  }, [file.content])

  // Render the visible batch. Sequential on purpose: parallel page renders
  // fight over the main-thread worker and the panel scrolls top-down anyway.
  useEffect(() => {
    if (state.phase !== 'ready') return
    const container = holder.current
    const document_ = doc.current
    /* v8 ignore next -- both are set in the same commit that set phase ready. */
    if (container === null || document_ === null) return
    // A box, not a bare let: the loop reads it across awaits and the linter's
    // flow analysis cannot see the cleanup's write through a closure.
    const live = { current: true }
    const render = async () => {
      const width = container.clientWidth || 640
      const scale = Math.min(MAX_RENDER_SCALE, globalThis.devicePixelRatio || 1)
      for (let index = 0; index < Math.min(state.pageCount, shown); index += 1) {
        if (!live.current) return
        let canvas = container.children[index] as HTMLCanvasElement | undefined
        if (canvas?.dataset['rendered'] === 'true') continue
        if (canvas === undefined) {
          canvas = container.ownerDocument.createElement('canvas')
          canvas.className = css['pdfPage'] as string
          container.append(canvas)
        }
        const page = await document_.getPage(index + 1)
        // The cleanup writes live.current across this await; the analyzer cannot see it.
        // eslint-disable-next-line typescript/no-unnecessary-condition
        if (!live.current) return
        const base = page.getViewport({ scale: 1 })
        const cssScale = width / base.width
        const viewport = page.getViewport({ scale: cssScale * scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(width)}px`
        const context = canvas.getContext('2d')
        /* v8 ignore next -- a 2d context exists on every canvas this creates. */
        if (context === null) continue
        await page.render({ canvas, canvasContext: context, viewport }).promise
        canvas.dataset['rendered'] = 'true'
      }
    }
    void render().catch(() => { if (live.current) setState({ phase: 'error' }) })
    return () => { live.current = false }
  }, [state, shown])

  if (state.phase === 'loading') return <div className={css.note}>{t('preview.pdfRendering')}</div>
  if (state.phase === 'error') return <div className={css.note} role="alert">{t('preview.pdfFailed')}</div>
  const remaining = state.pageCount - shown
  return (
    <div className={css.pdfWrap}>
      <div className={css.pdfMeta}>{t('preview.pdfPages', { count: state.pageCount })}</div>
      <div ref={holder} className={css.pdfStack} />
      {remaining > 0 && (
        <button
          type="button"
          className={css.pdfMore}
          onClick={() => { setShown(count => count + PAGE_BATCH) }}
        >
          {t('preview.pdfMore', { count: remaining })}
        </button>
      )}
    </div>
  )
}
