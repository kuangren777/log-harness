// @vitest-environment jsdom
/**
 * Focus-containment rules for the phone drawer, against a plain element tree.
 * AppFrame's own spec covers the wiring (Escape, backdrop, focus restore);
 * this one pins the edge decisions the wiring delegates: which elements count
 * as tab stops, and where a Tab that would leave the drawer must land.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { focusableWithin, trapTarget } from '@deepseek-ai/dsh-client-ui-layout/src/client/drawer.ts'

/** Build a detached-but-attached subtree; jsdom needs it in the document for focus to move. */
function tree(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  return root
}

afterEach(() => { document.body.replaceChildren() })

describe('focusableWithin', () => {
  it('collects the tab stops in document order', () => {
    const root = tree(`
      <a href="#one">link</a>
      <button type="button">button</button>
      <input />
      <select></select>
      <textarea></textarea>
      <div tabindex="0">custom</div>
    `)
    expect(focusableWithin(root).map(el => el.tagName.toLowerCase()))
      .toEqual(['a', 'button', 'input', 'select', 'textarea', 'div'])
  })

  it('skips what the browser skips: disabled controls, tabindex -1, and bare elements', () => {
    const root = tree(`
      <button type="button" disabled>off</button>
      <input disabled />
      <select disabled></select>
      <textarea disabled></textarea>
      <div tabindex="-1">unreachable</div>
      <a>no href</a>
      <span>text</span>
    `)
    expect(focusableWithin(root)).toEqual([])
  })
})

describe('trapTarget', () => {
  const stops = (): HTMLElement => tree('<button id="a"></button><button id="b"></button><button id="c"></button>')

  it('has nowhere to send focus in an empty subtree', () => {
    expect(trapTarget(tree('<span>text</span>'), null, false)).toBeUndefined()
  })

  it('wraps the last stop forward and the first stop backward', () => {
    const root = stops()
    expect(trapTarget(root, root.querySelector('#c'), false)?.id).toBe('a')
    expect(trapTarget(root, root.querySelector('#a'), true)?.id).toBe('c')
  })

  it('leaves a move that stays inside to the browser', () => {
    const root = stops()
    expect(trapTarget(root, root.querySelector('#b'), false)).toBeUndefined()
    expect(trapTarget(root, root.querySelector('#b'), true)).toBeUndefined()
  })

  it('pulls focus in from outside, onto the edge the keystroke moves towards', () => {
    const root = stops()
    const outside = document.createElement('button')
    document.body.append(outside)
    expect(trapTarget(root, outside, false)?.id).toBe('a')
    expect(trapTarget(root, outside, true)?.id).toBe('c')
    expect(trapTarget(root, null, false)?.id).toBe('a')
  })
})
