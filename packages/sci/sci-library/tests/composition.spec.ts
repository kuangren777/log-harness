// Proves the knowledge base is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the session store, the tool registry, the prompt assembly, the storage
// hub/domain, the local filesystem, the webserver, the browser-trust fence, the
// literature layer, and dsh-sci-library. The model-visible output it owns — the
// two tool schemas, the rendered result, the `sci/library-changed` record —
// the durable rows, and the bytes on disk all come from that composition alone,
// with only the network replaced by a recorded reply.
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as SessionStoreModule from '@deepseek-ai/dsh-session'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as FsLocal from '@deepseek-ai/dsh-fs-local'
import * as WebServerModule from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SciLiterature from '@deepseek-ai/dsh-sci-literature'
import * as SciLibrary from '../src/index.ts'
import { UPLOAD_PATH, FILE_PATH } from '../src/upload-route.ts'
import { multipartBody } from './multipart.spec.ts'

const CONFIG = fileURLToPath(new URL('./composition.cordis.yml', import.meta.url))
const BOUNDARY = '----dshCompositionBoundary'
const PDF = Buffer.from('%PDF-1.7 recorded body')
const FIXTURES = new URL('../../sci-literature/tests/fixtures/', import.meta.url)

/**
 * One index's recorded reply, reused from the literature package's own capture
 * of these four services answering `n-type SnSe thermoelectric`.
 * @param name - the fixture file name.
 * @returns the file text.
 */
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')
}

const REPLIES: Readonly<Record<string, string>> = {
  openalex: fixture('openalex.json'),
  semanticscholar: fixture('semanticscholar.json'),
  arxiv: fixture('arxiv.xml'),
  crossref: fixture('crossref.json'),
}
let root: string | undefined
let sandbox: string | undefined
let context: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await context?.fiber.dispose()
  context = undefined
  delete process.env.DSH_SCI_LIBRARY_TEST_ROOT
  delete process.env.DSH_SCI_LIBRARY_TEST_SANDBOX
  for (const directory of [root, sandbox]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
  root = undefined
  sandbox = undefined
})

/**
 * Boot the checked-in composition through the real Loader.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-library-composition-'))
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-sci-library-sandbox-'))
  await mkdir(join(sandbox, 'library'), { recursive: true })
  process.env.DSH_SCI_LIBRARY_TEST_ROOT = root
  process.env.DSH_SCI_LIBRARY_TEST_SANDBOX = sandbox

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
    ['@deepseek-ai/dsh-fs-local', FsLocal],
    ['@deepseek-ai/dsh-host-webserver', WebServerModule],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-sci-literature', SciLiterature],
    ['@deepseek-ai/dsh-sci-library', SciLibrary],
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
  installWriteBytesBridge(ctx)
  return ctx
}

/**
 * Give the composed backend the binary write this package is coded against.
 *
 * `FileSystem.writeBytes` is the filesystem-seam addition landing beside this
 * package (16-Workbench Task A1). Until the abstract class and every backend
 * carry it, the composition installs the same contract onto the mounted local
 * backend so this suite exercises the real runtime → `ctx.fs` path instead of
 * skipping every write. Delete this bridge — and the branch below it — the
 * moment `fs-local` ships the method itself.
 * @param ctx - the booted context.
 */
function installWriteBytesBridge(ctx: Context): void {
  const fs = ctx.fs as unknown as Record<string, unknown>
  if (typeof fs.writeBytes === 'function') return
  fs.writeBytes = async (target: { displayPath: string }, data: Uint8Array): Promise<void> => {
    await mkdir(dirname(target.displayPath), { recursive: true })
    await writeFile(target.displayPath, data)
  }
}

/**
 * Run one tool through the composed registry as an agent would.
 * @param ctx - the booted context.
 * @param name - the tool to call.
 * @param args - the model arguments.
 * @returns the execution result and the session it ran in.
 */
async function callTool(ctx: Context, name: string, args: Record<string, unknown>) {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  const result = await ctx.tools.execute({
    callId: CallId('call-1'),
    name,
    arguments: args,
    agent: { id: session.id, session } as Agent,
    signal: new AbortController().signal,
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { result, session }
}

/**
 * One HTTP round trip against the composition's own webserver.
 * @param ctx - the booted context.
 * @param options - method, path, headers, and body.
 * @returns the status and the body bytes.
 */
async function call(ctx: Context, options: {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Buffer
}): Promise<{ status: number; body: Buffer }> {
  const outgoing = httpRequest({
    method: options.method,
    hostname: '127.0.0.1',
    port: ctx.webServer.port,
    path: options.path,
    headers: options.headers ?? {},
  })
  if (options.body !== undefined) outgoing.write(options.body)
  outgoing.end()
  const [response] = await once(outgoing, 'response') as [IncomingMessage]
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(Buffer.from(chunk as Buffer))
  return { status: response.statusCode ?? 0, body: Buffer.concat(chunks) }
}

/** Serve the recorded index reply and the recorded PDF. */
function stubNetwork(): void {
  vi.stubGlobal('fetch', vi.fn((url: URL | string) => {
    const href = typeof url === 'string' ? url : url.href
    if (href.includes('arxiv.org/pdf')) {
      return Promise.resolve(new Response(PDF, { headers: { 'content-type': 'application/pdf' } }))
    }
    const source = Object.keys(REPLIES).find(name => href.includes(name))
    return Promise.resolve(source === undefined
      ? new Response('not found', { status: 404 })
      : new Response(REPLIES[source]))
  }))
}

describe('sci-library real Loader composition through cordis.yml', () => {
  it('publishes both model-facing tool schemas', async () => {
    const ctx = await boot()

    const search = ctx.tools.schemas().find(schema => schema.name === 'library_search')
    const add = ctx.tools.schemas().find(schema => schema.name === 'library_add')

    expect(Object.keys(search?.parameters.properties ?? {}).sort())
      .toEqual(['kind', 'limit', 'query', 'status', 'tag'])
    expect(Object.keys(add?.parameters.properties ?? {}).sort())
      .toEqual(['arxiv_id', 'doi', 'tags', 'title', 'url', 'with_pdf'])
    expect(add?.parameters.required ?? []).toEqual([])
  })

  it('contributes its prompt section, carrying the configured library root', async () => {
    const ctx = await boot()

    expect(renderPrompt(await ctx.systemPrompt.assemble()))
      .toContain(`${sandbox ?? ''}/library/<条目目录>/`)
  })

  it('adds through the literature layer, records the change, and renders the entry', async () => {
    stubNetwork()
    const ctx = await boot()

    const { result, session } = await callTool(ctx, 'library_add', {
      doi: '10.1103/physrevb.91.205201',
      tags: ['ZT'],
    })

    expect(result.isError).toBeFalsy()
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('已加入知识库：Electronic structure and thermoelectric properties of n - and p -type SnSe')
    expect(session.events.filter(event => event.type === 'sci/library-changed').map(event => event.data))
      .toEqual([{ op: 'add', id: 'doi:10.1103/physrevb.91.205201', kind: 'paper' }])
  })

  it('downloads the open-access PDF into the configured sandbox directory', async () => {
    stubNetwork()
    const ctx = await boot()

    await callTool(ctx, 'library_add', { doi: '10.1103/physrevb.91.205201', with_pdf: true })

    const stored = join(sandbox ?? '', 'library', 'doi-10.1103-physrevb.91.205201', 'doi-10.1103-physrevb.91.205201.pdf')
    expect(await readFile(stored)).toEqual(PDF)
  })

  it('searches what the library holds and names the real file path', async () => {
    stubNetwork()
    const ctx = await boot()
    await callTool(ctx, 'library_add', { doi: '10.1103/physrevb.91.205201', with_pdf: true, tags: ['zt'] })

    const { result } = await callTool(ctx, 'library_search', { query: 'SnSe' })

    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('匹配 1 条，返回前 1 条')
    expect(text).toContain(join(sandbox ?? '', 'library', 'doi-10.1103-physrevb.91.205201'))
  })

  it('uploads a file over the composition’s own webserver and reads it back', async () => {
    const ctx = await boot()
    const body = multipartBody([{ field: 'file', filename: 'data.csv', content: 'x,y\r\n1,2' }], BOUNDARY)

    const uploaded = await call(ctx, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new&kind=dataset`,
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, host: '127.0.0.1' },
      body,
    })

    expect(uploaded.status).toBe(200)
    const stored = JSON.parse(uploaded.body.toString('utf8')) as { entry: { id: string; files: { path: string }[] } }
    expect(await readFile(join(sandbox ?? '', 'library', stored.entry.files[0]?.path ?? ''), 'utf8')).toBe('x,y\r\n1,2')

    const fetched = await call(ctx, {
      method: 'GET',
      path: `${FILE_PATH}?entryId=${encodeURIComponent(stored.entry.id)}&name=data.csv`,
      headers: { host: '127.0.0.1' },
    })

    expect(fetched.status).toBe(200)
    expect(fetched.body.toString('utf8')).toBe('x,y\r\n1,2')
  })

  it('refuses an upload the trust fence does not clear', async () => {
    const ctx = await boot()
    const body = multipartBody([{ field: 'file', filename: 'data.csv', content: 'x' }], BOUNDARY)

    const response = await call(ctx, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        host: 'evil.example',
      },
      body,
    })

    expect(response.status).toBe(403)
  })

  it('answers 413 for a file past the configured cap', async () => {
    const ctx = await boot()
    const body = multipartBody([{ field: 'file', filename: 'big.csv', content: Buffer.alloc(5000, 0x61) }], BOUNDARY)

    const response = await call(ctx, {
      method: 'POST',
      path: `${UPLOAD_PATH}?entryId=new`,
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, host: '127.0.0.1' },
      body,
    })

    expect(response.status).toBe(413)
  })

  it('carries maxEntries through the config so the fourth file-less add drops the first', async () => {
    const ctx = await boot()

    for (const title of ['one', 'two', 'three', 'four']) {
      await ctx.sciLibrary.add({ entry: { id: `note:${title}`, title } })
    }

    expect((await ctx.sciLibrary.list({})).entries.map(row => row.title)).toEqual(['four', 'three', 'two'])
  })

  it('unregisters the tools and the route when the composition is disposed', async () => {
    const ctx = await boot()
    const tools = ctx.tools
    const webServer = ctx.webServer
    expect(tools.get('library_search')).toBeDefined()

    await ctx.fiber.dispose()
    context = undefined

    expect(tools.get('library_search')).toBeUndefined()
    expect(() => webServer.register({ kind: 'prefix', path: '/library-api', handler: () => {} })).not.toThrow()
  })

  it('records nothing in a session when there is no agent to record for', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create()

    await ctx.tools.execute({
      callId: CallId('call-2'),
      name: 'library_add',
      arguments: { title: 'A hand-written note' },
      signal: new AbortController().signal,
    })

    expect(session.events.some(event => event.type === 'sci/library-changed')).toBe(false)
    expect((await ctx.sciLibrary.list({})).total).toBe(1)
  })
})
