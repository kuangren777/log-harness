// The engine's lifecycle is the contract: one export, one seed, one snapshot,
// one microVM per variant resumed from that snapshot, results written into the
// workspace, and — on any path, success or failure — every microVM and the
// snapshot deleted. Non-zero exits are results; transport failures are not.
import { describe, expect, it, vi } from 'vitest'
import { CommandExitError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import {
  COLLECT_DIR,
  ForkEngine,
  TIMEOUT_EXIT_CODE,
  mapWithConcurrency,
  runShell,
  tarExportCommand,
} from '@deepseek-ai/dsh-camel-runtime'
import type { AgentEnvApi, AgentEnvSandbox, ForkEngineDeps, ForkRequest } from '@deepseek-ai/dsh-camel-runtime'

const ARCHIVE = Buffer.from('workspace-tar').toString('base64')

type RunOptions = { cwd?: string; timeoutMs?: number }
type Run = (command: string, options?: RunOptions) => Promise<{ exitCode: number; stdout: string; stderr: string }>

interface FakeSandbox {
  sandbox: Sandbox
  run: ReturnType<typeof vi.fn<Run>>
  write: ReturnType<typeof vi.fn>
}

/** A sandbox whose tar export answers with a fixed archive and whose other commands succeed. */
function fakeSandbox(): FakeSandbox {
  const run = vi.fn<Run>().mockImplementation(command => Promise.resolve(
    command.startsWith('tar -czf') ? { exitCode: 0, stdout: ARCHIVE, stderr: '' } : { exitCode: 0, stdout: '', stderr: '' },
  ))
  const write = vi.fn().mockResolvedValue(undefined)
  return { sandbox: { commands: { run }, files: { write } } as unknown as Sandbox, run, write }
}

interface FakeApi extends AgentEnvApi {
  readonly created: { templateID: string; timeoutSeconds: number }[]
  readonly killed: string[]
  readonly deletedTemplates: string[]
  readonly handles: Map<string, FakeSandbox>
  inFlight: number
  peakInFlight: number
}

/** An AgentENV whose sandboxes are numbered in creation order and whose exec runs are recorded per sandbox. */
function fakeApi(overrides: Partial<AgentEnvApi> = {}): FakeApi {
  const api: FakeApi = {
    created: [],
    killed: [],
    deletedTemplates: [],
    handles: new Map(),
    inFlight: 0,
    peakInFlight: 0,
    createSandbox(templateID, timeoutSeconds) {
      api.created.push({ templateID, timeoutSeconds })
      const sandboxID = `sb-${api.created.length}`
      return Promise.resolve<AgentEnvSandbox>({ sandboxID, templateID })
    },
    snapshot(sandboxID) {
      return Promise.resolve({ snapshotID: `snap-of-${sandboxID}`, names: [] })
    },
    kill(sandboxID) {
      api.killed.push(sandboxID)
      return Promise.resolve()
    },
    deleteTemplate(templateID) {
      api.deletedTemplates.push(templateID)
      return Promise.resolve()
    },
    connect(sandbox) {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      // Every command on a variant sandbox counts as in flight for the concurrency assertion.
      handle.run.mockImplementation(async (command) => {
        api.inFlight++
        api.peakInFlight = Math.max(api.peakInFlight, api.inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        api.inFlight--
        if (command.startsWith('tar -czf')) return { exitCode: 0, stdout: ARCHIVE, stderr: '' }
        return { exitCode: 0, stdout: `ran ${command} in ${sandbox.sandboxID}`, stderr: '' }
      })
      return Promise.resolve(handle.sandbox)
    },
    ...overrides,
  }
  return api
}

function deps(api: AgentEnvApi, workspace: FakeSandbox, extra: Partial<ForkEngineDeps> = {}): ForkEngineDeps {
  return {
    api,
    workspace: () => Promise.resolve(workspace.sandbox),
    cwd: '/home/user/sci',
    forksDir: '.sci/forks',
    template: 'sci',
    excludes: ['./.sci'],
    maxWorkspaceBytes: 1024,
    sandboxTimeoutSeconds: 600,
    concurrency: 2,
    forkId: () => 'f1',
    now: (() => { let t = 1000; return () => { t += 250; return t } })(),
    ...extra,
  }
}

const REQUEST: ForkRequest = {
  variants: [{ name: 'a', command: 'make a' }, { name: 'b', command: 'make b' }, { name: 'c', command: 'make c' }],
  timeoutSeconds: 30,
}

describe('ForkEngine.run', () => {
  it('seeds one microVM from the template, snapshots it, and resumes every variant from that snapshot (T3)', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const outcome = await new ForkEngine(deps(api, workspace)).run(REQUEST)

    expect(api.created).toEqual([
      { templateID: 'sci', timeoutSeconds: 600 },
      { templateID: 'snap-of-sb-1', timeoutSeconds: 600 },
      { templateID: 'snap-of-sb-1', timeoutSeconds: 600 },
      { templateID: 'snap-of-sb-1', timeoutSeconds: 600 },
    ])
    expect(outcome).toEqual({
      forkId: 'f1',
      snapshotID: 'snap-of-sb-1',
      durationMs: 250,
      variants: [
        { name: 'a', exitCode: 0, stdoutTail: 'ran make a in sb-2', stderrTail: '', resultDir: '/home/user/sci/.sci/forks/f1/a' },
        { name: 'b', exitCode: 0, stdoutTail: 'ran make b in sb-3', stderrTail: '', resultDir: '/home/user/sci/.sci/forks/f1/b' },
        { name: 'c', exitCode: 0, stdoutTail: 'ran make c in sb-4', stderrTail: '', resultDir: '/home/user/sci/.sci/forks/f1/c' },
      ],
    })
  })

  it('exports the workspace once with the configured excludes and imports it into the seed at the same path', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    await new ForkEngine(deps(api, workspace)).run(REQUEST)

    expect(workspace.run.mock.calls.filter(([command]) => command.startsWith('tar -czf'))).toHaveLength(1)
    expect(workspace.run).toHaveBeenCalledWith(tarExportCommand('/home/user/sci', ['./.sci']), expect.anything())
    const seed = api.handles.get('sb-1')!
    expect(seed.write).toHaveBeenCalledTimes(1)
    expect(seed.run.mock.calls[0]?.[0]).toContain('-C \'/home/user/sci\'')
  })

  it('runs each command in the workspace directory under the per-call budget', async () => {
    const api = fakeApi()
    await new ForkEngine(deps(api, fakeSandbox())).run(REQUEST)
    expect(api.handles.get('sb-2')!.run).toHaveBeenCalledWith('make a', expect.objectContaining({ cwd: '/home/user/sci', timeoutMs: 30_000 }))
  })

  it('writes stdout, stderr, and the exit code of every variant into the workspace', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    await new ForkEngine(deps(api, workspace)).run({ variants: [REQUEST.variants[0]!], timeoutSeconds: 30 })
    expect(workspace.write).toHaveBeenCalledWith([
      { path: '/home/user/sci/.sci/forks/f1/a/stdout.txt', data: 'ran make a in sb-2' },
      { path: '/home/user/sci/.sci/forks/f1/a/stderr.txt', data: '' },
      { path: '/home/user/sci/.sci/forks/f1/a/exit-code', data: '0\n' },
    ])
  })

  it('treats a non-zero exit as a result, not a failure, and still cleans up (T3)', async () => {
    const api = fakeApi()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      if (sandbox.sandboxID !== 'sb-1') {
        handle.run.mockRejectedValue(new CommandExitError({ exitCode: 3, stdout: 'partial', stderr: 'no such target' }))
      }
      return Promise.resolve(handle.sandbox)
    }
    const outcome = await new ForkEngine(deps(api, fakeSandbox())).run({ variants: [REQUEST.variants[0]!], timeoutSeconds: 30 })
    expect(outcome.variants[0]).toMatchObject({ exitCode: 3, stdoutTail: 'partial', stderrTail: 'no such target' })
    expect(api.killed.sort()).toEqual(['sb-1', 'sb-2'])
    expect(api.deletedTemplates).toEqual(['snap-of-sb-1'])
  })

  it('reports a command that hit its budget as exit 124 with the reason in stderr', async () => {
    const api = fakeApi()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      if (sandbox.sandboxID !== 'sb-1') {
        const timeout = new Error('deadline exceeded')
        timeout.name = 'TimeoutError'
        handle.run.mockRejectedValue(timeout)
      }
      return Promise.resolve(handle.sandbox)
    }
    const outcome = await new ForkEngine(deps(api, fakeSandbox())).run({ variants: [REQUEST.variants[0]!], timeoutSeconds: 7 })
    expect(outcome.variants[0]).toMatchObject({ exitCode: TIMEOUT_EXIT_CODE, stdoutTail: '', stderrTail: 'command exceeded 7s: deadline exceeded' })
  })

  it('collects the named directory from each variant into the result directory when it exists', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      handle.run.mockImplementation((command) => {
        if (command.startsWith('test -d')) return Promise.resolve({ exitCode: sandbox.sandboxID === 'sb-3' ? 1 : 0, stdout: '', stderr: '' })
        if (command.startsWith('tar -czf')) return Promise.resolve({ exitCode: 0, stdout: Buffer.from(`out-${sandbox.sandboxID}`).toString('base64'), stderr: '' })
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      })
      return Promise.resolve(handle.sandbox)
    }
    await new ForkEngine(deps(api, workspace)).run({ ...REQUEST, variants: REQUEST.variants.slice(0, 2), collect: 'out/' })

    expect(api.handles.get('sb-2')!.run).toHaveBeenCalledWith(`test -d ${JSON.stringify('/home/user/sci/out')}`, expect.anything())
    expect(api.handles.get('sb-2')!.run).toHaveBeenCalledWith(tarExportCommand('/home/user/sci/out', []), expect.anything())
    // Variant a's output was imported into the workspace; variant b had no out/ and nothing was imported for it.
    const imports = workspace.run.mock.calls.map(([command]) => command).filter(command => command.startsWith('mkdir -p'))
    expect(imports).toEqual([`mkdir -p '/home/user/sci/.sci/forks/f1/a/${COLLECT_DIR}' && tar -xzf '/tmp/camel-runtime-import.tgz' -C '/home/user/sci/.sci/forks/f1/a/${COLLECT_DIR}' && rm -f '/tmp/camel-runtime-import.tgz'`])
    const uploaded = workspace.write.mock.calls.find(([path]) => path === '/tmp/camel-runtime-import.tgz') as [string, ArrayBuffer]
    expect(Buffer.from(uploaded[1]).toString('utf8')).toBe('out-sb-2')
  })

  it('refuses a collect directory outside the workspace before touching anything', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    await expect(new ForkEngine(deps(api, workspace)).run({ ...REQUEST, collect: '../secrets' }))
      .rejects.toThrow('camel-runtime: ../secrets is outside the workspace /home/user/sci')
    expect(workspace.run).not.toHaveBeenCalled()
    expect(api.created).toEqual([])
  })

  it('runs at most `concurrency` variants at once (T5)', async () => {
    const api = fakeApi()
    await new ForkEngine(deps(api, fakeSandbox(), { concurrency: 2 })).run({
      variants: ['a', 'b', 'c', 'd', 'e'].map(name => ({ name, command: `make ${name}` })),
      timeoutSeconds: 30,
    })
    expect(api.peakInFlight).toBe(2)
  })

  it('kills every microVM and deletes the snapshot when a variant fails in transport (T4)', async () => {
    const api = fakeApi()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      if (sandbox.sandboxID === 'sb-3') handle.run.mockRejectedValue(new Error('envd unreachable'))
      return Promise.resolve(handle.sandbox)
    }
    await expect(new ForkEngine(deps(api, fakeSandbox(), { concurrency: 1 })).run(REQUEST)).rejects.toThrow('envd unreachable')
    expect(api.killed.sort()).toEqual(['sb-1', 'sb-2', 'sb-3'])
    expect(api.deletedTemplates).toEqual(['snap-of-sb-1'])
  })

  it('kills the seed and deletes nothing else when the snapshot fails (T4)', async () => {
    const api = fakeApi({ snapshot: () => Promise.reject(new Error('snapshot store full')) })
    await expect(new ForkEngine(deps(api, fakeSandbox())).run(REQUEST)).rejects.toThrow('snapshot store full')
    expect(api.killed).toEqual(['sb-1'])
    expect(api.deletedTemplates).toEqual([])
  })

  it('kills the seed when the import fails (T4)', async () => {
    const api = fakeApi()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      handle.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'disk full' })
      api.handles.set(sandbox.sandboxID, handle)
      return Promise.resolve(handle.sandbox)
    }
    await expect(new ForkEngine(deps(api, fakeSandbox())).run(REQUEST)).rejects.toThrow('camel-runtime: importing into /home/user/sci failed (exit 1): disk full')
    expect(api.killed).toEqual(['sb-1'])
  })

  it('creates nothing when the export itself fails', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    workspace.run.mockResolvedValue({ exitCode: 0, stdout: Buffer.alloc(2048).toString('base64'), stderr: '' })
    await expect(new ForkEngine(deps(api, workspace)).run(REQUEST)).rejects.toThrow('over the 1024-byte cap')
    expect(api.created).toEqual([])
  })

  it('surfaces the fork error even when a cleanup call fails', async () => {
    const api = fakeApi({
      kill: () => Promise.reject(new Error('kill refused')),
      snapshot: () => Promise.reject(new Error('snapshot store full')),
    })
    await expect(new ForkEngine(deps(api, fakeSandbox())).run(REQUEST)).rejects.toThrow('snapshot store full')
  })

  it('mints a sortable fork id and reads the clock when none are injected', async () => {
    const api = fakeApi()
    const { forkId: _pinnedId, now: _pinnedClock, ...unpinned } = deps(api, fakeSandbox())
    const engine = new ForkEngine(unpinned)
    const outcome = await engine.run({ variants: [REQUEST.variants[0]!], timeoutSeconds: 30 })
    expect(outcome.forkId).toMatch(/^\d{14}-[0-9a-f]{8}$/)
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps only the tail of long output', async () => {
    const api = fakeApi()
    api.connect = (sandbox) => {
      const handle = fakeSandbox()
      api.handles.set(sandbox.sandboxID, handle)
      handle.run.mockResolvedValue({ exitCode: 0, stdout: `${'x'.repeat(5000)}END`, stderr: '' })
      return Promise.resolve(handle.sandbox)
    }
    const outcome = await new ForkEngine(deps(api, fakeSandbox())).run({ variants: [REQUEST.variants[0]!], timeoutSeconds: 30 })
    expect(outcome.variants[0]!.stdoutTail).toHaveLength(4000)
    expect(outcome.variants[0]!.stdoutTail.endsWith('END')).toBe(true)
  })
})

describe('runShell', () => {
  it('returns the SDK exit error as a result, keeping its error text when present', async () => {
    const { sandbox, run } = fakeSandbox()
    run.mockRejectedValue(new CommandExitError({ exitCode: 2, stdout: 'o', stderr: 'e', error: 'exit status 2' }))
    await expect(runShell(sandbox, 'x', {})).resolves.toEqual({ exitCode: 2, stdout: 'o', stderr: 'e', error: 'exit status 2' })
  })

  it('rethrows anything else', async () => {
    const { sandbox, run } = fakeSandbox()
    run.mockRejectedValue(new Error('socket hang up'))
    await expect(runShell(sandbox, 'x', {})).rejects.toThrow('socket hang up')
  })
})

describe('mapWithConcurrency', () => {
  it('preserves order and handles an empty input', async () => {
    const delayed = (n: number): Promise<number> => new Promise<number>((resolve) => { setTimeout(() => { resolve(n * 10) }, n) })
    await expect(mapWithConcurrency([3, 1, 2], 2, delayed)).resolves.toEqual([30, 10, 20])
    await expect(mapWithConcurrency([], 4, () => Promise.resolve(1))).resolves.toEqual([])
  })
})
