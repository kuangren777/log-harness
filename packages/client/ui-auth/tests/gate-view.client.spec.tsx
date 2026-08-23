// @vitest-environment jsdom
/**
 * What the sign-in card shows: the two steps a user walks, the failure copy
 * that never names a cause, the disabled state while a request is in flight,
 * and the two mailed landings.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { AuthGateView, type AuthGateViewProps } from '../src/client/AuthGateView.tsx'
import type { AuthState } from '../src/client/auth-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, string>): string =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)

const ACTIONS = {
  signIn: vi.fn(),
  submitCode: vi.fn(),
  backToSignIn: vi.fn(),
  beginForgot: vi.fn(),
  requestReset: vi.fn(),
  resetPassword: vi.fn(),
  signOut: vi.fn(),
  signOutEverywhere: vi.fn(),
}

/** Render the card over one snapshot. */
function view(state: Partial<AuthState> = {}): void {
  for (const action of Object.values(ACTIONS)) action.mockClear()
  const store = createSnapshotStore<AuthState>({
    mounted: true, view: 'sign-in', pending: false, notice: 'none', account: undefined, admin: false, ...state,
  })
  const props = {
    ...ACTIONS,
    t,
    useAuth: bindSnapshotSelector(store),
  } as unknown as AuthGateViewProps
  render(<AuthGateView {...props} />)
}

describe('the sign-in card', () => {
  it('renders nothing at all while the surface is hidden', () => {
    view({ view: 'hidden' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('submits the credentials it was given', () => {
    view()
    fireEvent.change(screen.getByLabelText(en.email), { target: { value: 'ada@example.test' } })
    fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'correct-horse-battery' } })
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(ACTIONS.signIn).toHaveBeenCalledWith('ada@example.test', 'correct-horse-battery')
  })

  it('names no cause when the sign-in was refused', () => {
    view({ notice: 'signInFailed' })
    const alert = screen.getByRole('alert')
    // One string covers a wrong password, an unknown address and a disabled
    // account alike. It may name both fields to check; what it may never do is
    // single one out, which is the wording that rebuilds the account oracle.
    expect(alert.textContent).toBe(en.signInFailed)
    for (const oracle of [
      /no account/i, /unknown address/i, /not registered/i, /does not exist/i,
      /wrong password/i, /incorrect password/i, /account is disabled/i,
    ]) expect(alert.textContent).not.toMatch(oracle)
    for (const oracle of ['该邮箱', '不存在', '未注册', '密码错误', '账号已停用']) {
      expect(zh.signInFailed).not.toContain(oracle)
    }
  })

  it('says "later" for a rate-limited refusal, with no count and no deadline', () => {
    view({ notice: 'rateLimited' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(en.rateLimited)
    expect(alert.textContent).not.toMatch(/\d/)
  })

  it('disables every submit and shows progress while a request is in flight', () => {
    view({ pending: true })
    expect(screen.getByRole('button', { name: en.signingIn }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByLabelText(en.email).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByLabelText(en.password).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: en.forgotLink }).getAttribute('disabled')).not.toBeNull()
  })

  it('submits the mailed code and offers the way back', () => {
    view({ view: 'code' })
    fireEvent.change(screen.getByLabelText(en.code), { target: { value: '424242' } })
    fireEvent.click(screen.getByRole('button', { name: en.verify }))
    expect(ACTIONS.submitCode).toHaveBeenCalledWith('424242')
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(ACTIONS.backToSignIn).toHaveBeenCalledTimes(1)
  })

  it('shows progress on the code and forgot steps too', () => {
    view({ view: 'code', pending: true })
    expect(screen.getByRole('button', { name: en.verifying }).getAttribute('disabled')).not.toBeNull()

    cleanup()
    view({ view: 'forgot', pending: true })
    expect(screen.getByRole('button', { name: en.forgotSending }).getAttribute('disabled')).not.toBeNull()
  })

  it('re-prompts a refused code without saying which part was wrong', () => {
    view({ view: 'code', notice: 'codeFailed' })
    expect(screen.getByLabelText(en.code)).not.toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(en.codeFailed)
  })

  it('opens the forgot form and acknowledges without confirming the address', () => {
    view()
    fireEvent.click(screen.getByRole('button', { name: en.forgotLink }))
    expect(ACTIONS.beginForgot).toHaveBeenCalledTimes(1)

    cleanup()
    view({ view: 'forgot' })
    fireEvent.change(screen.getByLabelText(en.email), { target: { value: 'nobody@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: en.forgotSubmit }))
    expect(ACTIONS.requestReset).toHaveBeenCalledWith('nobody@example.test')

    cleanup()
    view({ view: 'forgot', notice: 'forgotSent' })
    expect(screen.getByRole('status').textContent).toBe(en.forgotSent)
    // The acknowledgement is conditional; it never states that an account exists.
    expect(en.forgotSent.startsWith('If ')).toBe(true)
  })

  it('leaves the forgot form through the same way back', () => {
    view({ view: 'forgot' })
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    expect(ACTIONS.backToSignIn).toHaveBeenCalledTimes(1)
  })

  it('takes one new password on the reset landing', () => {
    view({ view: 'reset' })
    fireEvent.change(screen.getByLabelText(en.newPassword), { target: { value: 'next-password' } })
    fireEvent.click(screen.getByRole('button', { name: en.resetSubmit }))
    expect(ACTIONS.resetPassword).toHaveBeenCalledWith('next-password')

    cleanup()
    view({ view: 'reset', pending: true })
    expect(screen.getByRole('button', { name: en.resetSaving }).getAttribute('disabled')).not.toBeNull()
  })

  it('reports the confirmation landing, then leads to the sign-in form', () => {
    view({ view: 'verify', pending: true })
    expect(screen.getByText(en.verifyPending)).not.toBeNull()

    cleanup()
    view({ view: 'verify', notice: 'verified' })
    expect(screen.getByRole('status').textContent).toBe(en.verified)
    fireEvent.click(screen.getByRole('button', { name: en.continueToSignIn }))
    expect(ACTIONS.backToSignIn).toHaveBeenCalledTimes(1)

    cleanup()
    view({ view: 'verify', notice: 'verifyFailed' })
    expect(screen.getByRole('alert').textContent).toBe(en.verifyFailed)
  })

  it('is a labelled modal that owns the page while it is up', () => {
    view()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe(en.title)
  })
})
