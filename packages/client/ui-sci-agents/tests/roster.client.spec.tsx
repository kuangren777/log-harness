// @vitest-environment jsdom
/**
 * The roster page: what the subtitle counts, which tiles a card draws, what
 * its status pill reads, and which persona each button carries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentCall } from '../src/client/contract.ts'
import { RosterPage, type RosterPageProps } from '../src/client/RosterPage.tsx'
import { zh } from '../src/client/locales.ts'
import { CALLS, DELIVERER, RESEARCHER, ROSTER } from './records.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** The page's props over one roster, with every callback stubbed. */
function pageProps(overrides: Partial<RosterPageProps> = {}) {
  const onConfigure = vi.fn()
  const onLog = vi.fn()
  const props = {
    agents: ROSTER,
    logs: {},
    status: 'ready',
    error: null,
    onConfigure,
    onLog,
    t,
    ...overrides,
  } as unknown as RosterPageProps
  return { props, onConfigure, onLog }
}

describe('the roster header', () => {
  it('counts the enrolled personas and their real delegations', () => {
    render(<RosterPage {...pageProps().props} />)
    expect(screen.getByRole('heading', { name: '智能体' })).toBeTruthy()
    // One of the two is enabled; 1204 + 0 delegations this month.
    expect(screen.getByText('1 个在编 · 本月协同完成 1,204 次委派')).toBeTruthy()
  })
})

describe('one roster card', () => {
  it('draws every stat the host reported, in roster order', () => {
    render(<RosterPage {...pageProps().props} />)

    expect(screen.getByText('检索体')).toBeTruthy()
    expect(screen.getByText('文献检索 · 质量评级')).toBeTruthy()
    expect(screen.getByText(RESEARCHER.summary)).toBeTruthy()
    expect(screen.getByText('α')).toBeTruthy()
    expect(screen.getByText('β')).toBeTruthy()
    expect(screen.getByText('1,204')).toBeTruthy()
    expect(screen.getByText('2.8s')).toBeTruthy()
    expect(screen.getByText('31M')).toBeTruthy()
  })

  it('drops the tile of a stat the host could not compute', () => {
    render(<RosterPage {...pageProps({ agents: [DELIVERER] }).props} />)

    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('本月调用')).toBeTruthy()
    // No average and no token total were reported, so neither tile is drawn
    // rather than reading as a zero the host never measured.
    expect(screen.queryByText('平均耗时')).toBeNull()
    expect(screen.queryByText('token')).toBeNull()
  })

  it('reads standby, running, and disabled off the real state', () => {
    const running: readonly AgentCall[] = [CALLS[2]!]
    const view = render(<RosterPage {...pageProps().props} />)
    expect(screen.getByText('待命')).toBeTruthy()
    expect(screen.getByText('已停用')).toBeTruthy()
    view.unmount()

    render(<RosterPage {...pageProps({ logs: { researcher: running } }).props} />)
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.queryByText('待命')).toBeNull()
  })

  it('does not call a persona running on a log of settled calls', () => {
    render(<RosterPage {...pageProps({ logs: { researcher: [CALLS[0]!] } }).props} />)
    expect(screen.getByText('待命')).toBeTruthy()
  })

  it('carries each persona id into its two buttons', () => {
    const b = pageProps()
    render(<RosterPage {...b.props} />)

    fireEvent.click(screen.getAllByRole('button', { name: '配置' })[1]!)
    expect(b.onConfigure).toHaveBeenCalledWith('deliverer')

    fireEvent.click(screen.getAllByRole('button', { name: '调用日志' })[0]!)
    expect(b.onLog).toHaveBeenCalledWith('researcher')
  })
})

describe('the roster states', () => {
  it('says it is reading before the first roster lands', () => {
    render(<RosterPage {...pageProps({ agents: [], status: 'loading' }).props} />)
    expect(screen.getByText('正在读取名册…')).toBeTruthy()
  })

  it('states an empty roster rather than drawing an empty grid', () => {
    render(<RosterPage {...pageProps({ agents: [] }).props} />)
    expect(screen.getByText('当前配置没有挂载任何智能体。')).toBeTruthy()
  })

  it('reports a failed read with the host code', () => {
    render(<RosterPage {...pageProps({ agents: [], status: 'error', error: 'AGENTS_REMOTE_FAILED' }).props} />)
    expect(screen.getByRole('alert').textContent).toBe('名册读取失败（AGENTS_REMOTE_FAILED）。')
    // The failure replaces the empty state; both at once would say two
    // different things about the same read.
    expect(screen.queryByText('当前配置没有挂载任何智能体。')).toBeNull()
  })

  it('keeps the roster it already has when a refresh fails', () => {
    render(<RosterPage {...pageProps({ status: 'error', error: 'AGENTS_REMOTE_FAILED' }).props} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('检索体')).toBeTruthy()
  })
})
