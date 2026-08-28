/**
 * Memory-node observation, write-timing projection, and the recall RPC of the
 * science-research agent profile.
 *
 * The service owns three contributions, all effects of the mounting fiber:
 *
 * - A `tools/post-execute` observer. Every accepted call of a configured
 *   write/edit tool whose target resolves under `memoryDir` is read back, its
 *   frontmatter parsed, and a missing `metadata.originSessionId` repaired in
 *   place before `sci/memory-written` is appended. The observer NEVER blocks:
 *   it returns the decision the chain already reached, so a memory node the
 *   model wrote is never rejected by the layer that indexes it.
 * - The `sci_memory_index` projection, folded from those events plus the
 *   `turn/end` records that fix how long each originating session ran.
 * - Two Typert Remote endpoints under the `sci.recall` namespace, replacing the
 *   studied platform's `transcribe.py --index` / `--session` transcript reader.
 *
 * `fs/write-intent` and `fs/edit-intent` are deliberately untouched: both are
 * single-slot waterfalls already owned by `@deepseek-ai/dsh-fs-observation-policy`,
 * and a second claimant there would silently drop its compare-and-set guard.
 * @module @deepseek-ai/dsh-sci-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the services this plugin injects onto Context.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { parseMemoryFrontmatter, planOriginBackfill } from './frontmatter.ts'
import { projectRecallIndexRow, projectRecallSession } from './recall.ts'
import { MEMORY_INDEX_TABLE, sciMemoryDomainSpec } from './spec.ts'
import { memoryTimingScore } from './timing.ts'
import type {
  MemoryIndexRecord,
  RecallIndexRow,
  RecallIndexValue,
  RecallSessionRequest,
  RecallSessionResult,
} from './types.ts'

export type * from './types.ts'
export { METADATA_KEY, ORIGIN_SESSION_KEY, parseMemoryFrontmatter, planOriginBackfill } from './frontmatter.ts'
export { projectRecallIndexRow, projectRecallSession } from './recall.ts'
export { MEMORY_INDEX_TABLE, memoryIndexRecordSchema, memoryNodeTypeSchema, sciMemoryDomainSpec } from './spec.ts'
export { memoryTimingScore } from './timing.ts'

/** File extension a memory node must carry to be indexed. */
export const MEMORY_NODE_EXTENSION = '.md'

/** Cordis service key and default Remote namespace prefix of this package. */
export const SERVICE_KEY = 'sciMemory'

/** Wire namespace the two recall endpoints are exported under. */
export const RECALL_NAMESPACE = 'sci.recall'

/**
 * One tool whose accepted calls may have written a memory node.
 *
 * The tool layer names its own arguments, so the observer cannot assume them:
 * `@deepseek-ai/dsh-tool-fs` takes `file_path` while
 * `@deepseek-ai/dsh-tool-str-replace-editor` takes `path` and multiplexes read
 * and write behind a `command` argument.
 */
export interface MemoryToolBinding {
  /** Registered tool name. */
  name: string
  /** Argument field holding the target path. */
  pathArg: string
  /** Argument field naming the sub-command, or empty when the tool has none. */
  commandArg: string
  /** Sub-command values that write; empty exactly when `commandArg` is empty. */
  writeCommands: string[]
}

/** Deployment-varying choices of the science-research memory layer. */
export interface Config {
  /**
   * Absolute path of the memory directory inside the sandbox. Required: the
   * home layout differs per sandbox image, and a wrong guess would index
   * nothing while looking healthy.
   */
  memoryDir: string
  /** Tools whose accepted calls the observer inspects. */
  memoryTools: MemoryToolBinding[]
  /** Maximum characters of the opening request kept in one recall index row. */
  openingRequestLimit: number
}

/**
 * The write and edit tools the observer watches by default, with the argument
 * each one names its target path in. A deployment that mounts a differently
 * named file tool overrides the whole list.
 */
export const DEFAULT_MEMORY_TOOLS: readonly MemoryToolBinding[] = [
  { name: 'write', pathArg: 'file_path', commandArg: '', writeCommands: [] },
  { name: 'edit', pathArg: 'file_path', commandArg: '', writeCommands: [] },
  {
    name: 'str_replace_editor',
    pathArg: 'path',
    commandArg: 'command',
    writeCommands: ['create', 'str_replace', 'insert'],
  },
]

/** Character budget the studied platform's own transcript index used per line. */
const DEFAULT_OPENING_REQUEST_LIMIT = 120

/** Schemastery schema for the science-research memory layer. */
export const Config: z<Config> = z.object({
  memoryDir: z.string().required(),
  memoryTools: z.array(z.object({
    name: z.string().required(),
    pathArg: z.string().required(),
    commandArg: z.string().default(''),
    writeCommands: z.array(z.string()).default([]),
  })).default([...DEFAULT_MEMORY_TOOLS]),
  openingRequestLimit: z.number().step(1).min(1).default(DEFAULT_OPENING_REQUEST_LIMIT),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciMemory: SciMemoryService
  }
}

/**
 * Index the configured tool bindings by tool name.
 *
 * A binding that names a sub-command argument without naming which of its
 * values write would either index every read or index nothing, depending on
 * which half was forgotten; both are silent, so the pair is required together.
 * @param bindings - the configured bindings.
 * @returns the bindings keyed by tool name.
 * @throws when a binding declares a command argument without write commands, or the reverse.
 */
export function resolveMemoryTools(bindings: readonly MemoryToolBinding[]): Map<string, MemoryToolBinding> {
  const indexed = new Map<string, MemoryToolBinding>()
  for (const binding of bindings) {
    if ((binding.commandArg === '') !== (binding.writeCommands.length === 0)) {
      throw new TypeError(
        `sci-memory: tool "${binding.name}" must declare commandArg and writeCommands together, or neither`,
      )
    }
    indexed.set(binding.name, binding)
  }
  return indexed
}

/**
 * The turn a listener is running inside, read from the log the same way the
 * agent loop reads it when it resumes a session.
 * @param session - the session whose log is authoritative.
 * @returns the one-based current turn, or `0` before the first turn opened.
 */
function currentTurn(session: Session): number {
  return session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
}

/**
 * Base name of a resolved path, without its memory-node extension.
 * @param path - the canonical path of the written file, ending in {@link MEMORY_NODE_EXTENSION}.
 * @returns the slug the node is filed under when its frontmatter names none.
 */
function slugFromPath(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return path.slice(separator + 1, -MEMORY_NODE_EXTENSION.length)
}

/**
 * Read the target path out of one tool call's model arguments.
 *
 * A multiplexed editor tool reaches this observer for reads as well as writes,
 * so a call whose sub-command is not one of the binding's write commands has no
 * target here: indexing it would record a memory write that never happened.
 * @param args - the parsed model arguments.
 * @param binding - the tool's argument naming.
 * @returns the path, or `undefined` when the call did not write a file this observer understands.
 */
export function resolveTargetPath(args: unknown, binding: MemoryToolBinding): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  if (binding.commandArg !== '') {
    const command = record[binding.commandArg]
    if (typeof command !== 'string' || !binding.writeCommands.includes(command)) return undefined
  }
  const path = record[binding.pathArg]
  return typeof path === 'string' && path !== '' ? path : undefined
}

/**
 * Memory observation, its durable index, and the recall endpoints over past
 * sessions. The service reads and repairs memory nodes; it never creates,
 * resumes, or drives an Agent or Session.
 */
export class SciMemoryService extends TypertRemoteService {
  static inject = ['fs', 'sessionQuery', 'storageDomain', 'tools']

  /** Loader validation for the memory layer's deployment policy. */
  static Config: z<Config> = Config

  private readonly memoryDir: string
  private readonly openingRequestLimit: number
  private readonly bindings: Map<string, MemoryToolBinding>
  /** Assigned by `Service.init` before Cordis publishes the service or attaches its listeners. */
  private table!: KvTable<string, MemoryIndexRecord>

  /**
   * @param ctx - Host context carrying the filesystem, session query, storage-domain form, and tool registry.
   * @param config - the resolved deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // RECALL_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciMemory', { namespace: 'sci.recall' })
    this.memoryDir = config.memoryDir
    this.openingRequestLimit = config.openingRequestLimit
    this.bindings = resolveMemoryTools(config.memoryTools)
  }

  /** Open the projection and attach both log observers. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sciMemoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'sci-memory.domainClose')
    this.table = domain.table(MEMORY_INDEX_TABLE)

    this.ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      await this.observe(exec, result, decision)
      return decision
    })

    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      void this.foldTurnTotal(session.header.id, event.data.turn)
    })
  }

  /**
   * List every session in the logical corpus as one recall row.
   * @returns newest-first rows carrying the opening request and delivered titles.
   */
  @Remote('index')
  async index(): Promise<RecallIndexValue> {
    const records = await this.ctx.sessionQuery.listSessions()
    const sessions: RecallIndexRow[] = []
    for (const record of records) {
      const snapshot = await this.ctx.sessionQuery.readSession(record.header.id)
      sessions.push(projectRecallIndexRow(snapshot.session, snapshot.events, this.openingRequestLimit))
    }
    return { sessions }
  }

  /**
   * Read one past session's dialogue with tool traffic stripped.
   * @param request - the session to transcribe.
   * @returns the transcript, or `session-not-found` for an id the corpus does not hold.
   */
  @Remote('session')
  async session(request: RecallSessionRequest): Promise<RecallSessionResult> {
    try {
      const snapshot = await this.ctx.sessionQuery.readSession(request.sessionId)
      return { ok: true, value: projectRecallSession(snapshot.session, snapshot.events) }
    } catch (error: unknown) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        return { ok: false, error: { code: 'session-not-found', sessionId: request.sessionId } }
      }
      throw error
    }
  }

  /**
   * Snapshot the memory index.
   *
   * The rows are the package's durable output: `sci audit rebuild` replays the
   * log into a fresh medium and compares the result against this snapshot.
   * @returns one immutable row per indexed slug.
   */
  memoryIndex(): readonly MemoryIndexRecord[] {
    return [...this.table.entries()].map(([, record]) => record)
  }

  /**
   * Score how early the indexed memory nodes were written in their sessions.
   * @returns the score in `[0, 1]`, or `undefined` while nothing is indexed.
   */
  timingScore(): number | undefined {
    return memoryTimingScore(this.memoryIndex())
  }

  /**
   * Fold one accepted tool call into the memory index.
   *
   * Failures are contained and logged: the write itself already succeeded and
   * was already reported to the model, so a filesystem race between the write
   * and this read-back must not turn an accepted call into an error result.
   */
  private async observe(
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    decision: PostToolDecision,
  ): Promise<void> {
    const binding = this.bindings.get(exec.name)
    const session = exec.agent?.session
    if (binding === undefined || session === undefined || result.isError || decision.kind !== 'accept') return
    const path = resolveTargetPath(exec.arguments, binding)
    if (path === undefined) return
    try {
      await this.record(path, session)
    } catch (error: unknown) {
      this.ctx.logger.warn('sci-memory: could not index memory write %o: %o', path, error)
    }
  }

  /** Resolve, read, repair, and index one written path that may be a memory node. */
  private async record(path: string, session: Session): Promise<void> {
    const target = await this.ctx.fs.resolve(path)
    if (!(await this.underMemoryDir(target))) return
    const canonical = this.ctx.fs.processPath(target)
    if (!canonical.endsWith(MEMORY_NODE_EXTENSION)) return
    // The version read here guards the repair below, so it is taken before the
    // content it describes; an absent target is a node deleted between the
    // accepted write and this read-back, which indexes nothing.
    const info = await this.ctx.fs.stat(target)
    if (info === undefined) return
    const text = await this.ctx.fs.readText(target)
    const parsed = parseMemoryFrontmatter(text)
    if (parsed === undefined) return

    const backfill = planOriginBackfill(text, session.header.id)
    if (backfill !== undefined) {
      await this.ctx.fs.editText(target, backfill, { version: info.version })
    }
    const originSessionId = parsed.originSessionId ?? session.header.id
    const slug = parsed.name ?? slugFromPath(canonical)
    const writtenAtTurn = currentTurn(session)
    session.append('sci/memory-written', { slug, originSessionId, turnIndex: writtenAtTurn }, { ignorable: true })

    const stored = this.table.get(slug)
    await this.table.put(slug, {
      slug,
      originSessionId,
      ...parsed.type === undefined ? {} : { type: parsed.type },
      ...parsed.description === undefined ? {} : { description: parsed.description },
      writtenAtTurn,
      turnsTotal: stored === undefined ? writtenAtTurn : Math.max(writtenAtTurn, stored.turnsTotal),
    })
  }

  /**
   * Whether a resolved target is a file strictly inside the memory directory.
   * @param target - the resolved write target.
   * @returns whether the memory index should consider this path.
   */
  private async underMemoryDir(target: FsTarget): Promise<boolean> {
    const root = await this.ctx.fs.resolve(this.memoryDir)
    return root.targetKey !== target.targetKey && this.ctx.fs.contains(root, target)
  }

  /**
   * Carry every row of one session forward to the turn that just ended.
   *
   * `turn/end` numbers its own turn, so the highest number a session reached is
   * exactly the count of turns it completed — the same total a cold rebuild
   * derives by counting those events.
   */
  private async foldTurnTotal(sessionId: SessionId, turn: number): Promise<void> {
    for (const [slug, record] of [...this.table.entries()]) {
      if (record.originSessionId !== sessionId || record.turnsTotal >= turn) continue
      await this.table.put(slug, { ...record, turnsTotal: turn })
    }
  }
}

export default SciMemoryService
