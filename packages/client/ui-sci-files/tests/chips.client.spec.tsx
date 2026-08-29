// @vitest-environment jsdom
/**
 * The produced-file strip: how it groups what the session made, which chip
 * reads as current, and the pin a click asks for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TypeChips } from '../src/client/TypeChips.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Mount the strip over one set of produced paths. */
function chips(paths: readonly string[], current?: string) {
  const onPick = vi.fn()
  const view = render(
    <TypeChips paths={paths} current={current} onPick={onPick} t={makeTranslate(zh)} />,
  )
  return { onPick, view }
}

/** The strip's chips in render order, each as `EXT name`. */
function rendered(): string[] {
  return screen.getAllByRole('button').map(button => button.textContent ?? '')
}

describe('TypeChips', () => {
  it('draws nothing for a session that produced nothing', () => {
    const { view } = chips([])
    expect(view.container.innerHTML).toBe('')
  })

  it('groups files of one kind together, keeping the session order inside each group', () => {
    chips([
      '/p/d/first.pdf',
      '/p/out/table.xlsx',
      '/p/d/second.pdf',
      '/p/w/notes.md',
    ])
    expect(rendered()).toEqual(['PDFfirst.pdf', 'PDFsecond.pdf', 'XLSXtable.xlsx', 'MDnotes.md'])
  })

  it('labels an extensionless file with the head of its own name', () => {
    chips(['/p/Makefile'])
    expect(rendered()).toEqual(['MAKMakefile'])
  })

  it('marks the chip the panel is showing, and only that one', () => {
    chips(['/p/d/a.pdf', '/p/d/b.pdf'], '/p/d/b.pdf')
    const pressed = screen.getAllByRole('button').map(button => button.getAttribute('aria-pressed'))
    expect(pressed).toEqual(['false', 'true'])
  })

  it('marks no chip while the panel shows a file the session did not produce', () => {
    chips(['/p/d/a.pdf'], '/p/notes.md')
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  })

  it('asks for the full path of the chip that was clicked', () => {
    const { onPick } = chips(['/p/d/a.pdf', '/p/out/table.xlsx'])
    fireEvent.click(screen.getByText('table.xlsx'))
    expect(onPick).toHaveBeenCalledWith('/p/out/table.xlsx')
  })

  it('carries the full path in the title, so a truncated name stays readable', () => {
    chips(['/p/deliverables/a-very-long-report-name.pdf'])
    expect(screen.getByRole('button').getAttribute('title')).toBe('/p/deliverables/a-very-long-report-name.pdf')
  })
})
