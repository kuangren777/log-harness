// The client-facing copy of a skill-catalog message withholds the descriptions
// of a protected provider's entries while the logged event stays intact.
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { WITHHELD_DESCRIPTION, redactEventForClient } from '../src/client-redaction.ts'

const CATALOG_TEXT = [
  '<system-reminder>',
  'A skill is a reusable set of task-specific instructions.',
  '<available_skills>',
  '- `sci-paper`: Author a research paper bundle. Not for slides.',
  '- `my-notes`: The user\'s own skill.',
  '</available_skills>',
  '</system-reminder>',
].join('\n')

/** The shape a test reads back out of a redacted or original catalog message. */
interface ReadableCatalog {
  content: { type: string; text: string }[]
  source: { entries: { name: string; description: string; provider: string }[] }
}

function catalogEvent(): SessionEvent {
  const message = createUserMessage({
    content: [{ type: 'text', text: CATALOG_TEXT }],
    source: {
      kind: 'skill-catalog',
      form: 'catalog',
      entries: [
        { name: 'sci-paper', description: 'Author a research paper bundle. Not for slides.', provider: 'sci' },
        { name: 'my-notes', description: 'The user\'s own skill.', provider: 'local' },
      ],
    } as unknown as UserMessage['source'],
  })
  return { type: 'user/message', seq: 1, time: 0, data: message } as unknown as SessionEvent
}

function readable(event: SessionEvent): ReadableCatalog {
  return event.data as unknown as ReadableCatalog
}

describe('redactEventForClient', () => {
  it('withholds a protected provider\'s descriptions in both the entries and the rendered text', () => {
    const event = catalogEvent()
    const redacted = redactEventForClient(event, new Set(['sci']))

    expect(redacted).not.toBe(event)
    expect(readable(redacted).source.entries).toEqual([
      { name: 'sci-paper', description: WITHHELD_DESCRIPTION, provider: 'sci' },
      { name: 'my-notes', description: 'The user\'s own skill.', provider: 'local' },
    ])
    const text = readable(redacted).content[0]!.text
    expect(text).not.toContain('Author a research paper bundle')
    expect(text).toContain(`- \`sci-paper\`: ${WITHHELD_DESCRIPTION}`)
    expect(text).toContain('- `my-notes`: The user\'s own skill.')
    expect(text.startsWith('<system-reminder>')).toBe(true)
  })

  it('leaves the logged event untouched', () => {
    const event = catalogEvent()
    redactEventForClient(event, new Set(['sci']))
    expect(readable(event).content[0]!.text).toContain('Author a research paper bundle')
    expect(readable(event).source.entries[0]!.description).toContain('Author a research paper bundle')
  })

  it('copies non-text content blocks through unchanged', () => {
    const base = catalogEvent()
    const image = { type: 'image', source: { kind: 'base64', mediaType: 'image/png', data: 'AA==' } }
    const data = base.data as unknown as { content: unknown[] }
    const event = { ...base, data: { ...data, content: [...data.content, image] } } as unknown as SessionEvent
    const redacted = redactEventForClient(event, new Set(['sci']))
    const blocks = (redacted.data as unknown as { content: unknown[] }).content
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toBe(image)
  })

  it('returns the same instance when nothing is protected or nothing matches', () => {
    const event = catalogEvent()
    expect(redactEventForClient(event, new Set())).toBe(event)
    expect(redactEventForClient(event, new Set(['other']))).toBe(event)
  })

  it('passes every other event through by identity', () => {
    const plain = {
      type: 'user/message',
      seq: 2,
      time: 0,
      data: createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
    } as unknown as SessionEvent
    const other = { type: 'turn/end', seq: 3, time: 0, data: { turn: 1 } } as unknown as SessionEvent
    expect(redactEventForClient(plain, new Set(['sci']))).toBe(plain)
    expect(redactEventForClient(other, new Set(['sci']))).toBe(other)
  })
})
