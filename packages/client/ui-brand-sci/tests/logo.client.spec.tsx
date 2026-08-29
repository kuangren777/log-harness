// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LOGO_TEST_ID, SciLogo } from '../src/client/SciLogo.tsx'

afterEach(() => {
  cleanup()
})

describe('CaMeL Science orbit logo', () => {
  it('draws three orbits and a nucleus at the requested size', () => {
    const view = render(<SciLogo size={22} />)
    const svg = view.getByTestId(LOGO_TEST_ID)
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('width')).toBe('22')
    expect(svg.getAttribute('height')).toBe('22')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.style.display).toBe('block')

    const ellipses = svg.querySelectorAll('ellipse')
    expect(ellipses).toHaveLength(3)
    expect([...ellipses].map(node => node.getAttribute('transform')))
      .toEqual(['rotate(0 12 12)', 'rotate(60 12 12)', 'rotate(120 12 12)'])
    for (const orbit of ellipses) {
      expect(orbit.getAttribute('rx')).toBe('9.2')
      expect(orbit.getAttribute('ry')).toBe('3.9')
      expect(orbit.getAttribute('stroke')).toBe('currentColor')
      expect(orbit.getAttribute('stroke-width')).toBe('1.5')
      expect(orbit.getAttribute('fill')).toBe('none')
    }

    const nucleus = svg.querySelectorAll('circle')
    expect(nucleus).toHaveLength(1)
    expect(nucleus[0]?.getAttribute('r')).toBe('2.1')
    expect(nucleus[0]?.getAttribute('fill')).toBe('currentColor')
  })

  it('takes its colour from the host surface and stays out of the a11y tree', () => {
    const view = render(<SciLogo size={16} />)
    const svg = view.getByTestId(LOGO_TEST_ID)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3}/i)
  })
})
