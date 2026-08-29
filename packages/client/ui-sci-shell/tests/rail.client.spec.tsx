// @vitest-environment jsdom
/**
 * The rail column and its three shipped controls: which owner share reaches
 * the seats, the pressed state and routing of the research-flow button, the
 * palette toggle's read/write pair against a live subscription, and the
 * avatar's letter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Aurora } from '../src/client/Aurora.tsx'
import { SciRail, type SciRailProps } from '../src/client/SciRail.tsx'
import { ConversationRailItem, type ConversationRailItemProps } from '../src/client/RailItem.tsx'
import {
  ProfileButton, ThemeToggle, type ProfileButtonProps, type ThemeToggleProps,
} from '../src/client/RailFooter.tsx'
import { createShellStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** A store instance wired to the production selector hook, as the framework wires it. */
function seatStore() {
  const store = createShellStore().create()
  return { store, useStore: bindSnapshotSelector(store) }
}

describe('SciRail', () => {
  it('hands the frame view state to both seats it declares', () => {
    const showView = vi.fn()
    const seen: [string, unknown][] = []
    const props = {
      view: 'library',
      showView,
      renderSlot: (key: string, owner: unknown) => { seen.push([key, owner]); return null },
      t,
    } as unknown as SciRailProps
    render(<SciRail {...props} />)

    expect(seen).toEqual([
      ['rail.item', { view: 'library', showView }],
      ['rail.footer', { view: 'library', showView }],
    ])
    // The brand mark is the column's only non-seat content, and it is named.
    expect(screen.getByRole('img', { name: 'CaMeL Science' })).toBeTruthy()
  })
})

describe('ConversationRailItem', () => {
  /** The button's props over one view id. */
  function itemProps(view: string, showView = vi.fn()) {
    return { props: { view, showView, t } as unknown as ConversationRailItemProps, showView }
  }

  it('is pressed exactly while the frame shows the conversation view', () => {
    const active = itemProps('conversation')
    const view = render(<ConversationRailItem {...active.props} />)
    expect(screen.getByRole('button', { name: '研究流' }).getAttribute('aria-pressed')).toBe('true')
    view.unmount()

    render(<ConversationRailItem {...itemProps('library').props} />)
    expect(screen.getByRole('button', { name: '研究流' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('routes the frame back to the conversation view', () => {
    const b = itemProps('library')
    render(<ConversationRailItem {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: '研究流' }))
    expect(b.showView).toHaveBeenCalledWith('conversation')
  })
})

describe('ThemeToggle', () => {
  /** A theme face over a mutable palette and a live subscriber set. */
  function themeBench(initial: 'light' | 'dark') {
    let scheme = initial
    const listeners = new Set<() => void>()
    const setTheme = vi.fn((id: 'light' | 'dark') => {
      scheme = id
      for (const listener of listeners) listener()
    })
    const props = {
      getScheme: () => scheme,
      setTheme,
      subscribe: (onChange: () => void) => {
        listeners.add(onChange)
        return () => { listeners.delete(onChange) }
      },
      t,
    } as unknown as ThemeToggleProps
    return { props, setTheme }
  }

  it('offers the dark palette while the light one is active, and switches to it', () => {
    const b = themeBench('light')
    render(<ThemeToggle {...b.props} />)
    const button = screen.getByRole('button', { name: '切换到深色' })
    act(() => { fireEvent.click(button) })
    expect(b.setTheme).toHaveBeenCalledWith('dark')
    // The component follows the subscription, not its own state.
    expect(screen.getByRole('button', { name: '切换到浅色' })).toBeTruthy()
  })

  it('offers the light palette while the dark one is active, and switches to it', () => {
    const b = themeBench('dark')
    render(<ThemeToggle {...b.props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: '切换到浅色' })) })
    expect(b.setTheme).toHaveBeenCalledWith('light')
    expect(screen.getByRole('button', { name: '切换到深色' })).toBeTruthy()
  })
})

describe('ProfileButton', () => {
  it('shows a question mark until the gate read lands, then the account initial', () => {
    const seat = seatStore()
    const props = { useStore: seat.useStore, actions: seat.store.actions, t } as unknown as ProfileButtonProps
    render(<ProfileButton {...props} />)
    const button = screen.getByRole('button', { name: '账户' })
    expect(button.textContent).toBe('?')

    act(() => {
      seat.store.actions.settleIdentity(
        { email: 'wang@lab.example', role: 'member', tenant: 'Lab', vms: [], selectedVm: null },
        null,
      )
    })
    expect(button.textContent).toBe('W')
  })

  it('toggles the popover open state the overlay entry reads', () => {
    const seat = seatStore()
    const props = { useStore: seat.useStore, actions: seat.store.actions, t } as unknown as ProfileButtonProps
    render(<ProfileButton {...props} />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: '账户' })) })
    expect(seat.store.getSnapshot().open).toBe(true)
    act(() => { fireEvent.click(screen.getByRole('button', { name: '账户' })) })
    expect(seat.store.getSnapshot().open).toBe(false)
  })
})

describe('Aurora', () => {
  it('is a decorative, click-through, motion-tagged backdrop', () => {
    const view = render(<Aurora />)
    const root = view.container.firstElementChild
    expect(root?.getAttribute('aria-hidden')).toBe('true')
    expect(root?.hasAttribute('data-sci-motion')).toBe(true)
    // Two colour fields, and nothing else to hit-test.
    expect(root?.children).toHaveLength(2)
  })
})
