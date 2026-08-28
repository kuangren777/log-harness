// The skeleton bootstrap is asserted THROUGH the mounted plugin against a
// scriptable subprocess seam, because what the defect broke was the wiring: the
// sandbox image ships an idempotent `sci-init` that nothing ever ran. The fake
// service records every spawn spec and scripts every outcome the seam can
// produce — success, non-zero exit, signal death, a spawn that throws, a `done`
// that rejects, and a command that never finishes — so each one is checked to
// land in the log and to leave the load alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { Context, LoggerLevel } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import * as SciWorkspace from '@deepseek-ai/dsh-sci-workspace'
import { BOOTSTRAP_CWD, lastLine, parseBootstrapArgv } from '@deepseek-ai/dsh-sci-workspace'

/** The production project root; no test here touches the filesystem under it. */
const PROJECT_ROOT = '/home/user/sci/projects'

/** What the shipped `sci-init` prints on success, last line last. */
const SCI_INIT_STDOUT = 'sci-init: laying down /home/user/sci\nsci-init: /home/user/sci ready (.sci memory projects references skills)\n'

/** One scripted spawn outcome. */
interface ScriptedRun {
  /** Exit facts, or `undefined` to settle only once the deadline aborts the spawn. */
  readonly outcome?: SubprocessOutcome
  /** Collected stdout; `undefined` keeps no reader, as a non-collect spawn would. */
  readonly stdout?: string
  /** Collected stderr; `undefined` keeps no reader. */
  readonly stderr?: string
  /** Rejection for `done`, standing in for a seam-level failure after the spawn. */
  readonly failure?: Error
}

/** A fixed-response collect-mode reader; the bootstrap reads each stream once, from 0. */
const reader = (text: string): SubprocessOutputReader => ({
  readFrom: () => ({ text, nextOffset: text.length, lossy: false }),
})

/** Every spawn spec the plugin handed the seam, in order. */
let spawns: SubprocessSpawnSpec[]
/** Every handle the fake produced, for termination assertions. */
let handles: FakeHandle[]
/** The armed outcome, read at spawn time so it can be set before the seam appears. */
let scripted: ScriptedRun
/** When set, `spawn()` throws it synchronously, as a bad argv or a dead sandbox does. */
let spawnFailure: Error | undefined

/**
 * A scripted handle. Without an armed outcome it settles only when the spec's
 * abort signal fires, which is how a command that outlives its deadline
 * behaves: the seam terminates the tree and the process closes on the signal.
 */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4242
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  /** True once the abort escalation or an explicit terminate ran. */
  terminated = false

  constructor(spec: SubprocessSpawnSpec, run: ScriptedRun) {
    this.collected = {
      ...run.stdout === undefined ? {} : { stdout: reader(run.stdout) },
      ...run.stderr === undefined ? {} : { stderr: reader(run.stderr) },
    }
    if (run.failure !== undefined) {
      this.done = Promise.reject(run.failure)
    } else if (run.outcome !== undefined) {
      this.done = Promise.resolve(run.outcome)
    } else {
      this.done = new Promise<SubprocessOutcome>((resolve) => {
        spec.signal?.addEventListener('abort', () => {
          this.terminated = true
          resolve({ exitCode: null, signal: 'SIGTERM' })
        }, { once: true })
      })
    }
  }

  terminate(): void {
    this.terminated = true
  }

  waitForExit(): Promise<boolean> {
    return Promise.resolve(true)
  }
}

/** A scriptable subprocess service; the bootstrap is the only caller in these tests. */
class FakeSubprocess extends SubprocessRuntime {
  override resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(command)
  }

  override spawnTerminal(): Promise<never> {
    return Promise.reject(new Error('the skeleton bootstrap spawns a pipe, never a terminal'))
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    spawns.push(spec)
    if (spawnFailure !== undefined) throw spawnFailure
    const handle = new FakeHandle(spec, scripted)
    handles.push(handle)
    return handle
  }
}

let ctx: Context
/** Every message logged from the composition, severity kept. */
let logs: { type: string; text: string }[]

/** The messages of one severity, in order. */
const logged = (type: 'info' | 'warn'): string[] => logs.filter(entry => entry.type === type).map(entry => entry.text)

/**
 * Mount the gate, resolving every field the overrides omit through the real
 * Config schema — the shipped `sci-init` default included. The cast covers the
 * schema declaration's input hole: `z<Config>` declares its input as the
 * resolved type, so a partial literal has no other spelling.
 */
const mount = (config: Partial<SciWorkspace.Config> = {}): ReturnType<Context['plugin']> =>
  ctx.plugin(SciWorkspace, new SciWorkspace.Config({ projectRoot: PROJECT_ROOT, ...config } as SciWorkspace.Config))

/** Let every already-queued continuation and expired timer run. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))

beforeEach(async () => {
  spawns = []
  handles = []
  spawnFailure = undefined
  scripted = { outcome: { exitCode: 0, signal: null }, stdout: SCI_INIT_STDOUT, stderr: '' }
  logs = []
  ctx = new Context()
  ctx.logger.exporter({
    levels: { default: LoggerLevel.DEBUG },
    export: (message) => { logs.push({ type: message.type, text: String(message.args[0]) }) },
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: tmpdir() })
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('the configured bootstrap command', () => {
  it('runs once through the subprocess seam and logs the command\'s own last line', async () => {
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('info')).toHaveLength(1) })

    expect(spawns).toHaveLength(1)
    expect(spawns[0]).toMatchObject({
      argv: ['sci-init'],
      cwd: BOOTSTRAP_CWD,
      graceMs: 5_000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 8 * 1024 }, stderr: { maxBytes: 8 * 1024 } },
    })
    expect(spawns[0]?.signal?.aborted).toBe(false)
    expect(logged('info')[0]).toBe(
      'sci-workspace: sandbox home skeleton ready: sci-init: /home/user/sci ready (.sci memory projects references skills)',
    )
    expect(logged('warn')).toEqual([])
  })

  it('runs after the seam appears, without holding up the load that mounted it', async () => {
    scripted = { stderr: '' }
    await mount()
    expect(spawns).toEqual([])

    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(spawns).toHaveLength(1) })
    expect(logs).toEqual([])
  })

  it('splits a configured command into argv without interpreting a shell', async () => {
    await mount({ bootstrapCommand: '  sci-init --root /home/user/sci  ' })
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(spawns).toHaveLength(1) })

    expect(spawns[0]?.argv).toEqual(['sci-init', '--root', '/home/user/sci'])
  })

  it('runs nothing when the command is blank, which is how a deployment opts out', async () => {
    await mount({ bootstrapCommand: '   ' })
    await ctx.plugin(FakeSubprocess)
    await settle()

    expect(spawns).toEqual([])
    expect(logs).toEqual([])
  })

  it('runs nothing when no subprocess seam is composed', async () => {
    await mount()
    await settle()

    expect(spawns).toEqual([])
    expect(logs).toEqual([])
  })

  it('runs once per mounted plugin, not once per subprocess provider', async () => {
    await mount()
    const provider = await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(spawns).toHaveLength(1) })

    await provider.dispose()
    await ctx.plugin(FakeSubprocess)
    await settle()

    expect(spawns).toHaveLength(1)
    expect(logged('info')).toHaveLength(1)
  })

  it('logs an empty summary rather than inventing one when the command prints nothing', async () => {
    scripted = { outcome: { exitCode: 0, signal: null }, stdout: '\n  \n', stderr: '' }
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('info')).toHaveLength(1) })

    expect(logged('info')[0]).toBe('sci-workspace: sandbox home skeleton ready: ')
  })
})

describe('a bootstrap that fails is logged and swallowed', () => {
  it('reports a non-zero exit with the stderr tail and keeps gating', async () => {
    scripted = {
      outcome: { exitCode: 1, signal: null },
      stdout: '',
      stderr: 'install: cannot change permissions of ‘/home/user/sci’: Operation not permitted\n',
    }
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(logged('warn')[0]).toBe(
      'sci-workspace: the sandbox home skeleton was not laid down, so a call under /home/user/sci/projects may fail as not found: '
      + 'sci-init exited with code 1: install: cannot change permissions of ‘/home/user/sci’: Operation not permitted',
    )
    expect(logged('info')).toEqual([])
    // The gate is still the mounting fiber's effect: a failed bootstrap must
    // not unload the listener that refuses a bundle-destroying call.
    expect(ctx.tools).toBeDefined()
  })

  it('reports a signal death, which is what a killed command leaves behind', async () => {
    scripted = { outcome: { exitCode: null, signal: 'SIGKILL' }, stdout: '', stderr: 'Killed\n' }
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(logged('warn')[0]).toContain('sci-init exited on signal SIGKILL: Killed')
  })

  it('reports a non-zero exit with no collected output, without a dangling separator', async () => {
    scripted = { outcome: { exitCode: 127, signal: null } }
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(logged('warn')[0]).toMatch(/sci-init exited with code 127$/)
  })

  it('reports a spawn that throws, so a missing executable is not a load failure', async () => {
    spawnFailure = new Error('spawn sci-init ENOENT')
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(logged('warn')[0]).toContain('sci-init could not run: Error: spawn sci-init ENOENT')
  })

  it('reports a seam that rejects after the spawn', async () => {
    scripted = { failure: new Error('sandbox is not running') }
    await mount()
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(logged('warn')[0]).toContain('sci-init could not run: Error: sandbox is not running')
  })

  it('terminates a command that outlives bootstrapTimeoutMs and reports the deadline', async () => {
    scripted = { stderr: 'still copying\n' }
    await mount({ bootstrapTimeoutMs: 20 })
    await ctx.plugin(FakeSubprocess)
    await vi.waitFor(() => { expect(logged('warn')).toHaveLength(1) })

    expect(handles[0]?.terminated).toBe(true)
    expect(logged('warn')[0]).toContain(
      'sci-init did not finish within 20 ms and was terminated (on signal SIGTERM): still copying',
    )
  })
})

describe('bootstrap command parsing', () => {
  it('reads a blank command as disabled', () => {
    expect(parseBootstrapArgv('')).toBeUndefined()
    expect(parseBootstrapArgv(' \n\t ')).toBeUndefined()
  })

  it('reads a command line as whitespace-separated argv', () => {
    expect(parseBootstrapArgv('sci-init')).toEqual(['sci-init'])
    expect(parseBootstrapArgv(' /usr/local/bin/sci-init\t--force ')).toEqual(['/usr/local/bin/sci-init', '--force'])
  })

  it('takes the last non-empty line of a stream as its summary', () => {
    expect(lastLine('first\nsecond\n')).toBe('second')
    expect(lastLine('only line, no newline')).toBe('only line, no newline')
    expect(lastLine('trailing spaces   \n\n\n')).toBe('trailing spaces')
    expect(lastLine('')).toBe('')
  })
})
