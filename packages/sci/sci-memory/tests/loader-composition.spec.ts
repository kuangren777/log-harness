// Proves the science-research memory layer is real, Loader-composed
// configurability and not a hand-built ctx.plugin() suite: a cordis.yml booted
// through the real Loader mounts the session store, the tool registry, a real
// local filesystem, the storage hub/domain, the session-query backend, and
// dsh-sci-memory. The durable output it owns — the repaired memory node on
// disk, its `sci/memory-written` record, and the recall rows the RPC serves —
// appears from that composition alone, and the memory directory it watches
// follows the config through the Loader.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as SessionStore from '@deepseek-ai/dsh-session'
import * as SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as SciMemory from '@deepseek-ai/dsh-sci-memory'

const NODE = [
  '---',
  'name: gh-auth-via-host-config',
  'description: How gh authenticates inside the sandbox',
  'metadata:',
  '  node_type: memory',
  '  type: reference',
  '---',
  '',
  'Export GH_CONFIG_DIR.',
  '',
].join('\n')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given sci-memory config block.
 * @param configLines - extra YAML lines nested under the plugin's `config:` key.
 * @param omitMemoryDir - whether to leave the required `memoryDir` out.
 * @returns the booted context and the memory directory the composition watches.
 */
async function boot(configLines: readonly string[] = [], omitMemoryDir = false): Promise<{
  ctx: Context
  memoryDir: string
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-memory-loader-'))
  const sandbox = join(root, 'sci')
  const memoryDir = join(sandbox, 'memory')
  await mkdir(memoryDir, { recursive: true })
  await mkdir(join(sandbox, 'workspace'), { recursive: true })
  await mkdir(join(root, 'storage'), { recursive: true })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(sandbox)}`,
    "- name: '@deepseek-ai/dsh-tool-fs'",
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    "- name: '@deepseek-ai/dsh-session-query-sqlite'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'query.sqlite'))}`,
    "- name: '@deepseek-ai/dsh-sci-memory'",
    '  config:',
    ...omitMemoryDir ? [] : [`    memoryDir: ${JSON.stringify(memoryDir)}`],
    ...configLines,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-query-sqlite', SessionQuerySqlite],
    ['@deepseek-ai/dsh-sci-memory', SciMemory],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, memoryDir }
}

/**
 * Write one file through the composed `write` tool as an agent.
 * @param ctx - the booted context.
 * @param path - absolute path to write.
 * @param content - full file content.
 * @returns the session the call ran in.
 */
async function writeAs(ctx: Context, path: string, content: string) {
  const session = ctx.sessions.create()
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text: 'Record how gh authenticates.' }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  session.append('turn/start', { turn: 1 })
  await ctx.tools.execute({
    callId: CallId('call-1'),
    name: 'write',
    arguments: { file_path: path, content },
    agent: { id: session.id, session } as Agent,
    signal: new AbortController().signal,
  })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

describe('sci-memory real Loader composition through cordis.yml', () => {
  it('repairs a memory node, records the write, and serves it back through recall', async () => {
    const { ctx, memoryDir } = await boot()
    const path = join(memoryDir, 'gh-auth-via-host-config.md')
    const session = await writeAs(ctx, path, NODE)

    await expect(readFile(path, 'utf8')).resolves.toContain(`  originSessionId: ${session.id}\n`)
    expect(session.events.filter(event => event.type === 'sci/memory-written').map(event => event.data)).toEqual([{
      slug: 'gh-auth-via-host-config',
      originSessionId: session.id,
      turnIndex: 1,
    }])
    expect(ctx.sciMemory.memoryIndex()).toEqual([expect.objectContaining({
      slug: 'gh-auth-via-host-config',
      type: 'reference',
      writtenAtTurn: 1,
    })])

    const index = await ctx.sciMemory.index()
    expect(index.sessions).toEqual([expect.objectContaining({
      sessionId: session.id,
      openingRequest: 'Record how gh authenticates.',
    })])
  }, 30_000)

  it('carries memoryDir through the config so a node outside it is not indexed', async () => {
    const { ctx, memoryDir } = await boot(['    openingRequestLimit: 8'])
    const session = await writeAs(ctx, join(memoryDir, '..', 'workspace', 'notes.md'), NODE)

    expect(session.events.some(event => event.type === 'sci/memory-written')).toBe(false)
    const index = await ctx.sciMemory.index()
    expect(index.sessions[0]?.openingRequest).toBe('Record …')
  }, 30_000)

  it('fails loading when the required memory directory is missing', async () => {
    await expect(boot([], true)).rejects.toThrow(/memoryDir/)
  }, 30_000)

  it('fails loading when a tool binding half-declares a sub-command', async () => {
    await expect(boot([
      '    memoryTools:',
      '      - name: write',
      '        pathArg: file_path',
      '        commandArg: command',
    ])).rejects.toThrow(/commandArg and writeCommands together/)
  }, 30_000)
})
