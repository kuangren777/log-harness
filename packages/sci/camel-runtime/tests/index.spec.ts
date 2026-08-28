// The plugin is Loader-composable configuration, not a hand-wired object: a
// cordis.yml naming the tool registry, a `ctx.e2b` provider, and camel-runtime
// mounts `fork_workspace` with the deployment's text, and a misconfiguration
// fails at load. The engine end of the composition is proven by driving one
// call whose AgentENV is a local HTTP server and whose sandboxes are fakes.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { E2BRuntime } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import * as CamelRuntime from '@deepseek-ai/dsh-camel-runtime'
import { Config, FORK_TOOL, describeForkTool, validateConfig } from '@deepseek-ai/dsh-camel-runtime'

const sdk = vi.hoisted(() => ({ connect: vi.fn() }))

vi.mock('@deepseek-ai/dsh-e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-e2b')>()
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with a static factory.
  class FakeSandbox {
    static connect(...args: unknown[]): unknown {
      return sdk.connect(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

const ARCHIVE = Buffer.from('ws').toString('base64')

/** A sandbox whose tar export answers with a fixed archive and whose other commands echo themselves. */
function fakeSandbox(tag: string): { sandbox: Sandbox; run: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockImplementation((command: string) => Promise.resolve(
    command.startsWith('tar -czf')
      ? { exitCode: 0, stdout: ARCHIVE, stderr: '' }
      : { exitCode: 0, stdout: `${tag}: ${command}`, stderr: '' },
  ))
  const write = vi.fn().mockResolvedValue(undefined)
  return { sandbox: { commands: { run }, files: { write } } as unknown as Sandbox, run, write }
}

const workspace = fakeSandbox('workspace')

/** A `ctx.e2b` provider standing in for Dormice: one fixed workspace sandbox. */
class FakeWorkspaceRuntime extends E2BRuntime {
  static Config = z.object({})
  constructor(ctx: Context) {
    super(ctx, '/home/user/sci')
  }

  getSandbox(): Promise<Sandbox> {
    return Promise.resolve(workspace.sandbox)
  }
}

/** A local AgentENV: numbered sandboxes, one snapshot, deletions recorded. */
class MockAgentEnv {
  readonly calls: string[] = []
  endpoint = ''
  private created = 0
  private server: Server | undefined

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      request.on('data', () => {})
      request.on('end', () => {
        const line = `${request.method} ${request.url}`
        this.calls.push(line)
        if (request.headers['x-api-key'] !== 'key-from-env') {
          response.writeHead(401).end('{"message":"unauthorized"}')
          return
        }
        if (line === 'POST /sandboxes') {
          this.created++
          response.writeHead(201, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ sandboxID: `sb-${this.created}`, templateID: 't', clientID: '', envdVersion: '0' }))
        } else if (line.endsWith('/snapshots')) {
          response.writeHead(201, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ snapshotID: 'snap-1', names: [] }))
        } else {
          response.writeHead(204).end()
        }
      })
    })
    await new Promise<void>((resolve) => { this.server?.listen(0, '127.0.0.1', resolve) })
    this.endpoint = `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => { this.server?.close(() => { resolve() }) })
  }
}

let root: string | undefined
let context: Context | undefined
let agentenv: MockAgentEnv

beforeEach(async () => {
  sdk.connect.mockReset()
  sdk.connect.mockImplementation((id: string) => Promise.resolve(fakeSandbox(id).sandbox))
  workspace.run.mockClear()
  workspace.write.mockClear()
  vi.unstubAllEnvs()
  agentenv = new MockAgentEnv()
  await agentenv.start()
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await agentenv.stop()
})

/** Boot a cordis.yml carrying the given camel-runtime config lines, and register one agent. */
async function boot(configLines: readonly string[]): Promise<{ ctx: Context; agent: Agent }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-camel-runtime-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'test:fake-e2b'",
    "- name: '@deepseek-ai/dsh-camel-runtime'",
    '  config:',
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
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['test:fake-e2b', FakeWorkspaceRuntime],
    ['@deepseek-ai/dsh-camel-runtime', CamelRuntime],
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

  const session = ctx.sessions.create()
  const scope = ctx.plugin(() => {})
  const agent: Agent = {
    id: session.header.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, agent }
}

/** The innermost error of a Loader failure chain. */
function rootCause(error: unknown): Error {
  let current = error
  while (current instanceof Error && current.cause !== undefined) current = current.cause
  return current instanceof Error ? current : new Error(String(current))
}

describe('camel-runtime through the Loader', () => {
  it('mounts fork_workspace with the deployment text and runs one fork end to end (T7)', async () => {
    vi.stubEnv('AENV_API_KEY', 'key-from-env')
    const { ctx, agent } = await boot([`    endpoint: ${JSON.stringify(agentenv.endpoint)}`, '    template: sci', '    concurrency: 1'])
    expect(ctx.tools.get(FORK_TOOL)?.description).toBe(describeForkTool('.sci/forks', 8))

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('fork'),
      name: FORK_TOOL,
      arguments: { variants: [{ name: 'a', command: 'echo a' }, { name: 'b', command: 'echo b' }], timeoutSeconds: 5 },
      agent,
    })

    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const forkId = /^fork (\S+):/.exec(text)?.[1]
    expect(forkId).toMatch(/^\d{14}-[0-9a-f]{8}$/)
    expect(text.split('\n')).toEqual([
      `fork ${forkId}: 2 variants`,
      `- a: exit 0, results in /home/user/sci/.sci/forks/${forkId}/a`,
      '    sb-2: echo a',
      `- b: exit 0, results in /home/user/sci/.sci/forks/${forkId}/b`,
      '    sb-3: echo b',
    ])
    expect(agentenv.calls).toEqual([
      'POST /sandboxes',
      'POST /sandboxes/sb-1/snapshots',
      'POST /sandboxes',
      'POST /sandboxes',
      'DELETE /sandboxes/sb-1',
      'DELETE /sandboxes/sb-2',
      'DELETE /sandboxes/sb-3',
      'DELETE /templates/snap-1',
    ])
    expect(workspace.write.mock.calls.map(([entries]) => (entries as { path: string }[]).map(entry => entry.path))).toEqual([
      expect.arrayContaining([expect.stringMatching(/\/a\/stdout\.txt$/)]),
      expect.arrayContaining([expect.stringMatching(/\/b\/stdout\.txt$/)]),
    ])
    expect(agent.session.events.filter(event => event.type === 'sci/fork-completed')).toHaveLength(1)
  })

  it('takes an explicit apiKey over the environment and never forwards it into a sandbox', async () => {
    vi.stubEnv('AENV_API_KEY', 'wrong-key')
    const { ctx, agent } = await boot([
      `    endpoint: ${JSON.stringify(agentenv.endpoint)}`,
      '    apiKey: key-from-env',
      '    template: sci',
    ])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('fork'),
      name: FORK_TOOL,
      arguments: { variants: [{ name: 'a', command: 'env' }] },
      agent,
    })
    expect(result.isError).toBe(false)
    for (const [, options] of workspace.run.mock.calls as [string, { envs: Record<string, string> }][]) {
      expect(Object.values(options.envs)).not.toContain('key-from-env')
    }
  })

  it('fails at load when no API key is configured', async () => {
    await expect(boot(['    template: sci']).catch((error: unknown) => Promise.reject(rootCause(error))))
      .rejects.toThrow('camel-runtime: configure apiKey or set AENV_API_KEY')
  })
})

describe('validateConfig', () => {
  const base = Config({ template: 'sci' }) as Parameters<typeof validateConfig>[0]

  it('accepts the defaults', () => {
    expect(() => { validateConfig(base, 'k') }).not.toThrow()
    expect(base).toMatchObject({ endpoint: 'http://127.0.0.1:8000', forksDir: '.sci/forks', maxVariants: 8, concurrency: 4 })
  })

  it.each([
    { label: 'a blank template', patch: { template: ' ' }, failure: 'camel-runtime: template must name an AgentENV template' },
    { label: 'a schemeless endpoint', patch: { endpoint: '127.0.0.1:8000' }, failure: 'camel-runtime: endpoint must be an absolute URL: 127.0.0.1:8000' },
    { label: 'a zero concurrency', patch: { concurrency: 0 }, failure: 'camel-runtime: concurrency must be a positive integer' },
    { label: 'a fractional variant cap', patch: { maxVariants: 2.5 }, failure: 'camel-runtime: maxVariants must be a positive integer' },
    { label: 'a default budget over the cap', patch: { commandTimeoutSeconds: 10, maxCommandTimeoutSeconds: 5 }, failure: 'camel-runtime: commandTimeoutSeconds must not exceed maxCommandTimeoutSeconds' },
    { label: 'an absolute forksDir', patch: { forksDir: '/tmp/forks' }, failure: 'camel-runtime: forksDir must be a relative path inside the workspace: /tmp/forks' },
    { label: 'a climbing forksDir', patch: { forksDir: 'a/../../b' }, failure: 'camel-runtime: forksDir must be a relative path inside the workspace: a/../../b' },
  ])('refuses $label', ({ patch, failure }) => {
    expect(() => { validateConfig({ ...base, ...patch }, 'k') }).toThrow(failure)
  })

  it('refuses an empty key', () => {
    expect(() => { validateConfig(base, '') }).toThrow('camel-runtime: configure apiKey or set AENV_API_KEY')
  })

  it('requires a template at the schema', () => {
    expect(() => Config({} as { template: string })).toThrow()
  })
})
