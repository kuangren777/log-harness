// The plugin is Loader-composable configuration, not a hand-wired object: a
// cordis.yml naming the tool registry, a `ctx.e2b` provider, and camel-runtime
// mounts the five variant tools with the deployment's cap, and a
// misconfiguration fails at load. The engine end of the composition is proven
// by driving a full slot lifecycle — create up to the cap, refuse, delete,
// create again, run, collect — against a local AgentENV with fake sandboxes.
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
import { E2BRuntime, FileNotFoundError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import * as CamelRuntime from '@deepseek-ai/dsh-camel-runtime'
import { COLLECT_TOOL, CREATE_TOOL, Config, DELETE_TOOL, LIST_TOOL, RUN_TOOL, validateConfig } from '@deepseek-ai/dsh-camel-runtime'

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

const ARCHIVE = Buffer.from('proj').toString('base64')

interface Fake { sandbox: Sandbox; run: ReturnType<typeof vi.fn>; files: Map<string, string> }

/** A sandbox with an in-memory file store; tar exports answer with a fixed archive, other commands echo. */
function fakeSandbox(tag: string): Fake {
  const files = new Map<string, string>()
  const run = vi.fn().mockImplementation((command: string) => Promise.resolve(
    command.startsWith('tar -czf')
      ? { exitCode: 0, stdout: ARCHIVE, stderr: '' }
      : command.startsWith('find ')
        ? { exitCode: 0, stdout: '1\n', stderr: '' }
        : { exitCode: 0, stdout: `${tag}: ${command}`, stderr: '' },
  ))
  const sandbox = {
    commands: { run },
    files: {
      read: (path: string) => {
        const text = files.get(path)
        return text === undefined ? Promise.reject(new FileNotFoundError(path)) : Promise.resolve(text)
      },
      write: (path: string, data: string | ArrayBuffer) => {
        files.set(path, typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
        return Promise.resolve(undefined)
      },
    },
  } as unknown as Sandbox
  return { sandbox, run, files }
}

let workspace = fakeSandbox('workspace')

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

/** A local AgentENV: numbered sandboxes with running/paused state, deletions recorded. */
class MockAgentEnv {
  readonly calls: string[] = []
  readonly alive = new Map<string, 'running' | 'paused'>()
  endpoint = ''
  private created = 0
  private server: Server | undefined

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      request.on('data', () => {})
      request.on('end', () => {
        const line = `${request.method} ${request.url}`
        this.calls.push(line)
        const json = (status: number, body: unknown): void => {
          response.writeHead(status, { 'content-type': 'application/json' })
          response.end(JSON.stringify(body))
        }
        if (request.headers['x-api-key'] !== 'key-from-env') { json(401, { message: 'unauthorized' }); return }
        const match = /^(GET|POST|DELETE) \/sandboxes(?:\/([^/]+))?(?:\/(connect|snapshots))?$/.exec(line)
        if (line === 'POST /sandboxes') {
          this.created++
          const id = `sb-${this.created}`
          this.alive.set(id, 'running')
          json(201, { sandboxID: id, templateID: 't' })
        } else if (match?.[1] === 'POST' && match[3] === 'connect') {
          if (!this.alive.has(match[2]!)) { json(404, { message: 'gone' }); return }
          this.alive.set(match[2]!, 'running')
          json(200, { sandboxID: match[2], templateID: 't' })
        } else if (match?.[1] === 'POST' && match[3] === 'snapshots') {
          json(201, { snapshotID: `snap-${match[2]}`, names: [] })
        } else if (match?.[1] === 'GET' && match[2] !== undefined) {
          const state = this.alive.get(match[2])
          if (state === undefined) { json(404, { message: 'gone' }); return }
          json(200, { sandboxID: match[2], templateID: 't', state, endAt: 'later' })
        } else if (match?.[1] === 'DELETE' && match[2] !== undefined) {
          this.alive.delete(match[2])
          response.writeHead(204).end()
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
  workspace = fakeSandbox('workspace')
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

async function call(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId(name), name, arguments: args, agent })
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('camel-runtime through the Loader', () => {
  it('mounts the five tools with the deployment cap and drives a whole slot lifecycle (T7)', async () => {
    vi.stubEnv('AENV_API_KEY', 'key-from-env')
    const { ctx, agent } = await boot([`    endpoint: ${JSON.stringify(agentenv.endpoint)}`, '    template: sci', '    maxVariants: 2'])
    for (const name of [CREATE_TOOL, RUN_TOOL, COLLECT_TOOL, DELETE_TOOL, LIST_TOOL]) expect(ctx.tools.get(name)).toBeDefined()
    expect(ctx.tools.get(CREATE_TOOL)?.description).toContain('Up to 2 variants per workspace')

    expect(await call(ctx, agent, LIST_TOOL, {})).toBe('no variants; 0/2 slots used')
    expect(await call(ctx, agent, CREATE_TOOL, { name: 'a', project: 'projects/p1' })).toBe('variant a created, copied from projects/p1; 1/2 slots used')
    expect(await call(ctx, agent, CREATE_TOOL, { name: 'b', project: 'projects/p1', from: 'a' })).toBe('variant b created, forked from variant a (projects/p1); 2/2 slots used')
    expect(await call(ctx, agent, CREATE_TOOL, { name: 'c', project: 'projects/p1' }))
      .toContain('variant limit reached: 2/2 slots are in use (a, b); delete one with delete_variant before creating another')
    expect(await call(ctx, agent, DELETE_TOOL, { name: 'b' })).toBe('variant b deleted; 1/2 slots used')
    expect(await call(ctx, agent, CREATE_TOOL, { name: 'c', project: 'projects/p1' })).toBe('variant c created, copied from projects/p1; 2/2 slots used')
    expect(await call(ctx, agent, RUN_TOOL, { name: 'c', command: 'echo hi', timeoutSeconds: 5 })).toMatch(/^variant c: exit 0 \(\d+ ms\)\nsb-3: echo hi$/)
    expect(await call(ctx, agent, COLLECT_TOOL, { name: 'c', path: 'out' })).toBe('collected 1 file from variant c:out into /home/user/sci/.sci/variants/c/collect/out')
    expect((await call(ctx, agent, LIST_TOOL, {})).split('\n').slice(0, 2)).toEqual(['2/2 slots used', expect.stringMatching(/^- a: projects\/p1, running, last used /)])

    expect(agentenv.calls).toEqual([
      'POST /sandboxes',
      'POST /sandboxes/sb-1/connect',
      'POST /sandboxes/sb-1/snapshots',
      'POST /sandboxes',
      'DELETE /sandboxes/sb-2',
      'DELETE /templates/snap-sb-1',
      'POST /sandboxes',
      'POST /sandboxes/sb-3/connect',
      'POST /sandboxes/sb-3/connect',
      'GET /sandboxes/sb-1',
      'GET /sandboxes/sb-3',
    ])
    expect(agent.session.events.filter(event => event.type.startsWith('sci/variant-')).map(event => event.type))
      .toEqual(['sci/variant-created', 'sci/variant-created', 'sci/variant-deleted', 'sci/variant-created', 'sci/variant-run'])
    expect(workspace.files.get('/home/user/sci/.sci/variants/registry.json')).toContain('"name": "c"')
  })

  it('takes an explicit apiKey over the environment and never forwards it into a sandbox', async () => {
    vi.stubEnv('AENV_API_KEY', 'wrong-key')
    const { ctx, agent } = await boot([`    endpoint: ${JSON.stringify(agentenv.endpoint)}`, '    apiKey: key-from-env', '    template: sci'])
    expect(await call(ctx, agent, CREATE_TOOL, { name: 'a', project: 'projects/p1' })).toContain('variant a created')
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
    expect(base).toMatchObject({ endpoint: 'http://127.0.0.1:8000', variantsDir: '.sci/variants', maxVariants: 8, sandboxTimeoutSeconds: 1800 })
  })

  it.each([
    { label: 'a blank template', patch: { template: ' ' }, failure: 'camel-runtime: template must name an AgentENV template' },
    { label: 'a schemeless endpoint', patch: { endpoint: '127.0.0.1:8000' }, failure: 'camel-runtime: endpoint must be an absolute URL: 127.0.0.1:8000' },
    { label: 'a zero cap', patch: { maxVariants: 0 }, failure: 'camel-runtime: maxVariants must be a positive integer' },
    { label: 'a fractional TTL', patch: { sandboxTimeoutSeconds: 2.5 }, failure: 'camel-runtime: sandboxTimeoutSeconds must be a positive integer' },
    { label: 'a default budget over the cap', patch: { commandTimeoutSeconds: 10, maxCommandTimeoutSeconds: 5 }, failure: 'camel-runtime: commandTimeoutSeconds must not exceed maxCommandTimeoutSeconds' },
    { label: 'an absolute variantsDir', patch: { variantsDir: '/tmp/v' }, failure: 'camel-runtime: variantsDir must be a relative path inside the workspace: /tmp/v' },
    { label: 'a climbing variantsDir', patch: { variantsDir: 'a/../../b' }, failure: 'camel-runtime: variantsDir must be a relative path inside the workspace: a/../../b' },
  ])('refuses $label', ({ patch, failure }) => {
    expect(() => { validateConfig({ ...base, ...patch }, 'k') }).toThrow(failure)
  })

  it('refuses an empty key and requires a template at the schema', () => {
    expect(() => { validateConfig(base, '') }).toThrow('camel-runtime: configure apiKey or set AENV_API_KEY')
    expect(() => Config({} as { template: string })).toThrow()
  })
})
