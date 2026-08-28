/**
 * Referenced-text resolution at DeepSeek request build: a `referenced-text`
 * block must reach the wire as exactly the text a plain `text` block in the
 * same position would produce, and a reference the harness cannot verify must
 * fail the request instead of silently dropping the body.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import ReferencedTextRegistry from '@deepseek-ai/dsh-referenced-text'
import type { ReferencedTextRef, ReferencedTextStore } from '@deepseek-ai/dsh-referenced-text'
import { ReferencedTextError } from '@deepseek-ai/dsh-referenced-text'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
const MODEL = 'deepseek-v4-flash'
const SKILL_BODY = 'Run the deployment checklist.\nStep two.'
const NOTES_BODY = 'Tool notes body.'
let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-deepseek-referenced-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(testHome, { recursive: true, force: true })
})

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function refTo(id: string, text: string, store = 'skills'): ReferencedTextRef {
  return { store, id, sha256: digestOf(text) }
}

/** Store returning fixed bodies by id; an unknown id fails the way a real store does. */
class MemoryStore implements ReferencedTextStore {
  constructor(private readonly bodies: Readonly<Record<string, string>>) {}

  read(ref: ReferencedTextRef): Promise<string> {
    const body = this.bodies[ref.id]
    if (body === undefined) {
      return Promise.reject(new ReferencedTextError(`no entry "${ref.id}"`, 'NOT_FOUND'))
    }
    return Promise.resolve(body)
  }
}

async function mountRegistry(store: ReferencedTextStore): Promise<ReferencedTextRegistry> {
  const ctx = new Context()
  await ctx.plugin(ReferencedTextRegistry)
  ctx.referencedText.registerStore('skills', store)
  return ctx.referencedText
}

/** Direct adapter over the plugin's real resolve step, with a static key. */
function adapterOf(
  baseURL: string,
  resolveReferencedText?: () => ReferencedTextRegistry | undefined,
): DeepSeekAdapter {
  return new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ baseURL }),
    resolveApiKey: () => Promise.resolve('k'),
    resolveUserId: () => TEST_USER_ID,
    ...resolveReferencedText === undefined ? {} : { resolveReferencedText },
  })
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) { /* drain */ }
}

/** One user message whose text arrives through references, at top level and inside a tool result. */
function referencedContent(): ContentBlock[] {
  return [
    { type: 'text', text: 'A' },
    { type: 'referenced-text', ...refTo('deploy', SKILL_BODY) },
    { type: 'text', text: 'B' },
    {
      type: 'tool-result',
      toolCallId: CallId('call-1'),
      content: [{ type: 'referenced-text', ...refTo('notes', NOTES_BODY) }],
      isError: false,
    },
  ]
}

/** The same message with every reference already replaced by the text it names. */
function resolvedContent(): ContentBlock[] {
  return [
    { type: 'text', text: 'A' },
    { type: 'text', text: SKILL_BODY },
    { type: 'text', text: 'B' },
    {
      type: 'tool-result',
      toolCallId: CallId('call-1'),
      content: [{ type: 'text', text: NOTES_BODY }],
      isError: false,
    },
  ]
}

function userMessage(content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: 'plugin', plugin: 'test' } })
}

function request(messages: readonly Message[], signal?: AbortSignal): GenerateOptions {
  return {
    provider: 'deepseek-official',
    model: MODEL,
    messages: [...messages],
    ...signal === undefined ? {} : { signal },
  }
}

describe('referenced text in a DeepSeek request', () => {
  it('sends the same wire request a plain text block in the same position would produce', async () => {
    const server = await mockServer([
      { kind: 'sse', events: textEvents },
      { kind: 'sse', events: textEvents },
    ])
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ReferencedTextRegistry)
    ctx.referencedText.registerStore('skills', new MemoryStore({
      deploy: SKILL_BODY,
      notes: NOTES_BODY,
    }))
    await ctx.plugin(LlmDeepSeek, { baseURL: server.url })

    await assemble(ctx, { model: MODEL, messages: [userMessage(referencedContent())] })
    await assemble(ctx, { model: MODEL, messages: [userMessage(resolvedContent())] })

    expect(JSON.stringify(server.requests[0])).toBe(JSON.stringify(server.requests[1]))
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'user', content: `A${SKILL_BODY}B` },
        { role: 'tool', tool_call_id: 'call-1', content: NOTES_BODY },
      ],
    })
  })

  it.each([
    ['no resolver is configured', undefined],
    ['the service is not mounted', () => undefined],
  ])('fails the request before any HTTP call when %s', async (_case, resolve) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const adapter = adapterOf('https://deepseek.invalid', resolve)

    await expect(drain(adapter.stream(request([userMessage(referencedContent())])))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
      message: 'DeepSeek request carries referenced text but no referenced-text service is mounted.',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails the request before any HTTP call when stored text no longer matches its digest', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const registry = await mountRegistry(new MemoryStore({
      deploy: 'Tampered body.',
      notes: NOTES_BODY,
    }))
    const adapter = adapterOf('https://deepseek.invalid', () => registry)

    await expect(drain(adapter.stream(request([userMessage(referencedContent())])))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
      message: expect.stringContaining('DeepSeek could not resolve referenced text for this request:') as string,
      cause: { code: 'DIGEST_MISMATCH' },
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports caller cancellation during resolution as ABORTED', async () => {
    const started = Promise.withResolvers<undefined>()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const registry = await mountRegistry({
      read: (_ref, signal) => new Promise<string>((_resolve, reject) => {
        started.resolve(undefined)
        signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
      }),
    })
    const controller = new AbortController()
    const adapter = adapterOf('https://deepseek.invalid', () => registry)

    const pending = drain(adapter.stream(request(
      [userMessage(referencedContent())],
      controller.signal,
    )))
    await started.promise
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not consult the referenced-text service for a request without references', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const registry = await mountRegistry(new MemoryStore({}))
    const resolveMessages = vi.spyOn(registry, 'resolveMessages')
    const adapter = adapterOf(server.url, () => registry)

    await drain(adapter.stream(request([userMessage([
      { type: 'text', text: 'A' },
      {
        type: 'tool-result',
        toolCallId: CallId('call-1'),
        content: [{ type: 'text', text: NOTES_BODY }],
        isError: false,
      },
    ])])))

    expect(resolveMessages).not.toHaveBeenCalled()
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'user', content: 'A' },
        { role: 'tool', tool_call_id: 'call-1', content: NOTES_BODY },
      ],
    })
  })
})
