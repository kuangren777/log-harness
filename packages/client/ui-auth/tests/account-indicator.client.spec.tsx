// @vitest-environment jsdom
/**
 * The account row at the sidebar foot: it appears only for a named account,
 * folds to the rail icon with the column, and offers exactly the two ways out.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AccountIndicator, type AccountIndicatorProps } from '../src/client/AccountIndicator.tsx'
import type { AuthState } from '../src/client/auth-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)

const signOut = vi.fn()
const signOutEverywhere = vi.fn()

/** Render the row over one snapshot, returning the store so a spec can move it. */
function row(state: Partial<AuthState> = {}, wide = true) {
  signOut.mockClear()
  signOutEverywhere.mockClear()
  const store = createSnapshotStore<AuthState>({
    mounted: true, view: 'hidden', pending: false, notice: 'none',
    account: 'ada@example.test', admin: true, ...state,
  })
  const props = {
    wide,
    t,
    signOut,
    signOutEverywhere,
    signIn: vi.fn(),
    submitCode: vi.fn(),
    backToSignIn: vi.fn(),
    beginForgot: vi.fn(),
    requestReset: vi.fn(),
    resetPassword: vi.fn(),
    useAuth: bindSnapshotSelector(store),
  } as unknown as AccountIndicatorProps
  render(<AccountIndicator {...props} />)
  return store
}

const LABEL = 'Signed in as ada@example.test'

describe('the account row', () => {
  it('is absent while nobody is signed in', () => {
    row({ account: undefined })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('names the signed-in account and keeps the label while folded', () => {
    row()
    expect(screen.getByRole('button', { name: LABEL })).not.toBeNull()
    expect(screen.getByText('ada@example.test')).not.toBeNull()

    cleanup()
    row({}, false)
    // The rail drops the text but not the accessible name.
    expect(screen.getByRole('button', { name: LABEL })).not.toBeNull()
    expect(screen.queryByText('ada@example.test')).toBeNull()
  })

  it('offers exactly the two ways out, each calling its own endpoint', () => {
    row()
    const trigger = screen.getByRole('button', { name: LABEL })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const items = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(items).toEqual([en.signOut, en.signOutEverywhere])
    fireEvent.click(screen.getByRole('menuitem', { name: en.signOut }))
    expect(signOut).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('menuitem', { name: en.signOutEverywhere }))
    expect(signOutEverywhere).toHaveBeenCalledTimes(1)

    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('disables both ways out and shows progress once one is chosen', () => {
    const store = row()
    fireEvent.click(screen.getByRole('button', { name: LABEL }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.signOut }))
    act(() => { store.update((draft) => { draft.pending = true }) })

    expect(screen.getByRole('button', { name: LABEL }).getAttribute('disabled')).not.toBeNull()
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual([en.signingOut, en.signingOut])
    for (const item of items) expect(item.getAttribute('disabled')).not.toBeNull()
  })
})
