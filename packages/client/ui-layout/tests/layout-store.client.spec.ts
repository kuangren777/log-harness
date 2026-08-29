// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the absence of browser persistence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { CONVERSATION_VIEW, createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false,
      view: CONVERSATION_VIEW, detailsWide: false,
    })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({
      sidebar: 400, details: 0, narrow: true, narrowExpanded: true,
      view: CONVERSATION_VIEW, detailsWide: false,
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('starts on the conversation view and switches views', () => {
    const { store, actions } = createLayoutStore().create()
    expect(store.getSnapshot().view).toBe(CONVERSATION_VIEW)
    actions.showView('library')
    expect(store.getSnapshot().view).toBe('library')
    actions.showView(CONVERSATION_VIEW)
    expect(store.getSnapshot().view).toBe(CONVERSATION_VIEW)
  })

  it('toggles the wide details mode and closeDetails resets it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    actions.toggleDetailsWide()
    expect(store.getSnapshot()).toMatchObject({ details: DETAILS_DEFAULT, detailsWide: true })
    actions.toggleDetailsWide()
    expect(store.getSnapshot().detailsWide).toBe(false)
    actions.toggleDetailsWide()
    actions.closeDetails()
    expect(store.getSnapshot()).toMatchObject({ details: 0, detailsWide: false })
  })

  it('toggleDetailsWide opens a closed details column', () => {
    const { store, actions } = createLayoutStore().create()
    actions.toggleDetailsWide()
    expect(store.getSnapshot()).toMatchObject({ details: DETAILS_DEFAULT, detailsWide: true })
  })

  it('does not persist panel geometry', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      view: CONVERSATION_VIEW,
      detailsWide: false,
    })
  })
})
