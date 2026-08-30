import { describe, expect, it } from 'vitest'
import {
  clampWidth, computeColumns,
  DETAILS_CENTER_FLOOR, DETAILS_DEFAULT, DETAILS_RATIO,
  SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('open details take exactly the fixed share of the frame', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 960, details: Math.round(1920 * DETAILS_RATIO) })
  })

  it('closed sidebar keeps its compact rail while closed details contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0 })
  })

  it('the details preference value is open/closed only — never a width', () => {
    // Any non-zero preference renders the same fixed share.
    expect(computeColumns(1920, open(SIDEBAR_DEFAULT), open(1)).details).toBe(960)
    expect(computeColumns(1920, open(SIDEBAR_DEFAULT), open(9999)).details).toBe(960)
    expect(computeColumns(1920, open(SIDEBAR_DEFAULT), closed(360)).details).toBe(0)
  })

  it('sidebar preferences beyond the clamp range are clamped before solving', () => {
    expect(computeColumns(1920, open(9999), closed(0)).sidebar).toBe(420)
    expect(computeColumns(1920, open(1), closed(0)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('details auto-close when the fixed share squeezes center below its floor', () => {
    // Boundary: center = viewport - sidebar - viewport/2 crosses the floor.
    const seam = 2 * (SIDEBAR_DEFAULT + DETAILS_CENTER_FLOOR)
    const fits = computeColumns(seam, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(fits).toEqual({ sidebar: 280, center: DETAILS_CENTER_FLOOR, details: seam / 2 })
    const starved = computeColumns(seam - 2, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(starved).toEqual({ sidebar: 280, center: seam - 2 - 280, details: 0 })
  })

  it('the sidebar never concedes: center absorbs the deficit', () => {
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, details: 0 })
  })

  it('a collapsed sidebar leaves more of the frame to the pair', () => {
    const cols = computeColumns(1000, closed(300), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1000 - SIDEBAR_COLLAPSED - 500, details: 500 })
  })

  it('tiny viewport: details close, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 400 - SIDEBAR_DEFAULT, details: 0 })
  })

  it('recovery is pure: re-widening restores the fixed share untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT))
    expect(restored.details).toBe(960)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})
