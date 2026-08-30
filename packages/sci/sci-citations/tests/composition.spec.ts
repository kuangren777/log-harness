// Proves the citation pool is real, Loader-composed configurability and not a
// hand-built ctx.plugin() suite: a cordis.yml booted through the real Loader
// mounts the session store, the tool registry, the prompt assembly, the storage
// hub/domain, the local filesystem, the literature layer, and
// dsh-sci-citations. The model-visible output it owns — the two tool schemas,
// the rendered result, the `sci/citations-changed` record — the durable rows,
// and the bytes of `refs.bib` on disk all come from that composition alone,
// with only the network replaced by a recorded reply.
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as SciLiterature from '@deepseek-ai/dsh-sci-literature'
import * as SciCitations from '../src/index.ts'
import { CITATIONS_ADD_TOOL, CITATIONS_LIST_TOOL } from '../src/tool.ts'

const CONFIG = fileURLToPath(new URL('./composition.cordis.yml', import.meta.url))
const FIXTURES = new URL('../../sci-literature/tests/fixtures/', import.meta.url)
const DOI = '10.1103/physrevb.91.205201'
const PROJECT = 'snse'
// The citekey the recorded OpenAlex/Crossref replies mint: first author Kutorasinski, 2015.
const CITEKEY = 'kutorasinski2015'

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
  delete process.env.DSH_SCI_CITATIONS_TEST_ROOT
  delete process.env.DSH_SCI_CITATIONS_TEST_SANDBOX
  for (const directory of [root, sandbox]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
  root = undefined
  sandbox = undefined
})

/** The project directory the composition is pointed at. */
function projectDir(): string {
  return join(sandbox ?? '', 'projects', PROJECT)
}

/** The bibliography of the project's one paper bundle. */
function refsPath(): string {
  return join(projectDir(), 'papers', 'p1', 'src', 'refs.bib')
}

/**
 * Boot the checked-in composition through the real Loader, over a real project tree.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-citations-composition-'))
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-sci-citations-sandbox-'))
  await mkdir(join(projectDir(), 'papers', 'p1', 'src'), { recursive: true })
  await mkdir(join(projectDir(), 'workspace'), { recursive: true })
  process.env.DSH_SCI_CITATIONS_TEST_ROOT = root
  process.env.DSH_SCI_CITATIONS_TEST_SANDBOX = sandbox

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
    ['@deepseek-ai/dsh-sci-literature', SciLiterature],
    ['@deepseek-ai/dsh-sci-citations', SciCitations],
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

/**
 * Run one tool through the composed registry as an agent working in the project would.
 * @param ctx - the booted context.
 * @param name - the tool to call.
 * @param args - the model arguments.
 * @returns the execution result and the session it ran in.
 */
async function callTool(ctx: Context, name: string, args: Record<string, unknown>) {
  const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir() } })
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
 * The text a model reads back from one result.
 * @param result - the execution result.
 * @returns the joined text blocks.
 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('\n')
}

/** Serve the recorded index replies. */
function stubNetwork(): void {
  vi.stubGlobal('fetch', vi.fn((url: URL | string) => {
    const href = typeof url === 'string' ? url : url.href
    const source = Object.keys(REPLIES).find(name => href.includes(name))
    return Promise.resolve(source === undefined
      ? new Response('not found', { status: 404 })
      : new Response(REPLIES[source]))
  }))
}

describe('sci-citations real Loader composition through cordis.yml', () => {
  it('publishes both model-facing tool schemas', async () => {
    const ctx = await boot()

    const list = ctx.tools.schemas().find(schema => schema.name === CITATIONS_LIST_TOOL)
    const add = ctx.tools.schemas().find(schema => schema.name === CITATIONS_ADD_TOOL)

    expect(Object.keys(list?.parameters.properties ?? {}).sort()).toEqual(['group', 'project'])
    expect(Object.keys(add?.parameters.properties ?? {}).sort())
      .toEqual(['arxiv_id', 'citekey', 'doi', 'group', 'library_id', 'project'])
    expect(add?.parameters.required ?? []).toEqual([])
  })

  it('contributes its prompt section', async () => {
    const ctx = await boot()

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('不要自己编 citekey')
  })

  it('resolves a DOI through the literature layer, writes refs.bib, and records the change', async () => {
    stubNetwork()
    const ctx = await boot()

    const { result, session } = await callTool(ctx, CITATIONS_ADD_TOOL, { doi: DOI })

    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain(`已加入引用池：[${CITEKEY}]`)
    expect(await readFile(refsPath(), 'utf8')).toContain(`@article{${CITEKEY},`)
    expect(session.events.filter(event => event.type === 'sci/citations-changed').map(event => event.data))
      .toEqual([{ project: PROJECT, op: 'add', citekey: CITEKEY }])
  })

  it('infers the project from the session’s working directory, with no project argument', async () => {
    stubNetwork()
    const ctx = await boot()
    await callTool(ctx, CITATIONS_ADD_TOOL, { doi: DOI })

    const { result } = await callTool(ctx, CITATIONS_LIST_TOOL, {})

    expect(text(result)).toContain(`项目 ${PROJECT}：1 条引用`)
    expect(text(result)).toContain(`[1] [${CITEKEY}]`)
  })

  it('refuses rather than guessing when the session is not inside a project', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create(undefined, { meta: { cwd: tmpdir() } })

    const result = await ctx.tools.execute({
      callId: CallId('call-2'),
      name: CITATIONS_LIST_TOOL,
      arguments: {},
      agent: { id: session.id, session } as Agent,
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('无法推断是哪个项目的引用池')
  })

  it('counts the citations the manuscript on disk actually makes', async () => {
    stubNetwork()
    const ctx = await boot()
    await callTool(ctx, CITATIONS_ADD_TOOL, { doi: DOI })
    await writeFile(join(projectDir(), 'papers', 'p1', 'src', 'main.tex'), `as \\cite{${CITEKEY}} and \\citep{${CITEKEY}}\n`)
    await writeFile(join(projectDir(), 'workspace', 'draft.md'), `see \`[${CITEKEY}]\`\n`)

    const rescanned = await ctx.sciCitations.rescan({ project: PROJECT })

    expect(rescanned.pool.citations[0]).toMatchObject({ citekey: CITEKEY, uses: 3 })
    expect(rescanned.pool.stats.scannedFiles).toBe(2)
  })

  it('reads a hand-written refs.bib back into the pool and exports it again', async () => {
    const ctx = await boot()
    await writeFile(refsPath(), '@article{hand2020,\n  title = {A hand-written entry},\n  year = {2020},\n}\n')

    const rescanned = await ctx.sciCitations.rescan({ project: PROJECT })
    const exported = await ctx.sciCitations.exportBibtex({ project: PROJECT })

    expect(rescanned.pool.citations.map(row => row.citekey)).toEqual(['hand2020'])
    expect(exported.bibtex).toContain('@misc{hand2020,')
  })

  it('lists the project directory the configuration points at', async () => {
    const ctx = await boot()

    expect(await ctx.sciCitations.projects()).toEqual({ projects: [{ slug: PROJECT, papers: ['p1'] }] })
  })

  it('carries maxCitations through the config so the fourth add is refused', async () => {
    const ctx = await boot()

    for (const citekey of ['a', 'b', 'c']) {
      await ctx.sciCitations.add({ project: PROJECT, citekey, record: { title: citekey } })
    }

    await expect(ctx.sciCitations.add({ project: PROJECT, citekey: 'd', record: { title: 'd' } }))
      .rejects.toThrow('引用池已满')
  })

  it('unregisters the tools when the composition is disposed', async () => {
    const ctx = await boot()
    const tools = ctx.tools
    expect(tools.get(CITATIONS_LIST_TOOL)).toBeDefined()

    await ctx.fiber.dispose()
    context = undefined

    expect(tools.get(CITATIONS_LIST_TOOL)).toBeUndefined()
  })
})
