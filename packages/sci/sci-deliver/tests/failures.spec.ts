// The buffer replaces the studied platform's silent shell-delivery failure, so
// the behaviour that matters is that a failure reaches the model EXACTLY once:
// present in the next assembly, absent in the one after.
import { describe, expect, it } from 'vitest'
import { DeliveryFailureBuffer, renderDeliveryFailures } from '@deepseek-ai/dsh-sci-deliver'

describe('renderDeliveryFailures', () => {
  it('contributes nothing for no failures', () => {
    expect(renderDeliveryFailures([])).toBe('')
  })

  it('reports one failure in the singular', () => {
    expect(renderDeliveryFailures([{ path: '/p/tmp/a.pdf', reason: 'outside the delivery area' }])).toBe(
      '1 shell delivery failed and reached nobody:\n'
      + '- /p/tmp/a.pdf: outside the delivery area\n'
      + 'Fix the path or the manifest and deliver those files again.',
    )
  })

  it('reports several failures in recording order', () => {
    const text = renderDeliveryFailures([
      { path: '/p/tmp/a.pdf', reason: 'first' },
      { path: '/p/tmp/b.pdf', reason: 'second' },
    ])
    expect(text.split('\n')).toEqual([
      '2 shell deliveries failed and reached nobody:',
      '- /p/tmp/a.pdf: first',
      '- /p/tmp/b.pdf: second',
      'Fix the path or the manifest and deliver those files again.',
    ])
  })
})

describe('DeliveryFailureBuffer', () => {
  it('materialises pending failures once and then clears them', () => {
    const buffer = new DeliveryFailureBuffer()
    expect(buffer.take()).toBe('')

    buffer.record({ path: '/p/tmp/a.pdf', reason: 'outside the delivery area' })
    expect(buffer.take()).toContain('/p/tmp/a.pdf')
    expect(buffer.take()).toBe('')
  })

  it('accumulates failures recorded between two reads', () => {
    const buffer = new DeliveryFailureBuffer()
    buffer.record({ path: '/p/a', reason: 'first' })
    buffer.record({ path: '/p/b', reason: 'second' })
    expect(buffer.take()).toContain('2 shell deliveries failed')
    buffer.record({ path: '/p/c', reason: 'third' })
    expect(buffer.take()).toContain('1 shell delivery failed')
  })
})
