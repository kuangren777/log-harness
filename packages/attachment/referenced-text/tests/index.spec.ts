import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import ReferencedTextRegistry, {
  ReferencedTextError,
  type ReferencedTextRef,
  type ReferencedTextStore,
} from '../src/index.ts'

const SKILL_BODY = 'Run the deployment checklist.'

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function refTo(id: string, text: string, store = 'skills'): ReferencedTextRef {
  return { store, id, sha256: digestOf(text) }
}

/** Store returning fixed bodies by id, counting reads so per-call deduplication is observable. */
class MemoryStore implements ReferencedTextStore {
  readonly reads: string[] = []

  constructor(private readonly bodies: Readonly<Record<string, string>>) {}

  read(ref: ReferencedTextRef): Promise<string> {
    this.reads.push(ref.id)
    const body = this.bodies[ref.id]
    if (body === undefined) {
      return Promise.reject(new ReferencedTextError(`no entry "${ref.id}"`, 'NOT_FOUND'))
    }
    return Promise.resolve(body)
  }
}

async function mount(store?: ReferencedTextStore, name = 'skills'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ReferencedTextRegistry)
  if (store !== undefined) ctx.referencedText.registerStore(name, store)
  return ctx
}

describe('ReferencedTextRegistry.read', () => {
  it('reads through the named store and accepts a matching digest', async () => {
    const ctx = await mount(new MemoryStore({ deploy: SKILL_BODY }))
    expect(await ctx.referencedText.read(refTo('deploy', SKILL_BODY))).toBe(SKILL_BODY)
  })

  it('forwards the caller signal to the store', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const ctx = await mount({
      read: (_ref, signal) => {
        seen.push(signal)
        return Promise.resolve(SKILL_BODY)
      },
    })
    const controller = new AbortController()
    await ctx.referencedText.read(refTo('deploy', SKILL_BODY), controller.signal)
    expect(seen).toEqual([controller.signal])
  })

  it('rejects with STORE_MISSING when no store owns the reference', async () => {
    const ctx = await mount(new MemoryStore({ deploy: SKILL_BODY }))
    await expect(ctx.referencedText.read(refTo('deploy', SKILL_BODY, 'absent')))
      .rejects.toMatchObject({ name: 'ReferencedTextError', code: 'STORE_MISSING' })
  })

  it('rejects with DIGEST_MISMATCH when the store returns different text', async () => {
    const ctx = await mount(new MemoryStore({ deploy: 'Tampered body.' }))
    await expect(ctx.referencedText.read(refTo('deploy', SKILL_BODY)))
      .rejects.toMatchObject({ name: 'ReferencedTextError', code: 'DIGEST_MISMATCH' })
  })

  it('propagates a store-raised NOT_FOUND unchanged', async () => {
    const ctx = await mount(new MemoryStore({}))
    await expect(ctx.referencedText.read(refTo('deploy', SKILL_BODY)))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('ReferencedTextRegistry.registerStore', () => {
  it('throws on a duplicate store name', async () => {
    const ctx = await mount(new MemoryStore({}))
    expect(() => ctx.referencedText.registerStore('skills', new MemoryStore({})))
      .toThrow('a referenced-text store named "skills" is already registered')
  })

  it('removes the store when the registering fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(ReferencedTextRegistry)
    const fiber = await ctx.plugin({
      name: 'memory-referenced-text-store',
      inject: ['referencedText'],
      apply(pluginCtx: Context) {
        pluginCtx.referencedText.registerStore('skills', new MemoryStore({ deploy: SKILL_BODY }))
      },
    })
    expect(await ctx.referencedText.read(refTo('deploy', SKILL_BODY))).toBe(SKILL_BODY)

    await fiber.dispose()
    await expect(ctx.referencedText.read(refTo('deploy', SKILL_BODY)))
      .rejects.toMatchObject({ code: 'STORE_MISSING' })
  })

  it('removes the store when the returned disposer runs', async () => {
    const ctx = new Context()
    await ctx.plugin(ReferencedTextRegistry)
    const dispose = ctx.referencedText.registerStore('skills', new MemoryStore({ deploy: SKILL_BODY }))
    dispose()
    await expect(ctx.referencedText.read(refTo('deploy', SKILL_BODY)))
      .rejects.toMatchObject({ code: 'STORE_MISSING' })
  })
})

describe('ReferencedTextRegistry.resolveMessages', () => {
  it('returns the same array instance when no reference is present', async () => {
    const ctx = await mount(new MemoryStore({}))
    const messages: readonly Message[] = [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
      createToolResultMessage({
        callId: CallId('call-1'),
        content: [{ type: 'text', text: 'done' }],
        isError: false,
      }),
    ]
    expect(await ctx.referencedText.resolveMessages(messages)).toBe(messages)
  })

  it('replaces top-level and nested tool-result references and leaves other blocks alone', async () => {
    const ctx = await mount(new MemoryStore({ deploy: SKILL_BODY, notes: 'Second body.' }))
    const plain = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] })
    const mixed = createUserMessage({
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'before' },
        { type: 'referenced-text', ...refTo('deploy', SKILL_BODY) },
        {
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'referenced-text', ...refTo('notes', 'Second body.') }],
          isError: false,
        },
        {
          type: 'tool-result',
          toolCallId: CallId('call-2'),
          content: [{ type: 'text', text: 'untouched' }],
          isError: false,
        },
      ],
    })
    const messages: readonly Message[] = [plain, mixed]

    const resolved = await ctx.referencedText.resolveMessages(messages)

    expect(resolved).not.toBe(messages)
    expect(resolved[0]).toBe(plain)
    expect(resolved[1]?.id).toBe(mixed.id)
    expect(resolved[1]?.content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: SKILL_BODY },
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'Second body.' }],
        isError: false,
      },
      {
        type: 'tool-result',
        toolCallId: 'call-2',
        content: [{ type: 'text', text: 'untouched' }],
        isError: false,
      },
    ])
    expect(resolved[1]?.content[3]).toBe(mixed.content[3])
  })

  it('leaves the deep-frozen input messages unchanged', async () => {
    const ctx = await mount(new MemoryStore({ deploy: SKILL_BODY }))
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'referenced-text', ...refTo('deploy', SKILL_BODY) }],
    })
    expect(Object.isFrozen(message.content)).toBe(true)

    await ctx.referencedText.resolveMessages([message])

    expect(message.content).toEqual([{ type: 'referenced-text', ...refTo('deploy', SKILL_BODY) }])
  })

  it('reads each distinct reference once per call', async () => {
    const store = new MemoryStore({ deploy: SKILL_BODY })
    const ctx = await mount(store)
    const block = { type: 'referenced-text', ...refTo('deploy', SKILL_BODY) } as const
    const messages: readonly Message[] = [
      createUserMessage({ source: { kind: 'user' }, content: [{ ...block }] }),
      createUserMessage({ source: { kind: 'user' }, content: [{ ...block }] }),
    ]

    const resolved = await ctx.referencedText.resolveMessages(messages)

    expect(store.reads).toEqual(['deploy'])
    expect(resolved.map(message => message.content)).toEqual([
      [{ type: 'text', text: SKILL_BODY }],
      [{ type: 'text', text: SKILL_BODY }],
    ])
  })

  it('rejects the whole resolution when one reference fails verification', async () => {
    const ctx = await mount(new MemoryStore({ deploy: 'Tampered body.' }))
    const messages: readonly Message[] = [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'referenced-text', ...refTo('deploy', SKILL_BODY) }],
    })]
    await expect(ctx.referencedText.resolveMessages(messages))
      .rejects.toMatchObject({ code: 'DIGEST_MISMATCH' })
  })
})
