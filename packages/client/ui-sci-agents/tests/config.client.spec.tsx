// @vitest-environment jsdom
/**
 * The configuration page: which controls the host's own catalog and settings
 * put on screen, what each gesture writes, and what the indicator says
 * instead of a save button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ConfigPage, type ConfigPageProps } from '../src/client/ConfigPage.tsx'
import { zh } from '../src/client/locales.ts'
import { CATALOG, DELIVERER, RESEARCHER } from './records.client.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** The page's props over one persona, with every callback stubbed. */
function pageProps(overrides: Partial<ConfigPageProps> = {}) {
  const onBack = vi.fn()
  const onPatch = vi.fn()
  const props = {
    agent: RESEARCHER,
    glyphAt: 0,
    catalog: CATALOG,
    save: 'idle',
    saveError: null,
    onBack,
    onPatch,
    t,
    ...overrides,
  } as unknown as ConfigPageProps
  return { props, onBack, onPatch }
}

describe('the persona header', () => {
  it('names the persona and its glyph, and leads back to the roster', () => {
    const b = pageProps()
    render(<ConfigPage {...b.props} />)

    expect(screen.getByRole('heading', { name: '检索体 · 配置' })).toBeTruthy()
    expect(screen.getByText('文献检索 · 质量评级')).toBeTruthy()
    expect(screen.getByText('α')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '返回智能体' }))
    expect(b.onBack).toHaveBeenCalledTimes(1)
  })
})

describe('the base-model control', () => {
  it('offers the host catalog and marks the model in force', () => {
    render(<ConfigPage {...pageProps().props} />)

    expect(screen.getByText('deepseek')).toBeTruthy()
    expect(screen.getByText('pi-ai')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'deepseek-reasoner' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'deepseek-chat' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'pi-fast' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('writes the whole selection, provider included', () => {
    const b = pageProps()
    render(<ConfigPage {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'pi-fast' }))
    expect(b.onPatch).toHaveBeenCalledWith({ model: { provider: 'pi-ai', model: 'pi-fast' } })
  })

  it('says the agent follows the session model when none is pinned', () => {
    render(<ConfigPage {...pageProps({ agent: DELIVERER }).props} />)
    expect(screen.getByText('未指定，沿用会话模型')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'deepseek-chat' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('states an unreadable catalog instead of offering an empty choice', () => {
    render(<ConfigPage {...pageProps({ catalog: [] }).props} />)
    expect(screen.getByText('读不到模型目录，这个智能体沿用会话当前的模型。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'deepseek-chat' })).toBeNull()
  })
})

describe('the settings this page does not offer', () => {
  it('offers no reasoning-depth control, because no depth would reach the child', () => {
    render(<ConfigPage {...pageProps().props} />)

    // `AgentOptions` (packages/core/agent/src/runtime-types.ts:24-31) carries
    // provider/model/maxTokens and nothing else, so a depth chosen here would
    // be written to settings and then read by nobody. The host accordingly
    // declares no depths, and this page offers no control for one.
    expect(screen.queryByText('推理深度')).toBeNull()
    expect(screen.queryByRole('button', { name: '均衡' })).toBeNull()
    expect(screen.queryByRole('button', { name: '极速' })).toBeNull()
    expect(screen.queryByRole('button', { name: '穷尽' })).toBeNull()
    // Three cards: the model, the permissions, the enable switch.
    expect(screen.getAllByText(/基座模型|工具权限/u)).toHaveLength(2)
  })

  it('draws the model card even for a pin the catalog no longer carries', () => {
    const retired = { ...RESEARCHER, model: { provider: 'anthropic', model: 'deepseek-v9' } }
    render(<ConfigPage {...pageProps({ agent: retired }).props} />)

    // Nothing is pressed, and the page still offers every real choice rather
    // than blanking on a model the host has since dropped.
    expect(screen.getByRole('button', { name: 'deepseek-chat' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'pi-fast' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the permission and enable switches', () => {
  it('reflects the three permissions the host resolved', () => {
    render(<ConfigPage {...pageProps().props} />)

    expect(screen.getByRole('switch', { name: '联网检索' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: '沙箱代码执行' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '写入知识库' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('允许使用网页搜索、网页抓取与文献检索。')).toBeTruthy()
  })

  it('writes all three permissions together, with the flipped one changed', () => {
    const b = pageProps()
    render(<ConfigPage {...b.props} />)

    fireEvent.click(screen.getByRole('switch', { name: '联网检索' }))
    expect(b.onPatch).toHaveBeenLastCalledWith({
      permissions: { web: false, code: false, writeLibrary: true },
    })

    fireEvent.click(screen.getByRole('switch', { name: '沙箱代码执行' }))
    expect(b.onPatch).toHaveBeenLastCalledWith({
      permissions: { web: true, code: true, writeLibrary: true },
    })

    fireEvent.click(screen.getByRole('switch', { name: '写入知识库' }))
    expect(b.onPatch).toHaveBeenLastCalledWith({
      permissions: { web: true, code: false, writeLibrary: false },
    })
  })

  it('names the tool a disabled persona would refuse', () => {
    render(<ConfigPage {...pageProps({ agent: DELIVERER }).props} />)

    const enable = screen.getByRole('switch', { name: '启用该智能体' })
    expect(enable.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('停用后，模型调用 subagent_deliverer 会收到明确的拒绝，不再创建子智能体。')).toBeTruthy()
  })

  it('writes the enable flip', () => {
    const b = pageProps()
    render(<ConfigPage {...b.props} />)
    fireEvent.click(screen.getByRole('switch', { name: '启用该智能体' }))
    expect(b.onPatch).toHaveBeenCalledWith({ enabled: false })
  })
})

describe('the save indicator', () => {
  it('states that changes save themselves, and never offers a save button', () => {
    render(<ConfigPage {...pageProps().props} />)
    expect(screen.getByRole('status').textContent).toBe('改动即时保存')
    expect(screen.queryByRole('button', { name: '保存配置' })).toBeNull()
  })

  it('follows the write through its two settled ends', () => {
    const saving = render(<ConfigPage {...pageProps({ save: 'saving' }).props} />)
    expect(screen.getByRole('status').textContent).toBe('保存中…')
    saving.unmount()

    const saved = render(<ConfigPage {...pageProps({ save: 'saved' }).props} />)
    expect(screen.getByRole('status').textContent).toBe('已保存')
    saved.unmount()

    render(<ConfigPage {...pageProps({ save: 'error', saveError: 'SETTINGS_WRITE_DENIED' }).props} />)
    expect(screen.getByRole('status').textContent).toBe('保存失败（SETTINGS_WRITE_DENIED）')
  })
})
