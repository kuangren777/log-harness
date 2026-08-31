// Denial is asserted THROUGH the tool registry against the real local
// filesystem, not by calling the pure decision functions: a gate that decides
// correctly but never reaches the executor is not a gate. Every case here also
// checks that the tool body did not run and that the session log carries the
// matching sci/fs-denied record.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as SciWorkspace from '@deepseek-ai/dsh-sci-workspace'
import { DEFAULT_FS_TOOLS } from '@deepseek-ai/dsh-sci-workspace'
import type { SciFsDeniedData } from '@deepseek-ai/dsh-sci-workspace'

/**
 * Resolve a complete config from the project root plus overrides. The Loader
 * composition suite covers the schema defaults; this one states them so the
 * plugin call is type-checked against the resolved config it receives.
 * @param projectRoot - absolute directory holding one subdirectory per project.
 * @param config - fields differing from the defaults.
 * @returns the complete config.
 */
function fullConfig(projectRoot: string, config: Partial<SciWorkspace.Config> = {}): SciWorkspace.Config {
  return {
    projectRoot,
    deliveryDir: 'workspace',
    scratchDir: 'tmp',
    bundleDirs: { papers: 'papers', sciplots: 'sciplots' },
    skillsDir: 'skills',
    privateDir: '.sci',
    spoolPendingDir: '.sci/spool/pending',
    denyRecursiveDeleteInBundles: true,
    // No subprocess seam is composed here, so the bootstrap never runs; the
    // bootstrap suite owns it.
    bootstrapCommand: 'sci-init',
    bootstrapTimeoutMs: 30_000,
    binaryProbeMaxBytes: 8 * 1024 * 1024,
    fsTools: DEFAULT_FS_TOOLS,
    ...config,
  }
}

const PAPER = {
  version: 1,
  title: 'Attention Revisited',
  entry: 'src/main.tex',
  versions: [{ id: 'v1', createdAt: '2026-01-01T00:00:00Z' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}

let root: string
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>>
let session: Session
let ran: string[]
let callCounter = 0

/**
 * A backend whose byte read always fails, standing in for a target that
 * disappears or loses readability between the gate's stat and its probe.
 */
class UnreadableFileSystem extends LocalFileSystem {
  override readBytes(_target: FsTarget, _signal: AbortSignal | undefined, _maxBytes: number): Promise<Uint8Array> {
    return Promise.reject(new Error('vanished between stat and read'))
  }
}

/** The `sci/fs-denied` records the session log holds, in order. */
function denials(): SciFsDeniedData[] {
  return session.events.flatMap((event: SessionEvent) => event.type === 'sci/fs-denied' ? [event.data] : [])
}

/** Dispatch one call through the real registry as the session's agent. */
function call(name: string, args: unknown, withAgent = true): Promise<ToolExecutionResult> {
  return callAs(withAgent ? session : undefined, name, args)
}

/** Dispatch one call through the real registry as a given session's agent. */
function callAs(caller: Session | undefined, name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...caller === undefined ? {} : { agent: { session: caller } as never },
    signal: new AbortController().signal,
  })
}

/** The `sci/fs-denied` records a given session's log holds, in order. */
function denialsOf(target: Session): SciFsDeniedData[] {
  return target.events.flatMap((event: SessionEvent) => event.type === 'sci/fs-denied' ? [event.data] : [])
}

/** A subagent session delegated into project `p1`, one level below the top. */
function delegatedSession(id: string): Session {
  return ctx.sessions.create(SessionId(id), { meta: { cwd: join(root, 'projects/p1'), origin: 'subagent', delegationDepth: 1 } })
}

/** The text a tool result carries. */
function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-workspace-'))
  await mkdir(join(root, 'projects/p1/papers/nn/src'), { recursive: true })
  await mkdir(join(root, 'projects/p1/papers/nn/versions/v1'), { recursive: true })
  await mkdir(join(root, 'projects/p1/sciplots/fig/versions/v1'), { recursive: true })
  await mkdir(join(root, 'projects/p1/tmp/refs'), { recursive: true })
  await mkdir(join(root, 'projects/p1/workspace'), { recursive: true })
  await mkdir(join(root, 'skills/sci-plot'), { recursive: true })
  await mkdir(join(root, '.sci/spool/pending'), { recursive: true })
  await writeFile(join(root, 'projects/p1/papers/nn/nn.paper'), JSON.stringify(PAPER, undefined, 2))
  await writeFile(join(root, 'projects/p1/papers/nn/versions/v1/main.tex'), 'archived\n')
  await writeFile(join(root, 'projects/p1/papers/nn/src/main.tex'), 'draft\n')
  await writeFile(join(root, 'projects/p1/tmp/refs/paper.pdf'), '%PDF-1.7\nbinary body')
  await writeFile(join(root, 'projects/p1/workspace/report.md'), 'plain text, long enough to probe\n')
  await writeFile(join(root, 'skills/sci-plot/SKILL.md'), '---\nname: sci-plot\n---\n')
  await writeFile(join(root, '.sci/spool/pending/queued.json'), '{}')

  ran = []
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  for (const [name, parameters] of [
    ['read', { file_path: { type: 'string' } }],
    ['write', { file_path: { type: 'string', required: true }, content: { type: 'string', required: true } }],
    ['edit', {
      file_path: { type: 'string', required: true },
      old_string: { type: 'string', required: true },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    }],
    ['bash', { command: { type: 'string' } }],
  ] as const) {
    ctx.tools.register({
      name,
      description: `stand-in for the real ${name} tool`,
      parameters,
      output: { schema: { type: 'null' }, render: () => [] },
      execute: () => {
        ran.push(name)
        return Promise.resolve(null)
      },
    })
  }
  session = ctx.sessions.create(SessionId('gate'), { meta: { cwd: join(root, 'projects/p1') } })
  fiber = await ctx.plugin(SciWorkspace, fullConfig(join(root, 'projects')))
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('path table through the tool registry', () => {
  it('refuses a write into an existing archived version and logs the rule (06-T1)', async () => {
    const result = await call('write', { file_path: 'papers/nn/versions/v1/main.tex', content: 'tampered' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('append-only')
    expect(ran).toEqual([])
    expect(denials()).toHaveLength(1)
    expect(denials()[0]).toMatchObject({
      op: 'write',
      path: join(root, 'projects/p1/papers/nn/versions/v1/main.tex'),
      rule: 'versions-append-only',
    })
    expect(denials()[0]?.reason).toContain('append-only')
  })

  it('refuses an edit of an archived version outright', async () => {
    const result = await call('edit', {
      file_path: 'papers/nn/versions/v1/main.tex',
      old_string: 'archived',
      new_string: 'tampered',
    })
    expect(result.isError).toBe(true)
    expect(denials()[0]?.rule).toBe('versions-append-only')
    expect(ran).toEqual([])
  })

  it('lets a new file into an append-only version store, which is what create-only means', async () => {
    const result = await call('write', { file_path: 'papers/nn/versions/v2/main.tex', content: 'fresh' })
    expect(result.isError).toBe(false)
    expect(ran).toEqual(['write'])
    expect(denials()).toEqual([])
  })

  it('refuses any tool write into a render-owned sciplot version store', async () => {
    await call('write', { file_path: 'sciplots/fig/versions/v1/out.png', content: 'x' })
    expect(denials()[0]?.rule).toBe('render-owned-versions')
  })

  it('refuses a foreign PDF placed among the manuscripts and points at the scratch area', async () => {
    const result = await call('write', { file_path: 'papers/nn/downloaded/attention.pdf', content: '%PDF' })
    expect(text(result)).toContain('tmp/refs/')
    expect(denials()[0]?.rule).toBe('references-outside-papers')
  })

  it('refuses a change to the synchronized skill tree and to harness-private state', async () => {
    await call('write', { file_path: join(root, 'skills/sci-plot/SKILL.md'), content: 'x' })
    await call('write', { file_path: join(root, '.sci/skills.json'), content: 'x' })
    expect(denials().map(denial => denial.rule)).toEqual(['skills-read-only', 'sci-private'])
  })

  it('accepts a new spool request and refuses replacing a queued one', async () => {
    expect((await call('write', { file_path: join(root, '.sci/spool/pending/new.json'), content: '{}' })).isError).toBe(false)
    await call('write', { file_path: join(root, '.sci/spool/pending/queued.json'), content: '{}' })
    expect(denials()[0]?.rule).toBe('spool-create-only')
  })

  it('leaves the delivery area, the scratch area, and the shared sources alone', async () => {
    for (const path of ['workspace/report.md', 'tmp/notes.txt', 'papers/nn/src/main.tex', 'sciplots/fig/code/plot.py']) {
      expect((await call('write', { file_path: path, content: 'x' })).isError).toBe(false)
    }
    expect(denials()).toEqual([])
  })

  it('leaves a tool it was not configured to gate untouched', async () => {
    ctx.tools.register({
      name: 'grep',
      description: 'ungated',
      parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'null' }, render: () => [] },
      execute: () => {
        ran.push('grep')
        return Promise.resolve(null)
      },
    })
    expect((await call('grep', { file_path: 'skills/sci-plot/SKILL.md' })).isError).toBe(false)
    expect(ran).toEqual(['grep'])
  })
})

describe('binary read gate', () => {
  it('refuses reading a PDF and names the extraction skill (08-T1)', async () => {
    const result = await call('read', { file_path: 'tmp/refs/paper.pdf' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('pdftotext')
    expect(denials()[0]).toMatchObject({ op: 'read', rule: 'binary-read' })
    expect(ran).toEqual([])
  })

  it('lets a text read through', async () => {
    expect((await call('read', { file_path: 'workspace/report.md' })).isError).toBe(false)
    expect(ran).toEqual(['read'])
  })

  it('lets a read the probe cannot use through, leaving the error to the read tool', async () => {
    await writeFile(join(root, 'projects/p1/tmp/short.txt'), '%PDF')
    expect((await call('read', { file_path: 'tmp/short.txt' })).isError).toBe(false)
    expect((await call('read', { file_path: 'tmp' })).isError).toBe(false)
    expect((await call('read', { file_path: 'tmp/absent.txt' })).isError).toBe(false)
    expect(denials()).toEqual([])
  })

  it('lets a read through when the bytes cannot be fetched after the size was known', async () => {
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(UnreadableFileSystem, { cwd: root })
    ctx.tools.register({
      name: 'read',
      description: 'stand-in',
      parameters: { file_path: { type: 'string' } },
      output: { schema: { type: 'null' }, render: () => [] },
      execute: () => {
        ran.push('read')
        return Promise.resolve(null)
      },
    })
    session = ctx.sessions.create(SessionId('unreadable'), { meta: { cwd: join(root, 'projects/p1') } })
    await ctx.plugin(SciWorkspace, fullConfig(join(root, 'projects')))
    expect((await call('read', { file_path: 'tmp/refs/paper.pdf' })).isError).toBe(false)
    expect(denials()).toEqual([])
  })

  it('skips the probe for a file larger than the configured cap', async () => {
    await fiber.dispose()
    await ctx.plugin(SciWorkspace, fullConfig(join(root, 'projects'), { binaryProbeMaxBytes: 8 }))
    expect((await call('read', { file_path: 'tmp/refs/paper.pdf' })).isError).toBe(false)
    expect(denials()).toEqual([])
  })
})

describe('manifest ownership gate', () => {
  it('refuses an edit that moves a platform-owned field and allows a title edit (06-T2)', async () => {
    const denied = await call('edit', {
      file_path: 'papers/nn/nn.paper',
      old_string: '"id": "v1"',
      new_string: '"id": "v9"',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('versions')
    expect(denials()[0]?.rule).toBe('manifest-owned-field')

    const allowed = await call('edit', {
      file_path: 'papers/nn/nn.paper',
      old_string: 'Attention Revisited',
      new_string: 'Attention, Revisited',
    })
    expect(allowed.isError).toBe(false)
    expect(ran).toEqual(['edit'])
  })

  it('refuses a whole-file write that drops the platform rows', async () => {
    await call('write', { file_path: 'papers/nn/nn.paper', content: JSON.stringify({ ...PAPER, versions: [] }) })
    expect(denials()[0]?.rule).toBe('manifest-owned-field')
  })

  it('refuses a write whose result would not be a valid manifest', async () => {
    await call('write', {
      file_path: 'papers/nn/nn.paper',
      content: JSON.stringify({ ...PAPER, title: 7 }),
    })
    expect(denials()[0]?.rule).toBe('manifest-invalid')
  })

  it('accepts a new manifest for a bundle that has none yet', async () => {
    const fresh = { ...PAPER, versions: [] }
    expect((await call('write', {
      file_path: 'papers/mm/mm.paper',
      content: JSON.stringify(fresh),
    })).isError).toBe(false)
  })

  it('refuses a manifest change it cannot reconstruct', async () => {
    const result = await call('edit', { file_path: 'papers/nn/nn.paper', old_string: 'Attention Revisited' })
    expect(result.isError).toBe(true)
    expect(denials()[0]?.rule).toBe('manifest-unverifiable')
  })

  it('leaves a non-manifest write in the same bundle alone', async () => {
    expect((await call('write', { file_path: 'papers/nn/src/main.tex', content: 'draft 2' })).isError).toBe(false)
    expect(denials()).toEqual([])
  })
})

describe('shell pre-screen through the registry', () => {
  it('refuses rm -rf on a bundle (06-T8)', async () => {
    const result = await call('bash', { command: 'rm -rf sciplots/fig' })
    expect(result.isError).toBe(true)
    expect(denials()[0]).toMatchObject({
      op: 'shell',
      path: join(root, 'projects/p1/sciplots/fig').replaceAll('\\', '/'),
      rule: 'bundle-recursive-delete',
    })
    expect(ran).toEqual([])
  })

  it('lets a delete inside the scratch area through', async () => {
    expect((await call('bash', { command: 'rm -rf tmp/build' })).isError).toBe(false)
    expect(ran).toEqual(['bash'])
  })

  it('screens a call with no session against the project root and logs nothing without one', async () => {
    const result = await call('bash', { command: 'rm -rf p1/papers' }, false)
    expect(result.isError).toBe(true)
    expect(denials()).toEqual([])
  })
})

describe('calls the gate has nothing to read', () => {
  it('lets a filesystem call with no path argument through', async () => {
    expect((await call('read', {})).isError).toBe(false)
    expect(ran).toEqual(['read'])
  })

  it('lets a shell call with no command argument through', async () => {
    expect((await call('bash', {})).isError).toBe(false)
    expect(ran).toEqual(['bash'])
  })

  it('lets a call whose path the backend cannot resolve through', async () => {
    expect((await call('write', { file_path: 'papers/nn/\u0000/x.tex', content: 'x' })).isError).toBe(false)
  })

  it('resolves against the backend default when the call carries no session', async () => {
    const result = await call('read', { file_path: join(root, 'tmp/refs/paper.pdf') }, false)
    expect(result.isError).toBe(false)
    expect(denials()).toEqual([])
  })
})

describe('plugin lifecycle', () => {
  it('refuses to load with a relative projectRoot rather than gating nothing', async () => {
    await expect(ctx.plugin(SciWorkspace, fullConfig('sci/projects'))).rejects.toThrow(/absolute path/)
  })

  it('stops gating when its fiber is disposed', async () => {
    await fiber.dispose()
    expect((await call('write', { file_path: 'papers/nn/versions/v1/main.tex', content: 'tampered' })).isError).toBe(false)
    expect(ran).toEqual(['write'])
  })
})

// The delegation bound holds THROUGH the registry for the file tools and the
// shell alike; the top-level session keeps its unbounded reads, so the rule
// changes nothing for the thread that holds the user.
describe('the delegation scope through the tool registry', () => {
  beforeEach(async () => {
    await mkdir(join(root, 'projects/p2/workspace'), { recursive: true })
    await writeFile(join(root, 'projects/p2/workspace/other.md'), 'a sibling project\'s deliverable\n')
  })

  it('refuses a delegated read of a sibling project and logs the rule', async () => {
    const child = delegatedSession('child-read')

    const result = await callAs(child, 'read', { file_path: join(root, 'projects/p2/workspace/other.md') })

    expect(ran).toEqual([])
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('outside the project this delegation was scoped to')
    const [denial] = denialsOf(child)
    expect(denial).toMatchObject({ op: 'read', path: join(root, 'projects/p2/workspace/other.md'), rule: 'delegation-scope' })
    expect(denial?.reason).toContain('only its own project, the skill tree, and the delivery spool')
  })

  it('refuses a delegated write above the project and a shell command reaching a sibling', async () => {
    const child = delegatedSession('child-write')

    const write = await callAs(child, 'write', { file_path: join(root, 'projects/notes.md'), content: 'x' })
    const shell = await callAs(child, 'bash', { command: 'cat ../p2/workspace/other.md' })

    expect(ran).toEqual([])
    expect(write.isError).toBe(true)
    expect(shell.isError).toBe(true)
    expect(denialsOf(child).map(denial => [denial.op, denial.path])).toEqual([
      ['write', join(root, 'projects/notes.md')],
      ['shell', join(root, 'projects/p2/workspace/other.md')],
    ])
  })

  it('lets a delegated agent read its own project, the skill tree, and the spool', async () => {
    const child = delegatedSession('child-own')

    await callAs(child, 'read', { file_path: join(root, 'projects/p1/workspace/report.md') })
    await callAs(child, 'read', { file_path: join(root, 'skills/sci-plot/SKILL.md') })
    await callAs(child, 'read', { file_path: join(root, '.sci/spool/pending/queued.json') })
    await callAs(child, 'bash', { command: 'ls workspace tmp && grep -rn draft papers/nn/src' })

    expect(ran).toEqual(['read', 'read', 'read', 'bash'])
    expect(denialsOf(child)).toEqual([])
  })

  it('leaves the top-level session unbounded, since it holds the user', async () => {
    await call('read', { file_path: join(root, 'projects/p2/workspace/other.md') })
    await call('bash', { command: 'cat ../p2/workspace/other.md' })

    expect(ran).toEqual(['read', 'bash'])
    expect(denials()).toEqual([])
  })
})
