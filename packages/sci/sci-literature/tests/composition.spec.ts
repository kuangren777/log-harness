// Proves the literature layer is real, Loader-composed configurability and not
// a hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the session store, the tool registry, the prompt assembly, the storage
// hub/domain, and dsh-sci-literature. The model-visible output it owns — the
// `literature_search` schema, the rendered result, the `sci/literature-searched`
// record — and the durable query history all come from that composition alone,
// with only the four indexes themselves replaced by their recorded replies.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import * as SessionStoreModule from '@deepseek-ai/dsh-session'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SciLiterature from '@deepseek-ai/dsh-sci-literature'
import { stubFetch } from './fetch-stub.ts'
import type { FetchStub } from './fetch-stub.ts'
import { fixture, jsonFixture } from './fixtures.ts'

const CONFIG = fileURLToPath(new URL('./composition.cordis.yml', import.meta.url))
const REPLIES: Readonly<Record<string, string>> = {
  openalex: JSON.stringify(jsonFixture('openalex.json')),
  semanticscholar: JSON.stringify(jsonFixture('semanticscholar.json')),
  arxiv: fixture('arxiv.xml'),
  crossref: JSON.stringify(jsonFixture('crossref.json')),
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  delete process.env.DSH_SCI_LITERATURE_TEST_ROOT
  delete process.env.SCI_LITERATURE_MAILTO
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the checked-in composition through the real Loader.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-literature-composition-'))
  process.env.DSH_SCI_LITERATURE_TEST_ROOT = root
  process.env.SCI_LITERATURE_MAILTO = 'sci@example.org'

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStoreModule],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-sci-literature', SciLiterature],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(CONFIG).href } })
  await ctx.loader.await()
  return ctx
}

/** Serve every index its recorded reply, and record which URLs were requested. */
function stubIndexes(): FetchStub {
  return stubFetch((url) => {
    const source = Object.keys(REPLIES).find(name => url.includes(name))
    return Promise.resolve(source === undefined
      ? new Response('not found', { status: 404 })
      : new Response(REPLIES[source]))
  })
}

/**
 * Run `literature_search` through the composed registry as an agent would.
 * @param ctx - the booted context.
 * @param args - the model arguments.
 * @returns the execution result and the session it ran in.
 */
async function callTool(ctx: Context, args: Record<string, unknown>) {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  const result = await ctx.tools.execute({
    callId: CallId('call-1'),
    name: 'literature_search',
    arguments: args,
    agent: { id: session.id, session } as Agent,
    signal: new AbortController().signal,
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { result, session }
}

describe('sci-literature real Loader composition through cordis.yml', () => {
  it('publishes the model-facing tool schema', async () => {
    const ctx = await boot()

    const schema = ctx.tools.schemas().find(entry => entry.name === 'literature_search')

    expect(schema).toBeDefined()
    expect(schema?.description).toContain('OpenAlex')
    expect(Object.keys(schema?.parameters.properties ?? {}).sort())
      .toEqual(['limit', 'query', 'year_from', 'year_to'])
    expect(schema?.parameters.required).toEqual(['query'])
  })

  it('contributes its prompt section to the assembled system prompt', async () => {
    const ctx = await boot()

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('查学术文献用 literature_search')
  })

  it('searches, renders, and records one call the model made', async () => {
    const ctx = await boot()
    const fetchMock = stubIndexes()

    const { result, session } = await callTool(ctx, { query: 'n-type SnSe thermoelectric', limit: 5 })

    expect(result.isError).toBeFalsy()
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('检索到 18 条，返回前 5 条：')
    expect(text).toContain('doi:10.1103/physrevb.91.205201')
    expect(text.endsWith('引用时写 DOI 或 arXiv id。')).toBe(true)

    expect(session.events.filter(event => event.type === 'sci/literature-searched').map(event => event.data))
      .toEqual([{ query: 'n-type SnSe thermoelectric', hits: 18, sourceErrors: [] }])

    // The mailto the composition carries reached the two polite-pool indexes.
    const polite = fetchMock.mock.calls.map(([url]) => url).filter(url => url.includes('mailto'))
    expect(polite).toHaveLength(2)
  })

  it('carries the search into the query history and forgets it on request', async () => {
    const ctx = await boot()
    stubIndexes()

    await callTool(ctx, { query: 'n-type SnSe thermoelectric' })

    const recent = await ctx.sciLiterature.recent()
    expect(recent.entries).toHaveLength(1)
    expect(recent.entries[0]).toMatchObject({ query: 'n-type SnSe thermoelectric', hits: 18 })

    await ctx.sciLiterature.forget({ id: recent.entries[0]?.id ?? '' })

    expect((await ctx.sciLiterature.recent()).entries).toEqual([])
  })

  it('carries historyLimit through the config so the fourth search drops the first', async () => {
    const ctx = await boot()
    stubIndexes()

    for (const query of ['one', 'two', 'three', 'four']) await ctx.sciLiterature.search({ query })

    expect((await ctx.sciLiterature.recent()).entries.map(row => row.query)).toEqual(['four', 'three', 'two'])
  })

  it('unregisters the tool when the composition is disposed', async () => {
    const ctx = await boot()
    // Held across the teardown: `ctx.tools` itself is a service the same
    // disposal removes, so the registry is read from the reference the
    // composition published rather than from the context afterwards.
    const tools = ctx.tools
    expect(tools.get('literature_search')).toBeDefined()

    await ctx.fiber.dispose()
    context = undefined

    expect(tools.get('literature_search')).toBeUndefined()
  })

  it('records nothing in a session when there is no agent to record for', async () => {
    const ctx = await boot()
    stubIndexes()
    const session = ctx.sessions.create()

    await ctx.tools.execute({
      callId: CallId('call-2'),
      name: 'literature_search',
      arguments: { query: 'n-type SnSe' },
      signal: new AbortController().signal,
    })

    expect(session.events.some(event => event.type === 'sci/literature-searched')).toBe(false)
    expect(SessionStore).toBeDefined()
  })
})
