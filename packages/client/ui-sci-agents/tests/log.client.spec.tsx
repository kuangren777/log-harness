// @vitest-environment jsdom
/**
 * The delegation log: what a row reads, when the token column exists at all,
 * and the two ways a reader reopens the session that made a call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { LogPage, type LogPageProps } from '../src/client/LogPage.tsx'
import { zh } from '../src/client/locales.ts'
import { CALLS, RESEARCHER } from './records.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** The page's props over one log, with every callback stubbed. */
function pageProps(overrides: Partial<LogPageProps> = {}) {
  const onBack = vi.fn()
  const onOpen = vi.fn()
  const props: LogPageProps = {
    agent: RESEARCHER,
    glyphAt: 0,
    calls: CALLS,
    error: undefined,
    onBack,
    onOpen,
    t,
    ...overrides,
  }
  return { props, onBack, onOpen }
}

describe('the log table', () => {
  it('titles the page and leads back to the roster', () => {
    const b = pageProps()
    render(<LogPage {...b.props} />)

    expect(screen.getByRole('heading', { name: '检索体 · 调用日志' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回智能体' }))
    expect(b.onBack).toHaveBeenCalledTimes(1)
  })

  it('reads every column off the host record', () => {
    render(<LogPage {...pageProps().props} />)

    expect(screen.getByText('08-30 14:02:41')).toBeTruthy()
    expect(screen.getByText('跨库检索 n 型硒化物 zT')).toBeTruthy()
    expect(screen.getByText('11.6s')).toBeTruthy()
    expect(screen.getByText('9.2K')).toBeTruthy()
    expect(screen.getByText('成功')).toBeTruthy()
    expect(screen.getByText('1:36')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })

  it('says a running call is in flight rather than inventing a duration', () => {
    render(<LogPage {...pageProps().props} />)
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
    // The two settled calls of this fixture carry no usage, so their cells
    // read as absent instead of as zero tokens.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('drops the token column when no settlement carried usage', () => {
    const calls = CALLS.map(({ outputTokens: _ignored, ...rest }) => rest)
    render(<LogPage {...pageProps({ calls }).props} />)

    expect(screen.queryByRole('columnheader', { name: 'token' })).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.getByRole('columnheader', { name: '耗时' })).toBeTruthy()
  })
})

describe('reopening the session a call came from', () => {
  it('takes the parent session id off the row that was clicked', () => {
    const b = pageProps()
    render(<LogPage {...b.props} />)

    fireEvent.click(screen.getByRole('row', { name: /跨库检索 n 型硒化物 zT/u }))
    expect(b.onOpen).toHaveBeenCalledWith('session-42')

    fireEvent.click(screen.getByRole('row', { name: /交叉验证 47 条引用/u }))
    expect(b.onOpen).toHaveBeenLastCalledWith('session-43')
  })

  it('answers Enter and Space, and nothing else', () => {
    const b = pageProps()
    render(<LogPage {...b.props} />)
    const row = screen.getByRole('row', { name: /跨库检索/u })

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(b.onOpen).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(row, { key: 'a' })
    expect(b.onOpen).toHaveBeenCalledTimes(2)
  })

  it('states the whole row in its accessible name', () => {
    render(<LogPage {...pageProps().props} />)
    expect(screen.getByRole('row', {
      name: '08-30 14:02:41 · 跨库检索 n 型硒化物 zT · 成功，打开这次委派所在的会话',
    })).toBeTruthy()
  })
})

describe('the log states', () => {
  it('says it is reading while the log is still out', () => {
    render(<LogPage {...pageProps({ calls: undefined }).props} />)
    expect(screen.getByText('正在读取调用日志…')).toBeTruthy()
  })

  it('separates a persona never delegated to from a log it could not read', () => {
    const empty = render(<LogPage {...pageProps({ calls: [] }).props} />)
    expect(screen.getByText('这个智能体还没有被委派过。')).toBeTruthy()
    empty.unmount()

    render(<LogPage {...pageProps({ calls: undefined, error: 'AUDIT_UNAVAILABLE' }).props} />)
    expect(screen.getByRole('alert').textContent).toBe('名册读取失败（AUDIT_UNAVAILABLE）。')
    expect(screen.queryByText('正在读取调用日志…')).toBeNull()
  })
})
