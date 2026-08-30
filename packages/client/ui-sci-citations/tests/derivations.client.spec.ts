// @vitest-environment jsdom
/**
 * The pool derivations and the two browser hand-offs: what each left-column
 * selection shows, how a confidence is toned, what the copied block says, and
 * how the clipboard and the download path report an outcome they cannot
 * deliver.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_GROUP, citationBlock, citationLine, confidenceTone, exportGroupOf, QUARANTINE_GROUP,
  selectionCount, visibleCitations,
} from '../src/client/pool-view.ts'
import { downloadText, writeClipboard } from '../src/client/save.ts'
import { BARE, QIN, ZHAO } from './citations.client.ts'

const POOL = [ZHAO, QIN, BARE]

afterEach(() => { vi.unstubAllGlobals() })

describe('visibleCitations', () => {
  it('shows the whole pool, one group, or the quarantined citations', () => {
    expect(visibleCitations(POOL, ALL_GROUP)).toEqual(POOL)
    expect(visibleCitations(POOL, 'halogen')).toEqual([ZHAO])
    expect(visibleCitations(POOL, QUARANTINE_GROUP)).toEqual([BARE])
    expect(visibleCitations(POOL, 'device')).toEqual([])
  })

  it('counts exactly what the selection shows', () => {
    expect(selectionCount(POOL, ALL_GROUP)).toBe(3)
    expect(selectionCount(POOL, 'defect')).toBe(1)
    expect(selectionCount(POOL, QUARANTINE_GROUP)).toBe(1)
  })

  it('keeps a quarantined citation in the group its user put it in', () => {
    const held = { ...ZHAO, quarantined: true }
    expect(visibleCitations([held], 'halogen')).toEqual([held])
    expect(visibleCitations([held], QUARANTINE_GROUP)).toEqual([held])
  })
})

describe('confidenceTone', () => {
  it('tones at the two thresholds the design states', () => {
    expect(confidenceTone(100)).toBe('high')
    expect(confidenceTone(90)).toBe('high')
    expect(confidenceTone(89)).toBe('mid')
    expect(confidenceTone(75)).toBe('mid')
    expect(confidenceTone(74)).toBe('low')
    expect(confidenceTone(0)).toBe('low')
  })
})

describe('the copied citation block', () => {
  it('writes every field the record carries', () => {
    expect(citationLine(ZHAO)).toBe(
      '[zhao2024] Zhao, Li-Dong, Chang, Cheng. Halide doping raises the zT of n-type SnSe above 2.4.'
      + ' Nature 2024. 10.1038/s41586-024-07001-2',
    )
  })

  it('drops the slot of a field the record does not carry', () => {
    expect(citationLine(QIN)).toBe(
      '[qin2025] Qin, Bingchao. Grain-boundary engineering of selenide thermoelectrics. 2025.',
    )
    expect(citationLine(BARE)).toBe('[wang] Unreviewed preprint on SnSe single crystals.')
    expect(citationLine({ ...ZHAO, year: undefined, doi: undefined })).toBe(
      '[zhao2024] Zhao, Li-Dong, Chang, Cheng. Halide doping raises the zT of n-type SnSe above 2.4. Nature.',
    )
  })

  it('is one line per listed citation, and empty for an empty list', () => {
    expect(citationBlock([ZHAO, QIN]).split('\n')).toHaveLength(2)
    expect(citationBlock([])).toBe('')
  })
})

describe('exportGroupOf', () => {
  it('exports the whole project for the two selections that are not groups', () => {
    expect(exportGroupOf(ALL_GROUP)).toBeUndefined()
    expect(exportGroupOf(QUARANTINE_GROUP)).toBeUndefined()
    expect(exportGroupOf('halogen')).toBe('halogen')
  })
})

describe('writeClipboard', () => {
  it('reports whether the clipboard took the text', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(writeClipboard('[zhao2024]')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('[zhao2024]')
  })

  it('reports a browser without the API, and a refused write, as a failure', async () => {
    vi.stubGlobal('navigator', {})
    await expect(writeClipboard('x')).resolves.toBe(false)

    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    await expect(writeClipboard('x')).resolves.toBe(false)
  })
})

describe('downloadText', () => {
  it('hands one named file to the browser and releases its url', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:bib'), revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    expect(downloadText('thermo-2026.bib', '@article{zhao2024,}')).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bib')
    // The anchor is transient: the pool must not accumulate one per export.
    expect(document.querySelectorAll('a')).toHaveLength(0)
    click.mockRestore()
  })

  it('saves into the document it is given', () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:bib'), revokeObjectURL: vi.fn() })
    const other = document.implementation.createHTMLDocument('export')
    const clicked: string[] = []
    const anchor = other.createElement('a')
    vi.spyOn(other, 'createElement').mockReturnValue(anchor)
    anchor.click = () => { clicked.push(anchor.download) }

    expect(downloadText('perovskite-2025.bib', '@book{}', other)).toBe(true)
    expect(clicked).toEqual(['perovskite-2025.bib'])
  })

  it('reports a browser with no object-url support instead of throwing', () => {
    vi.stubGlobal('URL', {})
    expect(downloadText('thermo-2026.bib', '@article{}')).toBe(false)
  })
})
