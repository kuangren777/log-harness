// 04-T5 over the real tool pipeline: a memory node written without
// `metadata.originSessionId` is repaired on disk, its record names the writing
// turn, and the projection follows the session's turn count. Every call runs
// through the real ToolRuntime, tool-fs, tool-str-replace-editor, and a real
// local filesystem — the observer never sees a hand-built execution.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'
import SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolStrReplaceEditor from '@deepseek-ai/dsh-tool-str-replace-editor'
import SciMemoryService, { DEFAULT_MEMORY_TOOLS } from '@deepseek-ai/dsh-sci-memory'
import type { MemoryIndexRecord } from '@deepseek-ai/dsh-sci-memory'

const NODE_WITHOUT_ORIGIN = [
  '---',
  'name: agent-fuzzing-research',
  'description: Research paper on fuzzing LLM-based agents',
  'metadata:',
  '  node_type: memory',
  '  type: project',
  '---',
  '',
  'Completed the survey.',
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

interface Harness {
  ctx: Context
  memoryDir: string
  session: Session
  agent: Agent
  /** Run one tool call as the harness agent. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Read the projected rows. */
  rows(): MemoryIndexRecord[]
  /** Read the write-timing score over the projected rows. */
  timingScore(): number | undefined
  /** Read the `sci/memory-written` records the session log holds. */
  records(): SessionEvent<'sci/memory-written'>['data'][]
}

/**
 * Compose the service over the real tool, filesystem, and storage plugins.
 * @param options - overrides for the memory directory used by the service.
 * @returns the composed harness.
 */
async function boot(options: { memoryDirName?: string } = {}): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'dsh-sci-memory-'))
  const memoryDir = join(root, 'sci', options.memoryDirName ?? 'memory')
  await mkdir(memoryDir, { recursive: true })
  await mkdir(join(root, 'sci', 'workspace'), { recursive: true })
  await mkdir(join(root, 'storage'), { recursive: true })

  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: join(root, 'sci') })
  await ctx.plugin(ToolFs, {})
  await ctx.plugin(ToolStrReplaceEditor, {})
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionQuerySqlite, { path: join(root, 'query.sqlite') })
  await ctx.plugin(SciMemoryService, { memoryDir, memoryTools: [...DEFAULT_MEMORY_TOOLS], openingRequestLimit: 120 })

  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as Agent

  let callSeq = 0
  return {
    ctx,
    memoryDir,
    session,
    agent,
    call: (name, args) => ctx.tools.execute({
      callId: CallId(`call-${(callSeq += 1)}`),
      name,
      arguments: args,
      agent,
      signal: new AbortController().signal,
    }),
    rows: () => [...ctx.sciMemory.memoryIndex()],
    timingScore: () => ctx.sciMemory.timingScore(),
    records: () => session.events
      .filter(event => event.type === 'sci/memory-written')
      .map(event => event.data),
  }
}

describe('sci-memory over the real tool pipeline', () => {
  it('backfills a missing originSessionId and records the writing turn (04-T5)', async () => {
    const harness = await boot()
    const path = join(harness.memoryDir, 'agent-fuzzing-research.md')
    const result = await harness.call('write', { file_path: path, content: NODE_WITHOUT_ORIGIN })

    expect(result.isError).toBe(false)
    await expect(readFile(path, 'utf8')).resolves.toContain(`  originSessionId: ${harness.session.id}\n`)
    expect(harness.records()).toEqual([{
      slug: 'agent-fuzzing-research',
      originSessionId: harness.session.id,
      turnIndex: 1,
    }])
    expect(harness.rows()).toEqual([{
      slug: 'agent-fuzzing-research',
      originSessionId: harness.session.id,
      type: 'project',
      description: 'Research paper on fuzzing LLM-based agents',
      writtenAtTurn: 1,
      turnsTotal: 1,
    }])
  })

  it('appends the record with the ignorable marker so an unaware build keeps the log', async () => {
    const harness = await boot()
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'a.md'),
      content: NODE_WITHOUT_ORIGIN,
    })
    const record = harness.session.events.find(event => event.type === 'sci/memory-written')
    expect(record?.ignorable).toBe(true)
  })

  it('keeps an origin the node already declares and files it under its frontmatter name', async () => {
    const harness = await boot()
    const declared = NODE_WITHOUT_ORIGIN.replace(
      '  type: project',
      '  type: project\n  originSessionId: 97df9841-f244-4baf-b443-b663f0aa5884',
    )
    const path = join(harness.memoryDir, 'unrelated-file-name.md')
    await harness.call('write', { file_path: path, content: declared })

    await expect(readFile(path, 'utf8')).resolves.toBe(declared)
    expect(harness.records()).toEqual([{
      slug: 'agent-fuzzing-research',
      originSessionId: '97df9841-f244-4baf-b443-b663f0aa5884',
      turnIndex: 1,
    }])
  })

  it('files a node by its file name and omits the fields it does not declare', async () => {
    const harness = await boot()
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'gh-auth-via-host-config.md'),
      content: '---\ndescription: How gh authenticates\n---\n\nBody.\n',
    })
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'terse.md'),
      content: '---\nname: terse\nmetadata:\n  type: user\n---\n\nBody.\n',
    })
    expect(harness.records().map(record => record.slug)).toEqual(['gh-auth-via-host-config', 'terse'])
    const rows = new Map(harness.rows().map(record => [record.slug, record]))
    expect(rows.get('gh-auth-via-host-config')?.type).toBeUndefined()
    expect(rows.get('terse')?.description).toBeUndefined()
    expect(rows.get('terse')?.type).toBe('user')
  })

  it('follows an edit of an already-indexed node into a later turn', async () => {
    const harness = await boot()
    const path = join(harness.memoryDir, 'agent-fuzzing-research.md')
    await harness.call('write', { file_path: path, content: NODE_WITHOUT_ORIGIN })
    harness.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    harness.session.append('turn/start', { turn: 2 })
    await harness.call('edit', {
      file_path: path,
      old_string: 'Completed the survey.',
      new_string: 'Completed the survey and the paper.',
    })
    harness.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    harness.session.append('turn/start', { turn: 3 })
    harness.session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    expect(harness.records().map(record => record.turnIndex)).toEqual([1, 2])
    await vi.waitFor(() => {
      expect(harness.rows()).toEqual([expect.objectContaining({ writtenAtTurn: 2, turnsTotal: 3 })])
    })
    expect(harness.timingScore()).toBeCloseTo(1 / 3, 12)
  })

  it('indexes a str_replace_editor create and ignores its view command', async () => {
    const harness = await boot()
    const path = join(harness.memoryDir, 'created.md')
    await harness.call('str_replace_editor', { command: 'create', path, file_text: NODE_WITHOUT_ORIGIN })
    expect(harness.records()).toHaveLength(1)

    const before = await readFile(path, 'utf8')
    await harness.call('str_replace_editor', { command: 'view', path })
    expect(harness.records()).toHaveLength(1)
    await expect(readFile(path, 'utf8')).resolves.toBe(before)
  })

  it('ignores writes outside the memory directory, non-Markdown files, and non-nodes', async () => {
    const harness = await boot()
    await harness.call('write', {
      file_path: join(harness.memoryDir, '..', 'workspace', 'notes.md'),
      content: NODE_WITHOUT_ORIGIN,
    })
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'notes.txt'),
      content: NODE_WITHOUT_ORIGIN,
    })
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'plain.md'),
      content: '# Not a memory node\n',
    })
    await harness.call('read', { file_path: join(harness.memoryDir, 'plain.md') })
    expect(harness.records()).toEqual([])
    expect(harness.rows()).toEqual([])
  })

  it('ignores a call whose path argument is missing and a failed write', async () => {
    const harness = await boot()
    const missingPath = await harness.call('write', { content: NODE_WITHOUT_ORIGIN })
    const failed = await harness.call('write', {
      file_path: harness.memoryDir,
      content: NODE_WITHOUT_ORIGIN,
    })
    expect(missingPath.isError).toBe(true)
    expect(failed.isError).toBe(true)
    expect(harness.records()).toEqual([])
  })

  it('indexes nothing for a call made outside an agent', async () => {
    const harness = await boot()
    const result = await harness.ctx.tools.execute({
      callId: CallId('call-detached'),
      name: 'write',
      arguments: { file_path: join(harness.memoryDir, 'detached.md'), content: NODE_WITHOUT_ORIGIN },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(harness.records()).toEqual([])
  })

  it('contains a read-back failure instead of failing the accepted write', async () => {
    const harness = await boot()
    const path = join(harness.memoryDir, 'racing.md')
    await writeFile(path, NODE_WITHOUT_ORIGIN)
    // The tool succeeds, then the node is replaced by a directory before the
    // observer reads it back — the same outcome a concurrent deletion produces.
    // Registered after the service, so it runs INSIDE the service's `next()`
    // and the node is gone by the time the observer reads it back.
    const dispose = harness.ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const decision = await next()
      await rm(path, { force: true })
      await mkdir(path, { recursive: true })
      return decision
    })
    const result = await harness.call('write', { file_path: path, content: NODE_WITHOUT_ORIGIN })
    dispose()

    expect(result.isError).toBe(false)
    expect(harness.records()).toEqual([])
  })

  it('records turn 0 for a node written before the session opened a turn', async () => {
    const harness = await boot()
    const detached = harness.ctx.sessions.create()
    await harness.ctx.tools.execute({
      callId: CallId('call-untimed'),
      name: 'write',
      arguments: { file_path: join(harness.memoryDir, 'untimed.md'), content: NODE_WITHOUT_ORIGIN },
      agent: { id: detached.id, session: detached } as Agent,
      signal: new AbortController().signal,
    })
    expect(detached.events.filter(event => event.type === 'sci/memory-written').map(event => event.data))
      .toEqual([{ slug: 'agent-fuzzing-research', originSessionId: detached.id, turnIndex: 0 }])
    expect(harness.rows()).toEqual([expect.objectContaining({ writtenAtTurn: 0, turnsTotal: 0 })])
    expect(harness.timingScore()).toBeUndefined()
  })

  it('indexes nothing when the node is deleted between the write and the read-back', async () => {
    const harness = await boot()
    const path = join(harness.memoryDir, 'racing.md')
    // Registered after the service, so it runs INSIDE the service's `next()`.
    const dispose = harness.ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const decision = await next()
      await rm(path, { force: true })
      return decision
    })
    const result = await harness.call('write', { file_path: path, content: NODE_WITHOUT_ORIGIN })
    dispose()

    expect(result.isError).toBe(false)
    expect(harness.records()).toEqual([])
  })

  it('indexes writes of a memory node placed at a configured non-default directory', async () => {
    const harness = await boot({ memoryDirName: 'notes' })
    await harness.call('write', {
      file_path: join(harness.memoryDir, 'a.md'),
      content: NODE_WITHOUT_ORIGIN,
    })
    expect(harness.records()).toHaveLength(1)
  })
})
