// @vitest-environment jsdom
/**
 * The agent view's one load pass and the three pages it walks between: what
 * it reads on mount, which page each gesture opens, what a configuration
 * write does to the card the host answers with, where a log row leads, and
 * the shared state that keeps all of it across a trip through the flow.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  CallsOutcome, ConfigureOutcome, ModelProvider, RosterOutcome, SciAgentsInjected,
} from '../src/client/contract.ts'
import { AgentsView, type AgentsViewProps } from '../src/client/AgentsView.tsx'
import { createAgentsStore } from '../src/client/stores.ts'
import { zh } from '../src/client/locales.ts'
import { CALLS, CATALOG, DELIVERER, RESEARCHER, ROSTER } from './records.client.ts'

const t = makeTranslate(zh)

/** The agent the fake host answers a configuration write with. */
const DISABLED_RESEARCHER = { ...RESEARCHER, enabled: false }

afterEach(cleanup)

/** The injected face, with every member stubbed and overridable per case. */
function faceOf(overrides: Partial<SciAgentsInjected> = {}): SciAgentsInjected {
  return {
    roster: vi.fn(async (): Promise<RosterOutcome> => ({ ok: true, agents: ROSTER })),
    configure: vi.fn(async (): Promise<ConfigureOutcome> => ({ ok: true, agent: DISABLED_RESEARCHER })),
    calls: vi.fn(async (persona: string): Promise<CallsOutcome> => ({
      ok: true,
      calls: persona === RESEARCHER.persona ? CALLS : [],
    })),
    models: vi.fn(async (): Promise<readonly ModelProvider[]> => CATALOG),
    openSession: vi.fn(),
    ...overrides,
  }
}

/** Mount the view over a live store instance, flushing its one load pass. */
async function mount(overrides: Partial<SciAgentsInjected> = {}) {
  const store = createAgentsStore().create()
  const face = faceOf(overrides)
  const props = {
    useStore: bindSnapshotSelector(store), actions: store.actions, ...face, t,
  } as unknown as AgentsViewProps
  await act(async () => { render(<AgentsView {...props} />) })
  return { store, face }
}

/** Open one persona's page through the card button that leads there. */
function openPage(name: '配置' | '调用日志', at = 0): void {
  fireEvent.click(screen.getAllByRole('button', { name })[at]!)
}

describe('the load pass', () => {
  it('reads the roster, the catalog, and every persona s log exactly once', async () => {
    const b = await mount()

    expect(b.face.roster).toHaveBeenCalledTimes(1)
    expect(b.face.models).toHaveBeenCalledTimes(1)
    // The status pill is a fact about the log, so a persona's log is read on
    // the roster pass rather than guessed at.
    expect(vi.mocked(b.face.calls).mock.calls.map(call => call[0]))
      .toEqual([RESEARCHER.persona, DELIVERER.persona])

    const state = b.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.agents).toEqual(ROSTER)
    expect(state.models).toEqual(CATALOG)
    expect(state.callsByPersona[RESEARCHER.persona]).toEqual(CALLS)
  })

  it('draws the roster the host reported, with its running pill', async () => {
    await mount()
    expect(screen.getByText('1 个在编 · 本月协同完成 1,204 次委派')).toBeTruthy()
    // The fixture log carries a call still in flight, which is what makes
    // this card read 运行中 rather than 待命.
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('已停用')).toBeTruthy()
  })

  it('stops at a failed roster instead of reading a catalog it cannot use', async () => {
    const roster = vi.fn(async (): Promise<RosterOutcome> => ({ ok: false, code: 'AGENTS_REMOTE_UNAVAILABLE' }))
    const b = await mount({ roster })

    expect(screen.getByRole('alert').textContent).toBe('名册读取失败（AGENTS_REMOTE_UNAVAILABLE）。')
    expect(b.face.models).not.toHaveBeenCalled()
    expect(b.face.calls).not.toHaveBeenCalled()
    expect(b.store.getSnapshot().status).toBe('error')
  })

  it('records an unreadable log against its own persona and leaves the rest', async () => {
    const calls = vi.fn(async (persona: string): Promise<CallsOutcome> => (
      persona === RESEARCHER.persona
        ? { ok: false, code: 'AUDIT_UNAVAILABLE' }
        : { ok: true, calls: [] }
    ))
    const b = await mount({ calls })

    const state = b.store.getSnapshot()
    expect(state.callsErrors).toEqual({ [RESEARCHER.persona]: 'AUDIT_UNAVAILABLE' })
    expect(state.callsByPersona[DELIVERER.persona]).toEqual([])
    // A log that could not be read is not a persona standing idle, so the
    // card falls back to 待命 rather than claiming a call is in flight.
    expect(screen.getByText('待命')).toBeTruthy()
  })
})

describe('walking between the three pages', () => {
  it('opens one persona s configuration and comes back to the roster', async () => {
    await mount()
    openPage('配置')
    expect(screen.getByRole('heading', { name: '检索体 · 配置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'deepseek-reasoner' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '返回智能体' }))
    expect(screen.getByRole('heading', { name: '智能体' })).toBeTruthy()
  })

  it('opens one persona s log, re-reading it so the rows are current', async () => {
    const b = await mount()
    await act(async () => { openPage('调用日志') })

    expect(screen.getByRole('heading', { name: '检索体 · 调用日志' })).toBeTruthy()
    expect(screen.getByText('跨库检索 n 型硒化物 zT')).toBeTruthy()
    // Once on the load pass, once on the way in: a log opened minutes later
    // must not show what the roster read at mount.
    const reads = vi.mocked(b.face.calls).mock.calls.filter(call => call[0] === RESEARCHER.persona)
    expect(reads).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '返回智能体' }))
    expect(screen.getByRole('heading', { name: '智能体' })).toBeTruthy()
  })

  it('shows an unreadable log as the failure it is', async () => {
    const calls = vi.fn(async (): Promise<CallsOutcome> => ({ ok: false, code: 'AUDIT_UNAVAILABLE' }))
    await mount({ calls })
    await act(async () => { openPage('调用日志') })

    expect(screen.getByRole('alert').textContent).toBe('名册读取失败（AUDIT_UNAVAILABLE）。')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('falls back to the roster for a persona the roster no longer carries', async () => {
    const b = await mount()
    // A host-side reconfiguration can retire a persona while its page is
    // open; an empty配置 frame would state nothing at all.
    act(() => { b.store.actions.showConfig('phantom') })
    expect(screen.getByRole('heading', { name: '智能体' })).toBeTruthy()
    expect(screen.queryByText('工具权限')).toBeNull()
  })
})

describe('a configuration write', () => {
  it('carries the persona id, and redraws from the agent the host answers with', async () => {
    const b = await mount()
    openPage('配置')
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '启用该智能体' })) })

    expect(b.face.configure).toHaveBeenCalledWith(RESEARCHER.persona, { enabled: false })
    expect(screen.getByRole('status').textContent).toBe('已保存')
    expect(screen.getByRole('switch', { name: '启用该智能体' }).getAttribute('aria-checked')).toBe('false')

    // The roster behind the page carries the host's answer too, so the card
    // reads 已停用 without a second roster read.
    fireEvent.click(screen.getByRole('button', { name: '返回智能体' }))
    expect(screen.getAllByText('已停用')).toHaveLength(2)
  })

  it('shows the write in flight before it settles', async () => {
    let settle = (_outcome: ConfigureOutcome): void => {}
    const configure = vi.fn(() => new Promise<ConfigureOutcome>((resolve) => { settle = resolve }))
    await mount({ configure })
    openPage('配置')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'pi-fast' })) })
    expect(screen.getByRole('status').textContent).toBe('保存中…')

    await act(async () => { settle({ ok: true, agent: RESEARCHER }) })
    expect(screen.getByRole('status').textContent).toBe('已保存')
  })

  it('states a refused write instead of claiming it landed', async () => {
    const configure = vi.fn(async (): Promise<ConfigureOutcome> => ({ ok: false, code: 'SETTINGS_WRITE_DENIED' }))
    await mount({ configure })
    openPage('配置')
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '联网检索' })) })

    expect(screen.getByRole('status').textContent).toBe('保存失败（SETTINGS_WRITE_DENIED）')
    // The switch still shows what the host has, not what the click asked for.
    expect(screen.getByRole('switch', { name: '联网检索' }).getAttribute('aria-checked')).toBe('true')
  })

  it('leaves the roster alone when the host answers with an unknown persona', async () => {
    const stranger = { ...RESEARCHER, persona: 'phantom' }
    const configure = vi.fn(async (): Promise<ConfigureOutcome> => ({ ok: true, agent: stranger }))
    const b = await mount({ configure })
    openPage('配置')
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '联网检索' })) })

    expect(screen.getByRole('status').textContent).toBe('已保存')
    expect(b.store.getSnapshot().agents).toEqual(ROSTER)
  })
})

describe('the route back into the research flow', () => {
  it('hands the delegating session of the clicked row to the host', async () => {
    const b = await mount()
    await act(async () => { openPage('调用日志') })
    fireEvent.click(screen.getByRole('row', { name: /交叉验证 47 条引用/u }))

    expect(b.face.openSession).toHaveBeenCalledWith('session-43')
  })
})

describe('the shared state behind the view', () => {
  it('keeps the page and the persona across a refresh', async () => {
    const store = createAgentsStore().create()
    store.actions.loaded(ROSTER)
    store.actions.showLog(RESEARCHER.persona)
    store.actions.beginLoad()

    const state = store.getSnapshot()
    // A refresh must not send a reader back to the roster: the numbers on a
    // card can move while they are reading a log.
    expect(state.page).toBe('log')
    expect(state.persona).toBe(RESEARCHER.persona)
    expect(state.status).toBe('loading')
    expect(state.error).toBeNull()
  })

  it('clears a stale log failure once that persona reads', () => {
    const store = createAgentsStore().create()
    store.actions.setCallsFailed(RESEARCHER.persona, 'AUDIT_UNAVAILABLE')
    expect(store.getSnapshot().callsErrors).toEqual({ [RESEARCHER.persona]: 'AUDIT_UNAVAILABLE' })

    store.actions.setCalls(RESEARCHER.persona, CALLS)
    expect(store.getSnapshot().callsErrors).toEqual({})
    expect(store.getSnapshot().callsByPersona[RESEARCHER.persona]).toEqual(CALLS)
  })

  it('retires the save indicator on the way out of a configuration page', () => {
    const store = createAgentsStore().create()
    store.actions.saveFailed('SETTINGS_WRITE_DENIED')
    expect(store.getSnapshot().save).toBe('error')

    store.actions.showRoster()
    const cleared = store.getSnapshot()
    expect(cleared).toMatchObject({ page: 'roster', persona: null, save: 'idle', saveError: null })

    // Opening a page carries the same clean slate: an indicator left over
    // from the previous persona would be about the wrong agent.
    store.actions.saveFailed('SETTINGS_WRITE_DENIED')
    store.actions.showConfig(DELIVERER.persona)
    expect(store.getSnapshot()).toMatchObject({ save: 'idle', saveError: null })
  })

  it('reports a failed roster read without discarding the roster on screen', () => {
    const store = createAgentsStore().create()
    store.actions.loaded(ROSTER)
    store.actions.failed('AGENTS_REMOTE_FAILED')

    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: 'AGENTS_REMOTE_FAILED' })
    expect(store.getSnapshot().agents).toEqual(ROSTER)
  })

  it('replaces exactly the agent a write answered for', () => {
    const store = createAgentsStore().create()
    store.actions.loaded(ROSTER)
    store.actions.beginSave()
    expect(store.getSnapshot().save).toBe('saving')

    store.actions.saved(DISABLED_RESEARCHER)
    expect(store.getSnapshot().agents).toEqual([DISABLED_RESEARCHER, DELIVERER])
    expect(store.getSnapshot().save).toBe('saved')
  })

  it('takes the catalog the host reported, empty included', () => {
    const store = createAgentsStore().create()
    store.actions.setModels(CATALOG)
    expect(store.getSnapshot().models).toEqual(CATALOG)

    store.actions.setModels([])
    expect(store.getSnapshot().models).toEqual([])
  })
})
