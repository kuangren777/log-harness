/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer, so the
 * CaMeL Science brand is inlined here rather than read from `ui-brand-sci`.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** SVG namespace for the framework-free orbit glyph. */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Rotations (degrees, about the 24×24 viewBox centre) of the three orbits. */
const ORBITS = [0, 60, 120] as const

/** Share of the progress track already filled before the first activation. */
const PROGRESS_FLOOR = 8

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Create a span with one module class and its text. */
function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  return el
}

/**
 * Build the CaMeL Science orbit glyph: three ellipses rotated 0°/60°/120°
 * around a filled nucleus, drawn in `currentColor` so the card owns the hue.
 * Geometry matches `ui-brand-sci`'s `SciLogo` exactly.
 * @returns the glyph as a detached inline SVG element.
 */
function orbitGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', css.glyphSvg ?? '')
  ORBITS.forEach((rotation, index) => {
    const orbit = document.createElementNS(SVG_NS, 'ellipse')
    orbit.setAttribute('cx', '12')
    orbit.setAttribute('cy', '12')
    orbit.setAttribute('rx', '9.2')
    orbit.setAttribute('ry', '3.9')
    orbit.setAttribute('fill', 'none')
    orbit.setAttribute('stroke', 'currentColor')
    orbit.setAttribute('stroke-width', '1.5')
    orbit.setAttribute('transform', `rotate(${String(rotation)} 12 12)`)
    orbit.setAttribute('class', css.orbit ?? '')
    orbit.style.setProperty('--dsh-boot-orbit-delay', `${String(index * 0.4)}s`)
    svg.append(orbit)
  })
  const nucleus = document.createElementNS(SVG_NS, 'circle')
  nucleus.setAttribute('cx', '12')
  nucleus.setAttribute('cy', '12')
  nucleus.setAttribute('r', '2.1')
  nucleus.setAttribute('fill', 'currentColor')
  nucleus.setAttribute('class', css.nucleus ?? '')
  svg.append(nucleus)
  return svg
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly glyph: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly status: HTMLDivElement
  private readonly track: HTMLDivElement
  private readonly count: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div(css.boot)
    this.root.dataset.dshBoot = ''
    this.root.append(this.aurora())
    this.card = div(css.card)
    this.glyph = div(css.glyph)
    this.glyph.dataset.dshBootSpinner = ''
    this.glyph.dataset.sciMotion = ''
    this.glyph.append(orbitGlyph())
    this.wordmark = div(css.wordmark)
    this.wordmark.append(document.createTextNode('CaMeL '), span(css.wordmarkLight ?? '', 'Science'))
    this.track = div(css.track)
    this.track.append(div(css.fill))
    this.count = div(css.count)
    this.status = div(css.status)
    this.status.append(div(css.hint, 'Loading plugins…'), this.count)
    this.card.append(this.glyph, this.wordmark, this.track, this.status)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress track.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Build the drifting aurora wash that sits behind the card. */
  private aurora(): HTMLDivElement {
    const wash = div(css.aurora)
    wash.dataset.sciMotion = ''
    wash.setAttribute('aria-hidden', 'true')
    return wash
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      delete this.root.dataset.dshBootFailed
      if (this.track.parentElement !== this.card) {
        this.card.replaceChildren(this.glyph, this.wordmark, this.track, this.status)
      }
      return
    }
    this.root.dataset.dshBootFailed = ''
    const report = div(css.failed)
    const head = div(css.failedHead)
    head.append(div(css.failedDot), div(css.failedTitle, 'Failed to load plugins'))
    report.append(head)
    for (const id of failed) report.append(div(css.failedItem, id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.failure))
    this.card.replaceChildren(this.glyph, this.wordmark, report)
  }

  /** Grow the progress track monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    const percent = Math.round(PROGRESS_FLOOR + ratio * (100 - PROGRESS_FLOOR))
    this.glyph.style.setProperty('--dsh-boot-progress', `${String(percent)}%`)
    this.track.style.setProperty('--dsh-boot-progress', `${String(percent)}%`)
    this.count.textContent = this.total === 0 ? '' : `${String(this.active.size)}/${String(this.total)}`
  }
}
