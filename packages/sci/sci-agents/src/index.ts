/**
 * The persona roster, the live configuration of the six delegation tools, and
 * the delegation log — the host half of the browser's 智能体 view.
 *
 * The studied platform presented "training a new agent" as a product feature
 * over a roster table nothing enforced
 * ([04-persistence-model.md](../../../../ClawsGO-System/09-Target-Architecture/04-persistence-model.md)).
 * Here a persona is not a row in a table: it is a MOUNTED
 * `@deepseek-ai/dsh-tool-subagent` instance named `subagent_<persona>`, whose
 * charter reaches the child through the provider and whose availability, model
 * route, and tool scoping live in that instance's settings section. This
 * service owns no state of its own — it reads the persona documents
 * `@deepseek-ai/dsh-sci-profile` ships, the settings sections those instances
 * registered, the model directory `ctx.llm` publishes, and the session logs the
 * corpus keeps, and it writes exactly one thing: the settings section. Nothing
 * here can be true of a deployment while being false of what the model can do,
 * because the same section is what the tool re-reads on every delegation.
 *
 * That is also why there is no "train a new agent" endpoint: a seventh persona
 * would need a seventh mounted row, and rows come from a preset composition
 * file, not from a click.
 *
 * No session event is appended. Configuring a persona is an act with no
 * session and no Agent behind it, and the settings seam already records the
 * write; an event would have no session to belong to.
 * @module @deepseek-ai/dsh-sci-agents
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { PERSONA_NAMES } from '@deepseek-ai/dsh-sci-plan'
import { BUNDLED_AGENTS_ROOT, loadPersonas } from '@deepseek-ai/dsh-sci-profile'
import type { SciPersona } from '@deepseek-ai/dsh-sci-profile'
import { subagentToolName } from '@deepseek-ai/dsh-sci-tier'
import { subagentSettingsNamespace } from '@deepseek-ai/dsh-tool-subagent'
import type { RuntimeConfig } from '@deepseek-ai/dsh-tool-subagent'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
// Type-only: merges the services this plugin injects or optionally reads onto Context.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-sci-audit'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-settings'
import { readPermissions, writePermissions } from './permissions.ts'
import type { PermissionTools } from './permissions.ts'
import {
  attachChildTimings,
  childRun,
  delegationCalls,
  monthStart,
  summarizeCalls,
} from './stats.ts'
import type { ChildRun } from './stats.ts'
import type {
  AgentCall,
  CallsRequest,
  CallsResult,
  ConfigureRequest,
  ConfigureResult,
  ModelProvider,
  ModelCatalogFailure,
  ModelsResult,
  RosterAgent,
  RosterResult,
} from './types.ts'

export type * from './types.ts'
export { PERMISSION_KEYS, readPermissions, writePermissions } from './permissions.ts'
export type { PermissionKey, PermissionTools } from './permissions.ts'
export {
  attachChildTimings,
  callTask,
  childRun,
  delegationCalls,
  metaOutputTokens,
  monthStart,
  retrievalFigures,
  summarizeCalls,
} from './stats.ts'
export type { ChildRun } from './stats.ts'

/** Cordis service key this package publishes itself under. */
export const SERVICE_KEY = 'sciAgents'

/** Wire namespace the four roster endpoints are exported under. */
export const AGENTS_NAMESPACE = 'sci.agents'

/** Rows one `calls` read returns when the caller names no limit. */
export const DEFAULT_CALL_LIMIT = 50

/** Registered names of the web tools the `web` switch withholds. */
const DEFAULT_WEB_TOOLS = ['web_search', 'web_fetch', 'literature_search']

/** Registered names of the execution and write tools the `code` switch withholds. */
const DEFAULT_CODE_TOOLS = ['bash', 'write', 'edit', 'univer_execute']

/** Registered names of the knowledge-base tools the `writeLibrary` switch withholds. */
const DEFAULT_LIBRARY_TOOLS = ['library_add', 'citations_add']

/** Deployment-varying choices of the persona-roster layer. */
export interface Config {
  /**
   * Preset id whose composition mounts the six `subagent_<persona>` rows. The
   * roster ensures this preset's standing mount before reading settings, so the
   * page answers with no session open; a deployment that renamed the preset
   * must say so here or every persona would report as uncomposed.
   */
  preset: string
  /**
   * Absolute path of the persona charter directory, matching the
   * `@deepseek-ai/dsh-sci-profile` row's `agentsRoot`. Defaults to the tree
   * bundled in that package.
   */
  agentsRoot: string
  /**
   * Registered tool names the `web` permission switch withholds. Tool
   * registration is a composition choice — a deployment may rename or replace
   * these — so the names cannot be fixed in this package.
   */
  webTools: string[]
  /** Registered tool names the `code` permission switch withholds. */
  codeTools: string[]
  /** Registered tool names the `writeLibrary` permission switch withholds. */
  libraryTools: string[]
}

/** Schemastery schema for the persona-roster layer. */
export const Config: z<Config> = z.object({
  preset: z.string().default('sci-cluster'),
  agentsRoot: z.string().default(BUNDLED_AGENTS_ROOT),
  webTools: z.array(z.string()).default(DEFAULT_WEB_TOOLS),
  codeTools: z.array(z.string()).default(DEFAULT_CODE_TOOLS),
  libraryTools: z.array(z.string()).default(DEFAULT_LIBRARY_TOOLS),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    sciAgents: AgentsRuntime
  }
}

/** One session's log as the corpus served it, with its own children folded. */
interface Corpus {
  /** Every readable session log, keyed for delegation scanning. */
  readonly logs: readonly { readonly sessionId: string; readonly events: readonly SessionEvent[] }[]
  /** The subagent children of each session, by the parent's id. */
  readonly children: ReadonlyMap<string, readonly ChildRun[]>
}

/**
 * The roster, its configuration, and its delegation log.
 *
 * The service performs reads only, apart from the one settings write
 * {@link AgentsRuntime.configure} makes; it never creates, resumes, or drives
 * an Agent or Session.
 */
export class AgentsRuntime extends TypertRemoteService {
  static inject = ['agentPresets', 'llm', 'sessionQuery', 'settings']

  /** Loader validation for the roster layer's deployment policy. */
  static Config: z<Config> = Config

  private readonly config: Config
  private readonly tools: PermissionTools
  /** The six charters, read once at mount so a malformed tree fails loud there. */
  private readonly personas: readonly SciPersona[]

  /**
   * @param ctx - Host context carrying the preset roster, model directory, session corpus, and settings seam.
   * @param config - the resolved deployment configuration.
   * @throws Error when the charter directory is unreadable or its documents do
   *   not form the complete roster.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert host analyzer reads the service key and namespace off this
    // call site, so both must be the literals themselves; SERVICE_KEY and
    // AGENTS_NAMESPACE re-export the same strings for consumers.
    super(ctx, 'sciAgents', { namespace: 'sci.agents' })
    this.config = config
    this.tools = {
      web: config.webTools,
      code: config.codeTools,
      writeLibrary: config.libraryTools,
    }
    this.personas = loadPersonas(config.agentsRoot)
  }

  /**
   * The six personas with their live configuration and this month's real usage.
   * @returns the roster, in `PERSONA_NAMES` order.
   */
  @Remote('roster')
  async roster(): Promise<RosterResult> {
    await this.ensureComposed()
    const corpus = await this.readCorpus()
    const since = monthStart(new Date())
    return {
      agents: this.personas.map(persona => this.describe(persona, corpus, since)),
    }
  }

  /**
   * Write one persona's availability, base model, or permissions.
   *
   * The write lands in the delegation tool's own settings section, which that
   * tool re-reads on its next execution — so the change reaches the next
   * delegation without re-registering the tool or restarting the session.
   * @param request - the persona and the fields the gesture changed.
   * @returns the persona as the roster reports it after the write.
   * @throws Error when no persona carries the id, or when the deployment's
   *   composition mounts no delegation tool for it.
   */
  @Remote('configure')
  async configure(request: ConfigureRequest): Promise<ConfigureResult> {
    await this.ensureComposed()
    const persona = this.personas.find(entry => entry.name === request.persona)
    if (persona === undefined) {
      throw new Error(
        `sci-agents: no persona is named ${JSON.stringify(request.persona)} `
        + `(the roster is ${PERSONA_NAMES.join(', ')})`,
      )
    }
    const namespace = subagentSettingsNamespace(subagentToolName(persona.name))
    if (this.settingsOf(persona) === undefined) {
      throw new Error(
        `sci-agents: preset ${JSON.stringify(this.config.preset)} mounts no delegation tool for `
        + `${JSON.stringify(persona.name)}, so there is no settings section to write`,
      )
    }
    const ops = this.patchOps(namespace, request)
    if (ops.length > 0) await this.ctx.settings.mutate(namespace, ops)
    const corpus = await this.readCorpus()
    return { agent: this.describe(persona, corpus, monthStart(new Date())) }
  }

  /**
   * One persona's delegations, newest first.
   * @param request - the persona and how many rows to return.
   * @returns the delegation log.
   * @throws Error when no persona carries the id.
   */
  @Remote('calls')
  async calls(request: CallsRequest): Promise<CallsResult> {
    const persona = this.personas.find(entry => entry.name === request.persona)
    if (persona === undefined) {
      throw new Error(
        `sci-agents: no persona is named ${JSON.stringify(request.persona)} `
        + `(the roster is ${PERSONA_NAMES.join(', ')})`,
      )
    }
    const limit = request.limit ?? DEFAULT_CALL_LIMIT
    const corpus = await this.readCorpus()
    return { calls: this.personaCalls(persona, corpus).slice(0, Math.max(0, limit)) }
  }

  /**
   * The base models this deployment can route a child to.
   *
   * Read from `ctx.llm` — the same directory `sessions.models` serves the
   * session model picker from — rather than from a list of this package's own,
   * so a provider a deployment added is offered here the moment it registers.
   * A provider whose catalog lookup fails is reported instead of failing the
   * read, exactly as the session picker treats it: the other providers stay
   * choosable.
   * @returns the catalog, and the providers that did not answer.
   */
  @Remote('models')
  async models(): Promise<ModelsResult> {
    const settled = await Promise.all(this.ctx.llm.listProviders().map(async (provider) => {
      try {
        const models = await this.ctx.llm.listModels(provider.id)
        return {
          group: { provider: provider.id, models: models.map(model => ({ model: model.id })) },
        }
      } catch (error: unknown) {
        return {
          failure: {
            provider: provider.id,
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    }))
    const providers = settled.flatMap((item): ModelProvider[] =>
      item.group === undefined || item.group.models.length === 0 ? [] : [item.group])
    const failures = settled.flatMap((item): ModelCatalogFailure[] =>
      item.failure === undefined ? [] : [item.failure])
    return { providers, failures }
  }

  /**
   * Ensure the preset that mounts the six delegation tools is standing.
   *
   * The settings sections belong to the MOUNTED `tool-subagent` rows, and a
   * preset is mounted once per process by the first session that joins it. A
   * roster page opened before any session exists would otherwise read six
   * unregistered namespaces and report six uncomposed personas; ensuring the
   * standing mount registers them without starting an agent, a session, or a
   * turn.
   */
  private async ensureComposed(): Promise<void> {
    await this.ctx.agentPresets.standingKeyFor(this.config.preset)
  }

  /** The delegation tool's resolved settings, or `undefined` when it is not mounted. */
  private settingsOf(persona: SciPersona): RuntimeConfig | undefined {
    const namespace = subagentSettingsNamespace(subagentToolName(persona.name))
    return this.ctx.settings.get(namespace) as RuntimeConfig | undefined
  }

  /** Build one roster row from the charter, its settings, and the scanned corpus. */
  private describe(persona: SciPersona, corpus: Corpus, since: number): RosterAgent {
    const runtime = this.settingsOf(persona)
    const calls = this.personaCalls(persona, corpus).filter(call => call.ts >= since)
    const toolName = subagentToolName(persona.name)
    const stats = summarizeCalls(calls, this.monthCalls(corpus, toolName, since) ?? calls.length)
    return {
      persona: persona.name,
      toolName,
      name: persona.display?.name ?? persona.name,
      role: persona.display?.role ?? persona.summary,
      summary: persona.display?.description ?? persona.summary,
      ...persona.icon === undefined ? {} : { icon: persona.icon },
      // An unmounted tool cannot accept a delegation, so it is not enabled —
      // the two causes are deliberately not distinguished on the card, because
      // the only thing a person can act on is that no work will reach it.
      enabled: runtime?.enabled ?? false,
      ...runtime?.model === undefined ? {} : { model: { ...runtime.model } },
      permissions: readPermissions(runtime?.toolFilter?.deny, this.tools),
      stats,
    }
  }

  /**
   * This month's delegation count from the audit projection.
   *
   * The audit table is the projection of record for "a tool was called", and it
   * survives a log the corpus can no longer serve. A deployment that composes
   * no `sciAudit` gets `undefined`, and the caller falls back to counting the
   * rows it just scanned.
   */
  private monthCalls(corpus: Corpus, toolName: string, since: number): number | undefined {
    const audit = this.ctx.get('sciAudit')
    if (audit === undefined) return undefined
    let count = 0
    for (const log of corpus.logs) {
      for (const row of audit.auditRows(log.sessionId as SessionId)) {
        if (row.kind === 'tool-call' && row.toolName === toolName && row.ts >= since) count += 1
      }
    }
    return count
  }

  /** Every delegation to one persona across the corpus, newest first. */
  private personaCalls(persona: SciPersona, corpus: Corpus): AgentCall[] {
    const toolName = subagentToolName(persona.name)
    const rows: AgentCall[] = []
    for (const log of corpus.logs) {
      const calls = delegationCalls(log.sessionId, log.events, toolName)
      if (calls.length === 0) continue
      rows.push(...attachChildTimings(calls, corpus.children.get(log.sessionId) ?? [], persona.charter))
    }
    return rows.sort((left, right) => right.ts - left.ts)
  }

  /**
   * Read every session log once, folding each subagent child to its run.
   *
   * A session the corpus lists but can no longer serve is skipped rather than
   * failing the read: a roster page that goes blank because one old log was
   * archived would be worse than one reporting the sessions that remain.
   */
  private async readCorpus(): Promise<Corpus> {
    const records = await this.ctx.sessionQuery.listSessions()
    const logs: { sessionId: string; events: readonly SessionEvent[] }[] = []
    const children = new Map<string, ChildRun[]>()
    for (const record of records) {
      let events: readonly SessionEvent[]
      try {
        events = (await this.ctx.sessionQuery.readSession(record.header.id)).events
      } catch {
        continue
      }
      logs.push({ sessionId: String(record.header.id), events })
      const parent = record.header.parentSession
      if (parent === undefined) continue
      const run = childRun(events, this.config.webTools)
      if (run === undefined) continue
      const siblings = children.get(String(parent))
      if (siblings === undefined) children.set(String(parent), [run])
      else siblings.push(run)
    }
    return { logs, children }
  }

  /**
   * Translate one patch into path-addressed settings edits.
   *
   * Path ops rather than a merge patch because turning every permission back on
   * REMOVES the deny list, which a merge cannot express, and because a caller
   * holding a partial view must never restate fields it did not touch.
   */
  private patchOps(namespace: ReturnType<typeof subagentSettingsNamespace>, request: ConfigureRequest): SettingsPathOp[] {
    const ops: SettingsPathOp[] = []
    const { patch } = request
    if (patch.enabled !== undefined) ops.push({ op: 'set', path: ['enabled'], value: patch.enabled })
    if (patch.model !== undefined) {
      ops.push({ op: 'set', path: ['model'], value: { provider: patch.model.provider, model: patch.model.model } })
    }
    if (patch.permissions !== undefined) {
      const stored = this.storedDeny(namespace)
      const deny = writePermissions(stored, patch.permissions, this.tools)
      ops.push(deny === undefined
        ? { op: 'unset', path: ['toolFilter', 'deny'] }
        : { op: 'set', path: ['toolFilter', 'deny'], value: [...deny] })
    }
    return ops
  }

  /**
   * The USER layer's stored deny list for one namespace.
   *
   * Deliberately the raw user section rather than the resolved value: the
   * composition entry's own denials are projected into the settings `base` and
   * are a floor no write may lift, so rewriting the user layer from the
   * resolved list would copy them into a layer that then pretends to own them.
   */
  private storedDeny(namespace: ReturnType<typeof subagentSettingsNamespace>): readonly string[] | undefined {
    const descriptor = this.ctx.settings.describe().find(entry => entry.ns === namespace)
    const user: unknown = descriptor?.user
    if (typeof user !== 'object' || user === null || Array.isArray(user)) return undefined
    const filter: unknown = (user as Record<string, unknown>).toolFilter
    if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) return undefined
    const deny: unknown = (filter as Record<string, unknown>).deny
    return Array.isArray(deny) && deny.every(name => typeof name === 'string') ? deny : undefined
  }
}

export default AgentsRuntime
