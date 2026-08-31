// @vitest-environment jsdom
/**
 * The account popover and the gate reads behind it: what one mount asks for,
 * which rows a real answer produces, what a rejected or unreachable gate
 * degrades to, the two ways the card closes, and the sign-out navigation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ProfilePopover, type ProfilePopoverProps } from '../src/client/ProfilePopover.tsx'
import { avatarGlyph, createShellStore, selectedVmOf } from '../src/client/stores.ts'
import { fetchBalance, fetchMe, logout, type GateMe } from '../src/client/gate-me.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

/** One signed-in account with a selected VM. */
const ME: GateMe = {
  email: 'wang@lab.example',
  role: 'member',
  tenant: '实验室',
  vms: [
    { id: '1', slug: 'sci-alpha', status: 'stopped', image_tag: '20260801' },
    { id: '2', slug: 'sci-beta', status: 'running', image_tag: '20260829-wb1' },
  ],
  selectedVm: '2',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The popover's four shares over a real store instance and stubbed gate reads. */
function bench(options: {
  me?: GateMe | null
  balance?: { totalUsd: string; planUsd: string; creditUsd: string; exhausted: boolean } | null
  logoutOk?: boolean
} = {}) {
  const store = createShellStore().create()
  const fetchMeStub = vi.fn(async () => 'me' in options ? options.me ?? null : ME)
  const fetchBalanceStub = vi.fn(async () => 'balance' in options ? options.balance ?? null : {
    totalUsd: '12.34', planUsd: '10.00', creditUsd: '2.34', exhausted: false,
  })
  const logoutStub = vi.fn(async () => options.logoutOk ?? true)
  const props = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    fetchMe: fetchMeStub,
    fetchBalance: fetchBalanceStub,
    logout: logoutStub,
    t,
  } as unknown as ProfilePopoverProps
  return { props, store, fetchMe: fetchMeStub, fetchBalance: fetchBalanceStub, logout: logoutStub }
}

/** Mount the popover and open it once the mount-time gate read has settled. */
async function open(b: ReturnType<typeof bench>) {
  render(<ProfilePopover {...b.props} />)
  await waitFor(() => { expect(b.store.getSnapshot().loaded).toBe(true) })
  act(() => { b.store.actions.toggleProfile() })
}

describe('ProfilePopover', () => {
  it('reads the gate once on mount and draws nothing while closed', async () => {
    const b = bench()
    const view = render(<ProfilePopover {...b.props} />)
    await waitFor(() => { expect(b.store.getSnapshot().loaded).toBe(true) })
    expect(b.fetchMe).toHaveBeenCalledTimes(1)
    expect(b.fetchBalance).toHaveBeenCalledTimes(1)
    // Closed: the layer stays click-through, so the entry renders no node.
    expect(view.container.innerHTML).toBe('')
  })

  it('shows the account, its selected VM, and the balance', async () => {
    const b = bench()
    await open(b)
    expect(screen.getByText('wang@lab.example')).toBeTruthy()
    expect(screen.getByText('member · 实验室')).toBeTruthy()
    expect(screen.getByText('sci-beta · 20260829-wb1')).toBeTruthy()
    expect(screen.getByText('余额 $12.34')).toBeTruthy()
    expect(screen.queryByText('已用尽')).toBeNull()
  })

  it('states an exhausted balance beside the amount', async () => {
    const b = bench({ balance: { totalUsd: '0.00', planUsd: '0.00', creditUsd: '0.00', exhausted: true } })
    await open(b)
    expect(screen.getByText('余额 $0.00')).toBeTruthy()
    expect(screen.getByText('已用尽')).toBeTruthy()
  })

  it('omits the tenant and VM rows, states an unreadable balance, and offers the admin console', async () => {
    const b = bench({
      me: { email: 'root@example', role: 'admin', tenant: null, vms: [], selectedVm: null },
      balance: null,
    })
    await open(b)
    expect(screen.getByText('admin')).toBeTruthy()
    // An unreadable balance is a stated fact, never a hidden row or a number.
    expect(screen.getByText('余额暂不可读')).toBeTruthy()
    expect(screen.queryByText(/余额 \$/)).toBeNull()
    expect(screen.queryByText(/·/)).toBeNull()
    // The management pages are one click away; the admin link needs the role.
    expect(screen.getByRole('link', { name: '额度与充值' }).getAttribute('href')).toBe('/gate/credit')
    expect(screen.getByRole('link', { name: '账户与虚拟机' }).getAttribute('href')).toBe('/gate/login')
    expect(screen.getByRole('link', { name: '管理后台' }).getAttribute('href')).toBe('/admin/')
  })

  it('withholds the admin link from a non-admin', async () => {
    const b = bench({
      me: { email: 'o@example', role: 'owner', tenant: null, vms: [], selectedVm: null },
      balance: null,
    })
    await open(b)
    expect(screen.queryByRole('link', { name: '管理后台' })).toBeNull()
    expect(screen.getByRole('link', { name: '额度与充值' })).toBeTruthy()
  })

  it('degrades to one line when the gate cannot be read, and shows no numbers', async () => {
    const b = bench({ me: null, balance: null })
    await open(b)
    expect(screen.getByText('未登录网关')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '退出登录' })).toBeNull()
  })

  it('says it is reading while the gate has not answered yet', async () => {
    const store = createShellStore().create()
    store.actions.toggleProfile()
    let settle: (() => void) | undefined
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      fetchMe: vi.fn(async () => new Promise<GateMe | null>((resolve) => { settle = () => { resolve(null) } })),
      fetchBalance: vi.fn(async () => null),
      logout: vi.fn(async () => true),
      t,
    } as unknown as ProfilePopoverProps
    render(<ProfilePopover {...props} />)
    expect(screen.getByText('正在读取账户…')).toBeTruthy()
    await act(async () => { settle?.() })
    expect(screen.getByText('未登录网关')).toBeTruthy()
  })

  it('closes on Escape and on a click outside the card', async () => {
    const b = bench()
    await open(b)
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(b.store.getSnapshot().open).toBe(false)
    // A key that is not Escape leaves an open card alone.
    act(() => { b.store.actions.toggleProfile() })
    act(() => { fireEvent.keyDown(document, { key: 'a' }) })
    expect(b.store.getSnapshot().open).toBe(true)
    act(() => { fireEvent.click(screen.getByRole('button', { name: '关闭账户浮层' })) })
    expect(b.store.getSnapshot().open).toBe(false)
  })

  it('drops the Escape listener once the card closes and once it unmounts', async () => {
    const b = bench()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const view = render(<ProfilePopover {...b.props} />)
    await waitFor(() => { expect(b.store.getSnapshot().loaded).toBe(true) })
    // Closed on mount: nothing is listening yet.
    expect(add).not.toHaveBeenCalledWith('keydown', expect.any(Function))
    act(() => { b.store.actions.toggleProfile() })
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function))
    view.unmount()
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('ignores a gate answer that lands after the entry went down', async () => {
    const store = createShellStore().create()
    let settle: ((me: GateMe | null) => void) | undefined
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      fetchMe: vi.fn(async () => new Promise<GateMe | null>((resolve) => { settle = resolve })),
      fetchBalance: vi.fn(async () => null),
      logout: vi.fn(async () => true),
      t,
    } as unknown as ProfilePopoverProps
    const view = render(<ProfilePopover {...props} />)
    view.unmount()
    await act(async () => { settle?.(ME) })
    expect(store.getSnapshot().loaded).toBe(false)
  })

  it('leaves for the gate login page once the sign-out is accepted', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    const b = bench()
    await open(b)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '退出登录' })) })
    expect(b.logout).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/gate/login')
  })

  it('stays put when the gate refuses the sign-out', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    const b = bench({ logoutOk: false })
    await open(b)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '退出登录' })) })
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('shell store derivations', () => {
  it('takes the account initial, upper-cased, and falls back to a question mark', () => {
    expect(avatarGlyph('wang@lab.example')).toBe('W')
    expect(avatarGlyph('  ada@example')).toBe('A')
    expect(avatarGlyph('')).toBe('?')
    expect(avatarGlyph('   ')).toBe('?')
  })

  it('matches the selected VM by id, never by slug', () => {
    expect(selectedVmOf(ME)?.slug).toBe('sci-beta')
    expect(selectedVmOf({ ...ME, selectedVm: '9' })).toBeUndefined()
    expect(selectedVmOf({ ...ME, selectedVm: null })).toBeUndefined()
    expect(selectedVmOf(null)).toBeUndefined()
  })
})

/** A fetch double answering one queued response per call. */
function fetchStub(...answers: readonly unknown[]) {
  let call = 0
  return vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)]
    call += 1
    if (answer instanceof Error) throw answer
    return answer as Response
  }) as unknown as typeof fetch
}

/** A 200 answer carrying `body`. */
function ok(body: unknown): unknown {
  return { ok: true, json: async () => body }
}

describe('gate reads', () => {
  it('adapts the identity answer, normalising every id to a string', async () => {
    const f = fetchStub(ok({
      email: 'wang@lab.example', role: 'member', tenant: '实验室', selectedVm: 2,
      vms: [{ id: 2, slug: 'sci-beta', status: 'running', image_tag: '20260829-wb1' }],
    }))
    await expect(fetchMe(f)).resolves.toEqual({
      email: 'wang@lab.example', role: 'member', tenant: '实验室', selectedVm: '2',
      vms: [{ id: '2', slug: 'sci-beta', status: 'running', image_tag: '20260829-wb1' }],
    })
    expect(f).toHaveBeenCalledWith('/gate/api/me', { credentials: 'same-origin' })
  })

  it('keeps the identity total when the gate answers with holes', async () => {
    const f = fetchStub(ok({ vms: [null, { slug: 'no-id' }, { id: '7' }], tenant: 42 }))
    await expect(fetchMe(f)).resolves.toEqual({
      email: '', role: '', tenant: null, selectedVm: null,
      vms: [{ id: '7', slug: '', status: '', image_tag: '' }],
    })
    // A body that carries no vms array at all is equally total.
    await expect(fetchMe(fetchStub(ok({ email: 'a@b', vms: 'not an array' })))).resolves.toMatchObject({ vms: [] })
  })

  it('reports no identity for a rejected status, a non-object body, or an unreachable gate', async () => {
    await expect(fetchMe(fetchStub({ ok: false, json: async () => ({}) }))).resolves.toBeNull()
    await expect(fetchMe(fetchStub(ok(null)))).resolves.toBeNull()
    await expect(fetchMe(fetchStub(ok('not an object')))).resolves.toBeNull()
    await expect(fetchMe(fetchStub(new Error('offline')))).resolves.toBeNull()
  })

  it('adapts the balance answer and its exhausted flag', async () => {
    const f = fetchStub(ok({ totalUsd: '12.34', planUsd: '10.00', creditUsd: '2.34', exhausted: false }))
    await expect(fetchBalance(f)).resolves.toEqual({
      totalUsd: '12.34', planUsd: '10.00', creditUsd: '2.34', exhausted: false,
    })
    expect(f).toHaveBeenCalledWith('/gate/api/credit/balance', { credentials: 'same-origin' })

    // Only a real `true` exhausts; anything else reads as spendable.
    await expect(fetchBalance(fetchStub(ok({ exhausted: true })))).resolves.toEqual({
      totalUsd: '', planUsd: '', creditUsd: '', exhausted: true,
    })
    await expect(fetchBalance(fetchStub(ok({ exhausted: 'yes' })))).resolves.toMatchObject({ exhausted: false })
  })

  it('reports no balance for a tenant-less cookie or an unreachable gate', async () => {
    await expect(fetchBalance(fetchStub({ ok: false, json: async () => ({}) }))).resolves.toBeNull()
    await expect(fetchBalance(fetchStub(ok(null)))).resolves.toBeNull()
  })

  it('posts the sign-out and reports whether the gate accepted it', async () => {
    const f = fetchStub({ ok: true, json: async () => ({}) })
    await expect(logout(f)).resolves.toBe(true)
    expect(f).toHaveBeenCalledWith('/gate/api/logout', { method: 'POST', credentials: 'same-origin' })
    await expect(logout(fetchStub({ ok: false, json: async () => ({}) }))).resolves.toBe(false)
    await expect(logout(fetchStub(new Error('offline')))).resolves.toBe(false)
  })

  it('reaches the global fetch when the caller names none', async () => {
    vi.stubGlobal('fetch', fetchStub(ok({ email: 'a@b', vms: [] })))
    await expect(fetchMe()).resolves.toMatchObject({ email: 'a@b' })
    vi.stubGlobal('fetch', fetchStub(ok({ totalUsd: '1.00' })))
    await expect(fetchBalance()).resolves.toMatchObject({ totalUsd: '1.00' })
    vi.stubGlobal('fetch', fetchStub({ ok: true, json: async () => ({}) }))
    await expect(logout()).resolves.toBe(true)
  })
})
