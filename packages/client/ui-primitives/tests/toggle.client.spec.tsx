// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toggle } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('Toggle', () => {
  it('renders a switch with aria-checked and calls onChange with the inverted value', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Toggle checked={false} onChange={onChange} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Toggle checked onChange={onChange} />)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('disabled blocks the click and sets the native disabled attribute', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} disabled />)
    const toggle = screen.getByRole('switch')
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(toggle)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders the label text inside the switch and toggles when it is clicked', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Auto-save" />)
    const toggle = screen.getByRole('switch', { name: 'Auto-save' })
    fireEvent.click(screen.getByText('Auto-save'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(toggle).toBe(screen.getByText('Auto-save').closest('button'))
  })

  it('forwards className and extra native attributes', () => {
    render(<Toggle checked={false} onChange={() => {}} className="x" id="my-toggle" title="on/off" />)
    const toggle = screen.getByRole('switch')
    expect(toggle.classList.contains('x')).toBe(true)
    expect(toggle.id).toBe('my-toggle')
    expect(toggle.getAttribute('title')).toBe('on/off')
  })
})
