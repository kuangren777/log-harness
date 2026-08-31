// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
  Moon, MorphStrokeIcon, Search, StrokeIcon, Sun,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('stroke icon set (lucide geometry via StrokeIcon)', () => {
  it('exports the full icon set (70 exports, one per former ic_ds_* glyph)', () => {
    expect(iconNames.length).toBe(70)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the fish path in currentColor at the native ratio', () => {
    const { container } = render(<primitives.FishLogo />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(17.66, 1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toContain('M0 0L23.16')
  })
})

describe('BrandWordmark', () => {
  it('can render the name artwork with or without its leading mark', () => {
    const view = render(<primitives.BrandWordmark />)
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('182')
    expect(svg.getAttribute('viewBox')).toBe('0 0 182 24')

    view.rerender(<primitives.BrandWordmark includeMark={false} />)
    expect(svg.getAttribute('width')).toBe('156')
    expect(svg.getAttribute('viewBox')).toBe('26 0 156 24')
  })
})

describe('stroke icon kernel', () => {
  it('StrokeIcon draws every element of a lucide IconNode as stroked svg children', () => {
    const { container } = render(<StrokeIcon icon={Search} size={18} className="y" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('height')).toBe('18')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.7')
    expect(svg.classList.contains('y')).toBe(true)
    expect(svg.querySelector('path')).not.toBeNull()
    expect(svg.querySelector('circle')).not.toBeNull()
  })

  it('StrokeIcon drops undefined node attributes', () => {
    const node = [['path', { d: 'M1 1h4', fill: undefined }]] as const
    const { container } = render(<StrokeIcon icon={node} />)
    expect(container.querySelector('path')!.getAttribute('fill')).toBeNull()
  })

  it('MorphStrokeIcon swaps the drawn geometry when the icon prop changes', () => {
    const view = render(<MorphStrokeIcon icon={Sun} reducedMotion="always" />)
    const before = view.container.querySelector('path')!.getAttribute('d')
    expect(before).not.toBe('')
    view.rerender(<MorphStrokeIcon icon={Moon} reducedMotion="always" />)
    const after = view.container.querySelector('path')!.getAttribute('d')
    expect(after).not.toBe(before)
    expect(view.container.innerHTML).toContain('currentColor')
    // Same stroke-width grid units as StrokeIcon, so morphing and static icons render at equal weight.
    expect(view.container.querySelector('svg')!.getAttribute('stroke-width')).toBe('1.7')
  })

  it('MorphStrokeIcon honors an explicit spring', () => {
    const view = render(<MorphStrokeIcon icon={Sun} spring="bouncy" />)
    view.rerender(<MorphStrokeIcon icon={Moon} spring="bouncy" />)
    expect(view.container.querySelector('path')).not.toBeNull()
  })
})
