// Proves the workspace gate is real, Loader-composed configurability and not a
// hand-built ctx.plugin() unit: a cordis.yml booted through the real Loader
// mounts the tool registry, a real filesystem, the session store, and
// dsh-sci-workspace, and the model-visible output it owns — the denial the tool
// result carries — appears from that composition alone. The tool names it gates
// and the recursive-delete switch follow the config through the Loader.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as SciWorkspace from '@deepseek-ai/dsh-sci-workspace'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the given sci-workspace config block over a real
 * sandbox tree.
 * @param configLines - extra YAML lines nested under the plugin's `config:` key.
 * @returns the booted context and the sandbox root the composition uses.
 */
async function boot(configLines: readonly string[] = [], omitProjectRoot = false): Promise<{ ctx: Context; sandbox: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-workspace-loader-'))
  const sandbox = join(root, 'sci')
  await mkdir(join(sandbox, 'projects/p1/sciplots/fig/versions/v1'), { recursive: true })
  await mkdir(join(sandbox, 'projects/p1/tmp'), { recursive: true })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    '  config:',
    `    cwd: ${JSON.stringify(sandbox)}`,
    "- name: '@deepseek-ai/dsh-sci-workspace'",
    '  config:',
    ...omitProjectRoot ? [] : [`    projectRoot: ${JSON.stringify(join(sandbox, 'projects'))}`],
    ...configLines,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-sci-workspace', SciWorkspace],
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
  return { ctx, sandbox }
}

/** Register a stand-in tool under the given name and dispatch one call to it. */
async function callThrough(ctx: Context, sandbox: string, name: string, args: unknown): Promise<{
  result: ToolExecutionResult
  ran: string[]
}> {
  const ran: string[] = []
  ctx.tools.register({
    name,
    description: `stand-in for the real ${name} tool`,
    parameters: {
      file_path: { type: 'string' },
      content: { type: 'string' },
      command: { type: 'string' },
      cmd: { type: 'string' },
    },
    output: { schema: { type: 'null' }, render: () => [] },
    execute: () => {
      ran.push(name)
      return Promise.resolve(null)
    },
  })
  const session = ctx.sessions.create(SessionId(`loader-${name}`), { meta: { cwd: join(sandbox, 'projects/p1') } })
  const result = await ctx.tools.execute({
    callId: CallId(`loader-${name}`),
    name,
    arguments: args,
    agent: { session } as never,
    signal: new AbortController().signal,
  })
  return { result, ran }
}

describe('sci-workspace real Loader composition through cordis.yml', () => {
  it('gates the shipped tool names by default, refusing a write into a render-owned version store', async () => {
    const { ctx, sandbox } = await boot()
    const { result, ran } = await callThrough(ctx, sandbox, 'write', {
      file_path: 'sciplots/fig/versions/v1/out.png',
      content: 'x',
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(block => block.type === 'text' ? block.text : '').join(''))
      .toContain('render wrapper')
    expect(ran).toEqual([])
  }, 30_000)

  it('screens a shell command through the configured shell tool name', async () => {
    const { ctx, sandbox } = await boot()
    const { result, ran } = await callThrough(ctx, sandbox, 'bash', { command: 'rm -rf sciplots/fig' })
    expect(result.isError).toBe(true)
    expect(ran).toEqual([])
  }, 30_000)

  it('follows denyRecursiveDeleteInBundles: false through the Loader', async () => {
    const { ctx, sandbox } = await boot(['    denyRecursiveDeleteInBundles: false'])
    const { result, ran } = await callThrough(ctx, sandbox, 'bash', { command: 'rm -rf sciplots/fig' })
    expect(result.isError).toBe(false)
    expect(ran).toEqual(['bash'])
  }, 30_000)

  it('follows a renamed shell tool through the Loader, leaving the default name ungated', async () => {
    const { ctx, sandbox } = await boot([
      '    fsTools:',
      '      read: []',
      '      write: []',
      '      edit: []',
      '      shell:',
      '        - name: run_command',
      '          command: cmd',
    ])
    const renamed = await callThrough(ctx, sandbox, 'run_command', { cmd: 'rm -rf sciplots/fig' })
    expect(renamed.result.isError).toBe(true)
    const shipped = await callThrough(ctx, sandbox, 'bash', { command: 'rm -rf sciplots/fig' })
    expect(shipped.result.isError).toBe(false)
  }, 30_000)

  it('fails loading without projectRoot rather than gating nothing', async () => {
    await expect(boot([], true)).rejects.toThrow(/projectRoot/)
  }, 30_000)
})
