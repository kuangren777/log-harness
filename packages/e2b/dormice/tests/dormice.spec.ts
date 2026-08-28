import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileType } from '@deepseek-ai/dsh-e2b'
import type { Sandbox as SandboxType } from '@deepseek-ai/dsh-e2b'
import DormiceRuntime from '@deepseek-ai/dsh-dormice'
import * as DormiceInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** Restore-poll interval the disposal test drives the loop at. */
const POLL_INTERVAL_MS = 10

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
}))

// The provider reaches the E2B SDK through the seam Definition's re-export,
// so the Definition module is the seam this suite replaces.
vi.mock('@deepseek-ai/dsh-e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-e2b')>()
  // The mock replaces only the SDK's static factory surface and is never constructed.
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with a static factory.
  class FakeSandbox {
    static connect(...args: unknown[]): unknown {
      return sdk.connect(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

const TOKEN = 'a1b2c3d4'
const USER_KEY = 'sci:user-42'

type RunCommand = (
  command: string,
  options?: { envs?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

interface SandboxFixture {
  sandbox: SandboxType
  makeDir: ReturnType<typeof vi.fn>
  getInfo: ReturnType<typeof vi.fn>
  run: Mock<RunCommand>
  kill: ReturnType<typeof vi.fn>
}

function fakeSandbox(id: string): SandboxFixture {
  const makeDir = vi.fn().mockResolvedValue(true)
  const getInfo = vi.fn().mockResolvedValue({ type: FileType.DIR })
  const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  const kill = vi.fn().mockResolvedValue(undefined)
  const sandbox = {
    sandboxId: id,
    files: { makeDir, getInfo },
    commands: { run },
    kill,
  } as unknown as SandboxType
  return { sandbox, makeDir, getInfo, run, kill }
}

interface AcquireCall {
  authorization: string | undefined
  body: Record<string, unknown>
}

interface Reply {
  status: number
  body: string
  contentType: string
}

/** JSON reply in the daemon's dialect. */
const json = (status: number, body: unknown): Reply => ({
  status,
  body: JSON.stringify(body),
  contentType: 'application/json',
})

/** The daemon's idempotent acquire: one sandbox id per name, forever. */
function idempotentDaemon(): (call: AcquireCall) => Reply {
  const minted = new Map<string, string>()
  return ({ body }) => {
    const name = String(body.name)
    const created = !minted.has(name)
    if (created) minted.set(name, `sbx-${minted.size + 1}`)
    return json(200, {
      status: 'ready',
      created,
      sandbox: { id: minted.get(name), name },
    })
  }
}

class MockDaemon {
  readonly calls: AcquireCall[] = []
  respond: (call: AcquireCall) => Reply | Promise<Reply> = idempotentDaemon()
  endpoint = ''
  private server: Server | undefined

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const call: AcquireCall = {
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        }
        this.calls.push(call)
        void Promise.resolve(this.respond(call)).then((reply) => {
          response.writeHead(reply.status, { 'content-type': reply.contentType })
          response.end(reply.body)
        })
      })
    })
    await new Promise<void>((resolve) => { this.server?.listen(0, '127.0.0.1', resolve) })
    const address = this.server?.address() as AddressInfo
    this.endpoint = `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => { this.server?.close(() => { resolve() }) })
  }
}

let daemon: MockDaemon

beforeEach(async () => {
  sdk.connect.mockReset()
  vi.unstubAllEnvs()
  daemon = new MockDaemon()
  await daemon.start()
})

afterEach(async () => {
  await daemon.stop()
})

/** The config every test starts from; the mock daemon's port varies per test. */
const baseConfig = () => ({ endpoint: daemon.endpoint, token: TOKEN, userKey: USER_KEY })

describe('DormiceRuntime acquisition', () => {
  it('acquires once, reuses the handle, and prepares the shared directories', async () => {
    const fixture = fakeSandbox('sbx-1')
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, baseConfig())

    const first = await ctx.e2b.getSandbox()
    const second = await ctx.e2b.getSandbox()

    expect(second).toBe(first)
    expect(daemon.calls).toHaveLength(1)
    expect(sdk.connect).toHaveBeenCalledOnce()
    expect(ctx.e2b.cwd).toBe('/home/user/sci')
    expect(ctx.e2b.runtimeRoot).toBe('/home/user/sci/.dsh-e2b')
    expect(fixture.makeDir).toHaveBeenNthCalledWith(1, '/home/user/sci')
    expect(fixture.makeDir).toHaveBeenNthCalledWith(2, '/home/user/sci/.dsh-e2b')
    expect(fixture.getInfo).toHaveBeenCalledWith('/home/user/sci/.dsh-e2b')
    const runOptions = fixture.run.mock.calls[0]?.[1]
    expect(runOptions?.envs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(fixture.run).toHaveBeenCalledWith(
      "chmod 700 -- '/home/user/sci/.dsh-e2b'",
      { envs: { HOME: runOptions?.envs?.HOME } },
    )
  })

  it('is idempotent across services: the same userKey acquires the same sandbox id', async () => {
    sdk.connect.mockImplementation((id: string) => Promise.resolve(fakeSandbox(id).sandbox))
    const first = new Context()
    await first.plugin(DormiceRuntime, baseConfig())
    await first.e2b.getSandbox()

    const second = new Context()
    await second.plugin(DormiceRuntime, baseConfig())
    await second.e2b.getSandbox()

    expect(daemon.calls).toHaveLength(2)
    expect(daemon.calls.map(call => call.body.name)).toEqual([USER_KEY, USER_KEY])
    const ids = sdk.connect.mock.calls.map(call => call[0] as string)
    expect(ids).toEqual(['sbx-1', 'sbx-1'])
  })

  it('sends the bearer token, the whole policy, and the image, and keeps the token out of the sandbox', async () => {
    const fixture = fakeSandbox('sbx-1')
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, {
      ...baseConfig(),
      image: 'sci-base',
      cwd: '/home/user/research',
      policy: { freezeAfterSeconds: 300, stopAfterSeconds: 604_800, archiveAfterSeconds: 2_592_000 },
    })
    await ctx.e2b.getSandbox()

    expect(daemon.calls[0]?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(daemon.calls[0]?.body).toEqual({
      name: USER_KEY,
      policy: { freezeAfterSeconds: 300, stopAfterSeconds: 604_800, archiveAfterSeconds: 2_592_000 },
      template: 'sci-base',
    })
    expect(sdk.connect).toHaveBeenCalledWith('sbx-1', {
      apiKey: `e2b_${TOKEN}`,
      apiUrl: `${daemon.endpoint}/e2b/api`,
      sandboxUrl: `${daemon.endpoint}/e2b/envd`,
    })
    expect(ctx.e2b.cwd).toBe('/home/user/research')
    const forwarded = JSON.stringify([fixture.makeDir.mock.calls, fixture.run.mock.calls])
    expect(forwarded).not.toContain(TOKEN)
  })

  it('omits the policy and the template when neither is configured and drops a trailing endpoint slash', async () => {
    sdk.connect.mockResolvedValue(fakeSandbox('sbx-1').sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, { ...baseConfig(), endpoint: `${daemon.endpoint}/` })
    await ctx.e2b.getSandbox()

    // An absent policy leaves every lifecycle threshold to the daemon's own defaults.
    expect(daemon.calls[0]?.body).toEqual({ name: USER_KEY })
    expect(daemon.calls[0]?.body).not.toHaveProperty('policy')
    expect(sdk.connect).toHaveBeenCalledWith('sbx-1', expect.objectContaining({
      apiUrl: `${daemon.endpoint}/e2b/api`,
    }))
  })

  it.each([
    ['one threshold', { freezeAfterSeconds: 300 }, { freezeAfterSeconds: 300 }],
    ['an explicit never-stop', { stopAfterSeconds: null }, { stopAfterSeconds: null }],
    ['an empty override', {}, undefined],
  ] as const)('sends only the policy fields the operator set: %s', async (_label, policy, expected) => {
    sdk.connect.mockResolvedValue(fakeSandbox('sbx-1').sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, { ...baseConfig(), policy })
    await ctx.e2b.getSandbox()

    expect(daemon.calls[0]?.body).toEqual(
      expected === undefined ? { name: USER_KEY } : { name: USER_KEY, policy: expected },
    )
  })

  it('reads the token from the environment when the config omits it', async () => {
    vi.stubEnv('DORMICE_API_TOKEN', 'deadbeef')
    sdk.connect.mockResolvedValue(fakeSandbox('sbx-1').sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, { endpoint: daemon.endpoint, userKey: USER_KEY })
    await ctx.e2b.getSandbox()

    expect(daemon.calls[0]?.authorization).toBe('Bearer deadbeef')
    expect(sdk.connect).toHaveBeenCalledWith('sbx-1', expect.objectContaining({ apiKey: 'e2b_deadbeef' }))
  })

  it('polls a restoring sandbox until the daemon reports it ready', async () => {
    let answered = 0
    daemon.respond = ({ body }) => {
      answered += 1
      if (answered === 1) {
        return json(200, {
          status: 'restoring',
          created: false,
          sandbox: { id: 'sbx-archived', name: body.name },
          progress: { phase: 'downloading', percent: 10 },
        })
      }
      return json(200, { status: 'ready', created: false, sandbox: { id: 'sbx-archived', name: body.name } })
    }
    sdk.connect.mockResolvedValue(fakeSandbox('sbx-archived').sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, { ...baseConfig(), restorePollIntervalMs: 5 })

    await expect(ctx.e2b.getSandbox()).resolves.toBeDefined()
    expect(daemon.calls).toHaveLength(2)
    expect(sdk.connect).toHaveBeenCalledWith('sbx-archived', expect.anything())
  })

  it('fails loud when a restore outlives the acquisition deadline', async () => {
    daemon.respond = ({ body }) => json(200, {
      status: 'restoring',
      created: false,
      sandbox: { id: 'sbx-archived', name: body.name },
      progress: { phase: 'extracting', percent: 99 },
    })
    const ctx = new Context()
    // The remaining budget is under one poll interval as soon as the first
    // answer lands, so the loop reports the deadline instead of sleeping past it.
    await ctx.plugin(DormiceRuntime, {
      ...baseConfig(),
      acquireTimeoutMs: 400,
      restorePollIntervalMs: 1_000,
    })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow(/was still restoring after 400ms/)
    expect(daemon.calls).toHaveLength(1)
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it('reports the daemon message on a rejected acquire and retries on the next call', async () => {
    daemon.respond = () => json(403, { message: 'api key is disabled' })
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, baseConfig())

    await expect(ctx.e2b.getSandbox()).rejects.toThrow(
      `dsh-dormice: acquiring sandbox "${USER_KEY}" failed with 403: api key is disabled`,
    )

    daemon.respond = idempotentDaemon()
    sdk.connect.mockResolvedValue(fakeSandbox('sbx-1').sandbox)
    await expect(ctx.e2b.getSandbox()).resolves.toBeDefined()
    expect(daemon.calls).toHaveLength(2)
  })

  it.each([
    ['a JSON body without a message', json(500, { detail: 'nope' }), /failed with 500: Internal Server Error/],
    ['a non-JSON body', { status: 502, body: '<html>bad gateway</html>', contentType: 'text/html' }, /failed with 502: Bad Gateway/],
  ])('falls back to the status line for %s', async (_label, reply, message) => {
    daemon.respond = () => reply
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, baseConfig())

    await expect(ctx.e2b.getSandbox()).rejects.toThrow(message)
  })

  it.each([
    ['a null body', null],
    ['no sandbox record', { status: 'ready', created: true }],
    ['a sandbox without an id', { status: 'ready', created: true, sandbox: {} }],
    ['an empty sandbox id', { status: 'ready', created: true, sandbox: { id: '' } }],
    ['an unknown status', { status: 'pending', created: true, sandbox: { id: 'sbx-1' } }],
  ])('rejects an unusable acquire record: %s', async (_label, body) => {
    daemon.respond = () => json(200, body)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, baseConfig())

    await expect(ctx.e2b.getSandbox()).rejects.toThrow(
      `dsh-dormice: acquiring sandbox "${USER_KEY}" returned an unusable record`,
    )
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it.each([
    ['symbolic link', { type: FileType.DIR, symlinkTarget: '/tmp/redirected' }],
    ['regular file', { type: FileType.FILE }],
  ])('rejects a reserved runtime root that is a %s without destroying the sandbox', async (_label, info) => {
    const fixture = fakeSandbox('sbx-1')
    fixture.getInfo.mockResolvedValueOnce(info)
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    await ctx.plugin(DormiceRuntime, baseConfig())

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('runtime root must be a real directory')
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.kill).not.toHaveBeenCalled()
  })
})

describe('DormiceRuntime disposal', () => {
  it('leaves the sandbox alive and refuses new acquisition', async () => {
    const fixture = fakeSandbox('sbx-1')
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(DormiceRuntime, baseConfig())
    const service = ctx.e2b
    await service.getSandbox()

    await fiber.dispose()

    expect(fixture.kill).not.toHaveBeenCalled()
    await expect(service.getSandbox()).rejects.toThrow(/disposing/)
  })

  it('stops polling a restoring sandbox the moment the fiber disposes', async () => {
    daemon.respond = ({ body }) => json(200, {
      status: 'restoring',
      created: false,
      sandbox: { id: 'sbx-archived', name: body.name },
      progress: { phase: 'downloading', percent: 5 },
    })
    const ctx = new Context()
    const fiber = await ctx.plugin(DormiceRuntime, { ...baseConfig(), restorePollIntervalMs: POLL_INTERVAL_MS })

    const acquisition = ctx.e2b.getSandbox()
    await vi.waitUntil(() => daemon.calls.length > 0)
    await fiber.dispose()

    await expect(acquisition).rejects.toThrow(/disposing/)
    // A poll already in flight when the disposer ran still reaches the daemon;
    // what must not happen is a NEW one. Snapshot once that request has landed,
    // so the assertion measures the loop rather than the in-flight response.
    await sleep(2 * POLL_INTERVAL_MS)
    const answered = daemon.calls.length
    // Ten poll intervals of the loop the disposer was supposed to end.
    await sleep(10 * POLL_INTERVAL_MS)
    expect(daemon.calls).toHaveLength(answered)
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it('rejects a handle whose acquisition finishes after disposal starts', async () => {
    const fixture = fakeSandbox('sbx-1')
    const preparing = Promise.withResolvers<Awaited<ReturnType<RunCommand>>>()
    fixture.run.mockReturnValue(preparing.promise)
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(DormiceRuntime, baseConfig())

    // Disposal lands inside the last preparation step, so the acquisition
    // itself still succeeds and only the awaiting caller observes disposal.
    const acquisition = ctx.e2b.getSandbox()
    await vi.waitUntil(() => fixture.run.mock.calls.length > 0)
    const disposing = fiber.dispose()
    preparing.resolve({ exitCode: 0, stdout: '', stderr: '' })

    await expect(acquisition).rejects.toThrow(/disposing/)
    await expect(disposing).resolves.toBeUndefined()
    expect(fixture.kill).not.toHaveBeenCalled()
  })
})

describe('DormiceRuntime configuration', () => {
  it.each([
    ['userKey', { token: TOKEN, userKey: '' }, /userKey must be a non-empty sandbox address/],
    ['endpoint', { token: TOKEN, userKey: USER_KEY, endpoint: 'not-a-url' }, /endpoint must be an absolute URL/],
    ['cwd', { token: TOKEN, userKey: USER_KEY, cwd: 'relative' }, /absolute Linux path/],
    ['acquireTimeoutMs', { token: TOKEN, userKey: USER_KEY, acquireTimeoutMs: 0 }, /acquireTimeoutMs must be a positive finite number/],
    ['restorePollIntervalMs', { token: TOKEN, userKey: USER_KEY, restorePollIntervalMs: 0 }, /restorePollIntervalMs must be a positive finite number/],
    ['policy', { token: TOKEN, userKey: USER_KEY, policy: { stopAfterSeconds: null, archiveAfterSeconds: 60 } }, /archiveAfterSeconds requires a policy.stopAfterSeconds/],
  ] as const)('fails loud at load on a bad %s', async (_field, config, message) => {
    const ctx = new Context()
    await expect(ctx.plugin(DormiceRuntime, config)).rejects.toThrow(message)
    expect(daemon.calls).toHaveLength(0)
  })

  it('requires a token when both the config and the environment omit it', async () => {
    const original = process.env.DORMICE_API_TOKEN
    delete process.env.DORMICE_API_TOKEN
    try {
      const ctx = new Context()
      await expect(ctx.plugin(DormiceRuntime, { userKey: USER_KEY })).rejects.toThrow(
        /configure token or set DORMICE_API_TOKEN/,
      )
    } finally {
      if (original === undefined) delete process.env.DORMICE_API_TOKEN
      else process.env.DORMICE_API_TOKEN = original
    }
  })
})

describe('Dormice invariant companion', () => {
  it('registers the package-owned empty invariant installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(DormiceInvariant).await()
    await fiber.dispose()
  })
})
