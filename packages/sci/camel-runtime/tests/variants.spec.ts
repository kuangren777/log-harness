// The engine's lifecycle is the contract: a slot is one sandbox from create to
// delete, bounded per workspace, seeded from the template or forked from a
// sibling, resumed before every use, and cleaned up on every failure path so a
// failed create never leaks a microVM behind no slot.
import { describe, expect, it, vi } from 'vitest'
import { CommandExitError, FileNotFoundError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import {
  COLLECT_DIR,
  TIMEOUT_EXIT_CODE,
  VariantEngine,
  limitMessage,
  runShell,
  serializeRegistry,
  tarExportCommand,
} from '@deepseek-ai/dsh-camel-runtime'
import type { AgentEnvApi, AgentEnvSandbox, AgentEnvSandboxDetail, VariantEngineDeps, VariantRecord } from '@deepseek-ai/dsh-camel-runtime'

const ARCHIVE = Buffer.from('project-tar').toString('base64')
const CWD = '/home/user/sci'
const VARIANTS_DIR = `${CWD}/.sci/variants`
const REGISTRY = `${VARIANTS_DIR}/registry.json`

type RunOptions = { cwd?: string; timeoutMs?: number }
type Run = (command: string, options?: RunOptions) => Promise<{ exitCode: number; stdout: string; stderr: string }>

interface FakeSandbox {
  sandbox: Sandbox
  run: ReturnType<typeof vi.fn<Run>>
  files: Map<string, string>
}

/** A sandbox with an in-memory file store; tar exports answer with a fixed archive, `test -d` succeeds, other commands echo. */
function fakeSandbox(tag = 'ws'): FakeSandbox {
  const files = new Map<string, string>()
  const run = vi.fn<Run>().mockImplementation((command) => {
    if (command.startsWith('tar -czf')) return Promise.resolve({ exitCode: 0, stdout: ARCHIVE, stderr: '' })
    if (command.startsWith('find ')) return Promise.resolve({ exitCode: 0, stdout: '3\n', stderr: '' })
    return Promise.resolve({ exitCode: 0, stdout: `${tag}: ${command}`, stderr: '' })
  })
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

interface FakeApi extends AgentEnvApi {
  readonly created: { templateID: string; timeoutSeconds: number }[]
  readonly connected: string[]
  readonly killed: string[]
  readonly deletedTemplates: string[]
  readonly handles: Map<string, FakeSandbox>
  readonly gone: Set<string>
  readonly states: Map<string, 'running' | 'paused'>
}

/** An AgentENV whose sandboxes are numbered in creation order; `gone` names sandboxes it has forgotten. */
function fakeApi(overrides: Partial<AgentEnvApi> = {}): FakeApi {
  const api: FakeApi = {
    created: [],
    connected: [],
    killed: [],
    deletedTemplates: [],
    handles: new Map(),
    gone: new Set(),
    states: new Map(),
    createSandbox(templateID, timeoutSeconds) {
      api.created.push({ templateID, timeoutSeconds })
      const sandboxID = `sb-${api.created.length}`
      api.states.set(sandboxID, 'running')
      return Promise.resolve<AgentEnvSandbox>({ sandboxID, templateID })
    },
    connect(sandboxID) {
      api.connected.push(sandboxID)
      if (api.gone.has(sandboxID)) return Promise.resolve(undefined)
      api.states.set(sandboxID, 'running')
      return Promise.resolve<AgentEnvSandbox>({ sandboxID, templateID: 'sci' })
    },
    getSandbox(sandboxID) {
      if (api.gone.has(sandboxID)) return Promise.resolve(undefined)
      return Promise.resolve<AgentEnvSandboxDetail>({ sandboxID, templateID: 'sci', state: api.states.get(sandboxID) ?? 'paused', endAt: 'later' })
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
    open(sandbox) {
      const handle = api.handles.get(sandbox.sandboxID) ?? fakeSandbox(sandbox.sandboxID)
      api.handles.set(sandbox.sandboxID, handle)
      return Promise.resolve(handle.sandbox)
    },
    ...overrides,
  }
  return api
}

function deps(api: AgentEnvApi, workspace: FakeSandbox, extra: Partial<VariantEngineDeps> = {}): VariantEngineDeps {
  let tick = 0
  return {
    api,
    workspace: () => Promise.resolve(workspace.sandbox),
    cwd: CWD,
    variantsDir: VARIANTS_DIR,
    template: 'sci',
    maxVariants: 3,
    excludes: ['./.sci'],
    maxProjectBytes: 1024,
    sandboxTimeoutSeconds: 600,
    now: () => new Date(Date.UTC(2026, 7, 30, 0, 0, tick++)),
    ...extra,
  }
}

function engine(api: AgentEnvApi, workspace: FakeSandbox, extra: Partial<VariantEngineDeps> = {}): VariantEngine {
  return new VariantEngine(deps(api, workspace, extra))
}

function registryOf(workspace: FakeSandbox): VariantRecord[] {
  return (JSON.parse(workspace.files.get(REGISTRY) ?? '{"variants":[]}') as { variants: VariantRecord[] }).variants
}

describe('VariantEngine.create', () => {
  it('seeds a microVM from the template, copies the project to the same path, and records the slot', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const record = await engine(api, workspace).create('a', 'projects/p1/')

    expect(record).toEqual({
      name: 'a',
      project: 'projects/p1',
      sandboxID: 'sb-1',
      templateID: 'sci',
      createdAt: '2026-08-30T00:00:00.000Z',
      lastUsedAt: '2026-08-30T00:00:00.000Z',
    })
    expect(api.created).toEqual([{ templateID: 'sci', timeoutSeconds: 600 }])
    expect(workspace.run).toHaveBeenCalledWith(`test -d ${JSON.stringify(`${CWD}/projects/p1`)}`, expect.anything())
    expect(workspace.run).toHaveBeenCalledWith(tarExportCommand(`${CWD}/projects/p1`, ['./.sci']), expect.anything())
    const seeded = api.handles.get('sb-1')!
    expect(seeded.run.mock.calls[0]?.[0]).toContain(`-C '${CWD}/projects/p1'`)
    expect(registryOf(workspace)).toEqual([record])
  })

  it('refuses a malformed name, the workspace itself, an escaping project, and a missing project before creating anything', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    expect(() => subject.create('Bad', 'projects/p1')).toThrow('invalid variant name "Bad": use lowercase letters, digits, and dashes')
    expect(() => subject.create('a', '.')).toThrow('project must name a directory inside the workspace, not the workspace itself')
    expect(() => subject.create('a', '../x')).toThrow(`camel-runtime: ../x is outside the workspace ${CWD}`)
    workspace.run.mockImplementation(command => Promise.resolve(command.startsWith('test -d') ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }))
    await expect(subject.create('a', 'projects/nope')).rejects.toThrow(`project directory ${CWD}/projects/nope does not exist in the workspace`)
    expect(api.created).toEqual([])
    expect(workspace.files.has(REGISTRY)).toBe(false)
  })

  it('refuses a taken name', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    await expect(subject.create('a', 'projects/p2')).rejects.toThrow('variant "a" already exists; delete it first or choose another name')
    expect(api.created).toHaveLength(1)
  })

  it('refuses the slot past the cap, naming the slots in use', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace, { maxVariants: 2 })
    await subject.create('a', 'projects/p1')
    await subject.create('b', 'projects/p1')
    await expect(subject.create('c', 'projects/p1')).rejects.toThrow(limitMessage(2, ['a', 'b']))
    expect(limitMessage(2, ['a', 'b'])).toBe('variant limit reached: 2/2 slots are in use (a, b); delete one with delete_variant before creating another')
    expect(api.created).toHaveLength(2)
  })

  it('frees the slot again after a delete, so delete-then-create is the way past the cap', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace, { maxVariants: 1 })
    await subject.create('a', 'projects/p1')
    await subject.delete('a')
    await expect(subject.create('b', 'projects/p1')).resolves.toMatchObject({ name: 'b', sandboxID: 'sb-2' })
    expect(registryOf(workspace).map(variant => variant.name)).toEqual(['b'])
  })

  it('kills the fresh microVM when the import fails, and records nothing', async () => {
    const api = fakeApi()
    api.open = (sandbox) => {
      const handle = fakeSandbox(sandbox.sandboxID)
      handle.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'disk full' })
      api.handles.set(sandbox.sandboxID, handle)
      return Promise.resolve(handle.sandbox)
    }
    const workspace = fakeSandbox()
    await expect(engine(api, workspace).create('a', 'projects/p1')).rejects.toThrow(`camel-runtime: importing into ${CWD}/projects/p1 failed (exit 1): disk full`)
    expect(api.killed).toEqual(['sb-1'])
    expect(workspace.files.has(REGISTRY)).toBe(false)
  })

  it('surfaces the import error even when the rollback kill fails', async () => {
    const api = fakeApi({ kill: () => Promise.reject(new Error('kill refused')) })
    api.open = (sandbox) => {
      const handle = fakeSandbox(sandbox.sandboxID)
      handle.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'disk full' })
      return Promise.resolve(handle.sandbox)
    }
    await expect(engine(api, fakeSandbox()).create('a', 'projects/p1')).rejects.toThrow('disk full')
  })

  it('creates nothing when the project archive is over the cap', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    workspace.run.mockImplementation(command => Promise.resolve(
      command.startsWith('tar -czf') ? { exitCode: 0, stdout: Buffer.alloc(2048).toString('base64'), stderr: '' } : { exitCode: 0, stdout: '', stderr: '' },
    ))
    await expect(engine(api, workspace).create('a', 'projects/p1')).rejects.toThrow('over the 1024-byte cap')
    expect(api.created).toEqual([])
  })

  it('forks from a sibling: resume it, snapshot it, start from the snapshot, inherit the project', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    const forked = await subject.create('b', 'projects/p1', 'a')
    expect(forked).toEqual({
      name: 'b',
      project: 'projects/p1',
      sandboxID: 'sb-2',
      templateID: 'snap-of-sb-1',
      snapshotID: 'snap-of-sb-1',
      from: 'a',
      createdAt: '2026-08-30T00:00:01.000Z',
      lastUsedAt: '2026-08-30T00:00:01.000Z',
    })
    expect(api.connected).toEqual(['sb-1'])
    expect(api.created[1]).toEqual({ templateID: 'snap-of-sb-1', timeoutSeconds: 600 })
    // No second export: the fork carries the sibling's state, not a fresh copy.
    expect(workspace.run.mock.calls.filter(([command]) => command.startsWith('tar -czf'))).toHaveLength(1)
  })

  it('refuses to fork from an unknown sibling, or from one whose sandbox is gone', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await expect(subject.create('b', 'projects/p1', 'zzz')).rejects.toThrow('variant "zzz" does not exist; list_variants shows the current slots')
    await subject.create('a', 'projects/p1')
    api.gone.add('sb-1')
    await expect(subject.create('b', 'projects/p1', 'a')).rejects.toThrow('variant "a" has no sandbox any more; delete it and create it again before forking from it')
    expect(api.created).toHaveLength(1)
  })

  it('drops the snapshot when starting from it fails', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    api.createSandbox = () => Promise.reject(new Error('capacity'))
    await expect(subject.create('b', 'projects/p1', 'a')).rejects.toThrow('capacity')
    expect(api.deletedTemplates).toEqual(['snap-of-sb-1'])
    expect(registryOf(workspace).map(variant => variant.name)).toEqual(['a'])
  })

  it('surfaces the start error even when dropping the snapshot fails', async () => {
    const api = fakeApi({ deleteTemplate: () => Promise.reject(new Error('template busy')) })
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    api.createSandbox = () => Promise.reject(new Error('capacity'))
    await expect(subject.create('b', 'projects/p1', 'a')).rejects.toThrow('capacity')
  })

  it('reads the clock when none is injected', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const { now: _pinned, ...unpinned } = deps(api, workspace)
    const subject = new VariantEngine(unpinned)
    const record = await subject.create('a', 'projects/p1')
    expect(Date.parse(record.createdAt)).toBeGreaterThan(0)
    await subject.run('a', 'true', 5)
    expect(Date.parse(registryOf(workspace)[0]!.lastUsedAt)).toBeGreaterThanOrEqual(Date.parse(record.createdAt))
  })
})

describe('VariantEngine.run', () => {
  it('resumes the sandbox, runs in the project directory under the budget, and touches lastUsedAt', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    const result = await subject.run('a', 'make', 30)
    expect(api.connected).toEqual(['sb-1'])
    expect(api.handles.get('sb-1')!.run).toHaveBeenCalledWith('make', expect.objectContaining({ cwd: `${CWD}/projects/p1`, timeoutMs: 30_000 }))
    expect(result).toMatchObject({ name: 'a', exitCode: 0, stdoutTail: 'sb-1: make', stderrTail: '' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(registryOf(workspace)[0]!.lastUsedAt).toBe('2026-08-30T00:00:01.000Z')
  })

  it('reports a non-zero exit as a result', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    api.handles.get('sb-1')!.run.mockRejectedValue(new CommandExitError({ exitCode: 3, stdout: 'partial', stderr: 'no such target' }))
    await expect(subject.run('a', 'make', 30)).resolves.toMatchObject({ exitCode: 3, stdoutTail: 'partial', stderrTail: 'no such target' })
  })

  it('reports a command over its budget as exit 124 with the reason', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    const timeout = new Error('deadline exceeded')
    timeout.name = 'TimeoutError'
    api.handles.get('sb-1')!.run.mockRejectedValue(timeout)
    await expect(subject.run('a', 'sleep 99', 7)).resolves.toMatchObject({ exitCode: TIMEOUT_EXIT_CODE, stderrTail: 'command exceeded 7s: deadline exceeded' })
  })

  it('rethrows a transport failure', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    api.handles.get('sb-1')!.run.mockRejectedValue(new Error('envd unreachable'))
    await expect(subject.run('a', 'make', 30)).rejects.toThrow('envd unreachable')
  })

  it('refuses an unknown slot, and a slot whose sandbox AgentENV forgot', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await expect(subject.run('zzz', 'true', 5)).rejects.toThrow('variant "zzz" does not exist; list_variants shows the current slots')
    await subject.create('a', 'projects/p1')
    api.gone.add('sb-1')
    await expect(subject.run('a', 'true', 5)).rejects.toThrow('variant "a" has no sandbox any more (AgentENV restarted or expired it); delete_variant it and create it again')
  })

  it('keeps only the tail of long output', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    api.handles.get('sb-1')!.run.mockResolvedValue({ exitCode: 0, stdout: `${'x'.repeat(5000)}END`, stderr: '' })
    const result = await subject.run('a', 'big', 5)
    expect(result.stdoutTail).toHaveLength(4000)
    expect(result.stdoutTail.endsWith('END')).toBe(true)
  })
})

describe('VariantEngine.collect', () => {
  it('copies a project-relative directory into the variant\'s collect directory and counts the files', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    const result = await subject.collect('a', 'out/')
    const variant = api.handles.get('sb-1')!
    expect(variant.run).toHaveBeenCalledWith(`test -d ${JSON.stringify(`${CWD}/projects/p1/out`)}`, expect.anything())
    expect(variant.run).toHaveBeenCalledWith(tarExportCommand(`${CWD}/projects/p1/out`, ['./.sci']), expect.anything())
    expect(workspace.run.mock.calls.map(([command]) => command).some(command => command.startsWith(`mkdir -p '${VARIANTS_DIR}/a/${COLLECT_DIR}/out'`))).toBe(true)
    expect(result).toEqual({ name: 'a', path: 'out', destination: `${VARIANTS_DIR}/a/${COLLECT_DIR}/out`, files: 3 })
  })

  it('collects the whole project with `.` and reports zero files when the count is unreadable', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    workspace.run.mockImplementation(command => Promise.resolve(
      command.startsWith('find ') ? { exitCode: 0, stdout: 'garbage', stderr: '' } : { exitCode: 0, stdout: ARCHIVE, stderr: '' },
    ))
    await expect(subject.collect('a', '.')).resolves.toEqual({ name: 'a', path: '.', destination: `${VARIANTS_DIR}/a/${COLLECT_DIR}`, files: 0 })
  })

  it('refuses a path outside the project and a directory the variant does not have', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    await expect(subject.collect('a', '../p2')).rejects.toThrow(`camel-runtime: ../p2 is outside the workspace ${CWD}/projects/p1`)
    api.handles.get('sb-1')!.run.mockImplementation(command => Promise.resolve(command.startsWith('test -d') ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' }))
    await expect(subject.collect('a', 'out')).rejects.toThrow('variant "a" has no directory out under its project')
  })
})

describe('VariantEngine.delete', () => {
  it('kills the sandbox, drops a fork\'s snapshot, and removes the slot', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    const subject = engine(api, workspace)
    await subject.create('a', 'projects/p1')
    await subject.create('b', 'projects/p1', 'a')
    await expect(subject.delete('b')).resolves.toMatchObject({ name: 'b', sandboxID: 'sb-2', snapshotID: 'snap-of-sb-1' })
    expect(api.killed).toEqual(['sb-2'])
    expect(api.deletedTemplates).toEqual(['snap-of-sb-1'])
    await subject.delete('a')
    expect(api.killed).toEqual(['sb-2', 'sb-1'])
    expect(api.deletedTemplates).toEqual(['snap-of-sb-1'])
    expect(registryOf(workspace)).toEqual([])
  })

  it('refuses an unknown slot', async () => {
    await expect(engine(fakeApi(), fakeSandbox()).delete('zzz')).rejects.toThrow('variant "zzz" does not exist; list_variants shows the current slots')
  })
})

describe('VariantEngine.list', () => {
  it('reports each slot with its sandbox state, including a sandbox AgentENV forgot', async () => {
    const api = fakeApi()
    const subject = engine(api, fakeSandbox())
    await subject.create('a', 'projects/p1')
    await subject.create('b', 'projects/p2')
    await subject.create('c', 'projects/p1', 'a')
    api.states.set('sb-2', 'paused')
    api.gone.add('sb-3')
    const rows = await subject.list()
    expect(rows.map(row => [row.name, row.state, row.from])).toEqual([['a', 'running', undefined], ['b', 'paused', undefined], ['c', 'missing', 'a']])
  })

  it('is empty for a workspace with no registry', async () => {
    await expect(engine(fakeApi(), fakeSandbox()).list()).resolves.toEqual([])
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

describe('registry persistence across engines', () => {
  it('a new engine over the same workspace sees the slots the last one left', async () => {
    const api = fakeApi()
    const workspace = fakeSandbox()
    await engine(api, workspace).create('a', 'projects/p1')
    const later = engine(api, workspace)
    await expect(later.list()).resolves.toMatchObject([{ name: 'a', sandboxID: 'sb-1', state: 'running' }])
    workspace.files.set(REGISTRY, serializeRegistry([]))
    await expect(later.list()).resolves.toEqual([])
  })
})
