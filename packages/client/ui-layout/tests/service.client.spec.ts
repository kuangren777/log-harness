/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, the three actions forwarding, the
 * unwired fail-loud, re-attach overwriting a stale action set, and the
 * details-mode gesture over its registrable selector.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    showView: vi.fn(),
    toggleDetailsWide: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.showDetailsMode('files') }).toThrow(/panel actions not wired/)
    expect(() => { service.showView('library') }).toThrow(/panel actions not wired/)
    expect(() => { service.toggleDetailsWide() }).toThrow(/panel actions not wired/)
  })

  it('showDetailsMode opens the column alone while no plugin registered a selector', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.showDetailsMode('files')

    expect(panels.openDetails).toHaveBeenCalledTimes(1)
  })

  it('showDetailsMode selects the mode before opening the column', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)
    const order: string[] = []
    const select = vi.fn((id: string) => { order.push(`select:${id}`) })
    panels.openDetails = vi.fn(() => { order.push('open') })
    service.registerDetailsModeSelector(select)

    service.showDetailsMode('files')

    expect(select).toHaveBeenCalledWith('files')
    expect(order).toEqual(['select:files', 'open'])
  })

  it('the selector disposer removes only the registration that is still current', () => {
    const service = new LayoutController()
    service.attachPanels(fakePanels())
    const stale = vi.fn()
    const fresh = vi.fn()
    const disposeStale = service.registerDetailsModeSelector(stale)
    // Re-registration replaces: one details column, one owner.
    service.registerDetailsModeSelector(fresh)
    service.showDetailsMode('files')
    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)

    // The superseded fiber's disposer must not unregister its successor
    // (an HMR swap registers before the outgoing fiber unloads).
    disposeStale()
    service.showDetailsMode('files')
    expect(fresh).toHaveBeenCalledTimes(2)

    // Its own disposer does remove it: the gesture falls back to open-only.
    service.registerDetailsModeSelector(stale)()
    service.showDetailsMode('files')
    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(2)
  })

  it('forwards the view switch and the wide-details toggle to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.showView('library')
    service.toggleDetailsWide()

    expect(panels.showView).toHaveBeenCalledWith('library')
    expect(panels.toggleDetailsWide).toHaveBeenCalledTimes(1)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
