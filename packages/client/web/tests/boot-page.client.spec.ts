// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('draws the loading skeleton before any plugin state arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('CaMeL Science')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it('draws the orbit glyph the brand plugin reuses once it lands', () => {
    const { el } = mount()
    const glyph = el.querySelector('[data-dsh-boot-spinner] svg')
    expect(glyph?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(glyph?.querySelectorAll('ellipse')).toHaveLength(3)
    expect(glyph?.querySelectorAll('circle')).toHaveLength(1)
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-progress')).toBe('8%')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-progress')).toBe('54%')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-progress')).toBe('100%')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('counts activated entries against the roster', () => {
    const { el, page } = mount()
    page.setTotal(3)
    expect(el.textContent).toContain('0/3')
    page.setState('a', 'active')
    expect(el.textContent).toContain('1/3')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('Failed to load plugins')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('marks the halted boot so its glyph stops animating', () => {
    const { el, page } = mount()
    const root = el.firstElementChild as HTMLElement
    expect(root.dataset.dshBootFailed).toBeUndefined()
    page.setState('a', 'failed')
    expect(root.dataset.dshBootFailed).toBe('')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
