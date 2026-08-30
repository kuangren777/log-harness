# Science-Research Product Layer

English | [中文](sci.zh.md)

The `sci` layer is a product composition over the harness, not a new part of the spine: it reproduces the behaviour of a studied research-agent platform whose entire product surface was server-side prompt assembly, and lands each of those rules on a typed extension point instead. Every package under [`packages/sci`](../../packages/sci) is either a policy on an existing event, a model-facing tool, a storage projection, or the bundle that composes them; the agent loop is unchanged. Sandbox execution is the [`dormice`](../../packages/e2b/dormice) provider of the E2B seam.

Five of those packages publish a service, and this page is where their vocabulary lives.

## `ctx.sciAudit` — audit projection

Source: [`packages/sci/sci-audit/src/index.ts`](../../packages/sci/sci-audit/src/index.ts)

A projection over the session log, never over process events: it folds `tool/call`, `tool/result`, the `tool-workflow/*` records, `turn/end`, `request/context`, `approval/decided`, and the `sci/*` events into three owned tables (`sci_audit`, `sci_delivery`, `sci_plan`), and reads the tables `sci-skills` and `sci-memory` own for its summaries. Because the log is the only input, `rebuild` can truncate and re-project any session from durable state, which is what makes the projection a cache rather than a second source of truth. `summarize` computes per-session counts on demand — there is no session-end event to hang them on.

The row and report contracts (`AuditRecord`, `DeliveryRecord`, `PlanRecord`, `AuditSummary`, `RebuildReport`) are documented in [the package README](../../packages/sci/sci-audit/README.md).

## `ctx.sciMemory` — memory nodes and recall

Source: [`packages/sci/sci-memory/src/index.ts`](../../packages/sci/sci-memory/src/index.ts)

Observes accepted write and edit tool calls that land inside the memory directory, parses the node's frontmatter, backfills the originating session id when the node omits it, and records the turn the write happened in. Two RPC operations serve recall: `index` returns one orientation row per session, and `session` projects one session into clean dialogue with tool traffic stripped and compaction points kept. The write-timing distribution is a measurement, not a gate — the studied platform's "write memory on the spot" rule had an escape clause and measured zero compliance, so this layer makes the behaviour visible instead of pretending a softer reminder would work.

Contracts (`MemoryIndexRecord`, `RecallIndexValue`, `RecallSessionRequest`, `RecallSessionResult`) are documented in [the package README](../../packages/sci/sci-memory/README.md).

## `ctx.sciLiterature` — literature search

Source: [`packages/sci/sci-literature/src/runtime.ts`](../../packages/sci/sci-literature/src/runtime.ts)

One query fans out to OpenAlex, Semantic Scholar, arXiv and Crossref in parallel; each source has its own timeout and its failure lands in `sourceErrors` instead of failing the call, so a rate-limited source degrades the result rather than the tool. Replies are normalized to one record shape, merged by DOI, arXiv id or normalized title, and ranked by per-source rank plus citations. The same runtime registers the `literature_search` tool and its prompt section for the model, serves the 检索 view over the `sci.literature` Remote namespace, and keeps a short query history in the `sci_literature` domain — a convenience store, not a log projection, because browser searches have no session.

Contracts (`LiteratureRecord`, `LiteratureSearchRequest`, `LiteratureSearchResult`, `LiteratureRecentResult`) are documented in [the package README](../../packages/sci/sci-literature/README.md).

## `ctx.sciRemoteHosts` — managed SSH hosts

Source: [`packages/sci/sci-remote-hosts/src/index.ts`](../../packages/sci/sci-remote-hosts/src/index.ts)

Owns one delimited block inside the sandbox's `~/.ssh/config`. The guarantee is bidirectional: the block's contents are the service's to rewrite, and every byte outside it survives untouched, so a user's own `ProxyJump` chains coexist with registered hosts. A host switched off is commented out inside the block rather than deleted. Private keys go through the credential seam and never enter an event payload; only the `IdentityFile` path reaches the config file.

Contracts (`HostsListValue`, `HostsResult`, `UpsertHostRequest`, `RemoveHostRequest`, `ToggleHostRequest`) are documented in [the package README](../../packages/sci/sci-remote-hosts/README.md).

## `ctx.sciTierFork` — tier upgrade

Source: [`packages/sci/sci-tier/src/fork.ts`](../../packages/sci/sci-tier/src/fork.ts)

The balanced tier cannot fan out, so when a task outgrows a single pass the agent records a suggestion and the user decides. Accepting it creates a new session on the cluster preset rather than forking the old one: a fork would copy the conversation in which the agent explained what it could not do, and that history is exactly what the new session should not inherit. The new session gets the source's last user message, the titles of what was already delivered, and the stated reason.

Contracts (`SciTierForkRequest`, `SciTierForkResult`) are documented in [the package README](../../packages/sci/sci-tier/README.md).

## Where the rest lives

The gates and tools that carry most of the product behaviour publish no service: tier and fan-out gating in [`sci-tier`](../../packages/sci/sci-tier), path and manifest-ownership policy in [`sci-workspace`](../../packages/sci/sci-workspace), delivery in [`sci-deliver`](../../packages/sci/sci-deliver), workspace forking through AgentENV microVMs in [`camel-runtime`](../../packages/sci/camel-runtime), irreversible-action approval in [`sci-guard`](../../packages/sci/sci-guard), plan declaration in [`sci-plan`](../../packages/sci/sci-plan), the skill catalog and its sandbox sync in [`sci-skills`](../../packages/sci/sci-skills), the prompt chapters in [`sci-prompt`](../../packages/sci/sci-prompt), manifest validation in [`sci-manifest`](../../packages/sci/sci-manifest), and the composition itself in [`sci-profile`](../../packages/sci/sci-profile). Each package README states which mechanism of the studied platform it replaces and what changed.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsciagents--agentsruntime"></a>

### `ctx.sciAgents` — `AgentsRuntime`

The roster, its configuration, and its delegation log.

The service performs reads only, apart from the one settings write AgentsRuntime.configure makes; it never creates, resumes, or drives an Agent or Session.

```ts cordis-catalog
/**
 * The six personas with their live configuration and this month's real usage.
 * @returns the roster, in `PERSONA_NAMES` order.
 */
@Remote('roster') async roster(): Promise<RosterResult>

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
@Remote('configure') async configure(request: ConfigureRequest): Promise<ConfigureResult>

/**
 * One persona's delegations, newest first.
 * @param request - the persona and how many rows to return.
 * @returns the delegation log.
 * @throws Error when no persona carries the id.
 */
@Remote('calls') async calls(request: CallsRequest): Promise<CallsResult>

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
@Remote('models') async models(): Promise<ModelsResult>
```

Source: [`packages/sci/sci-agents/src/index.ts`](../../packages/sci/sci-agents/src/index.ts)

<a id="ctxsciaudit--sciauditservice"></a>

### `ctx.sciAudit` — `SciAuditService`

The audit projection, its cold rebuild, and the per-session summary.

The service reads the session log and writes only its own three tables; it never creates, resumes, or drives an Agent or Session.

```ts cordis-catalog
/**
 * Truncate the three owned tables for the named sessions and re-project them
 * from their logs.
 *
 * The cold read goes through `sessionQuery`, which is live-preferred, so a
 * session still in memory is replayed from the same events the live fold saw
 * and the two paths produce identical rows. Truncation runs for every session
 * before any re-projection so a `sci_plan` row a later session claimed is not
 * deleted after being rewritten.
 * @param sessionIds - the sessions to re-project, in the order they were requested.
 * @returns how many rows were deleted and written.
 * @throws SessionQueryError when the corpus does not hold one of the ids.
 */
rebuild(sessionIds: readonly SessionId[]): Promise<RebuildReport>

/**
 * Compute one session's audit summary from the committed rows and its log.
 * @param sessionId - the session to summarize.
 * @returns the summary.
 * @throws SessionQueryError when the corpus does not hold the id.
 */
async summarize(sessionId: SessionId): Promise<AuditSummary>

/**
 * Snapshot one session's committed `sci_audit` rows in log order.
 * @param sessionId - the session to read.
 * @returns the rows, ascending by the log coordinate they were projected from.
 */
auditRows(sessionId: SessionId): readonly AuditRecord[]

/**
 * Snapshot every committed `sci_delivery` row.
 * @returns the rows, in table order.
 */
deliveryRows(): readonly DeliveryRecord[]

/**
 * Snapshot every committed `sci_plan` row.
 * @returns the rows, in table order.
 */
planRows(): readonly PlanRecord[]
```

Types: [SessionId](core.md)

Source: [`packages/sci/sci-audit/src/index.ts`](../../packages/sci/sci-audit/src/index.ts)

<a id="ctxsciliterature--literatureruntime"></a>

### `ctx.sciLiterature` — `LiteratureRuntime`

Literature search across four public indexes, and the query history of the browser view that drives it. The service performs reads only: it never creates, resumes, or drives an Agent or Session.

```ts cordis-catalog
/**
 * Search every configured index and merge the answers into one ranked list.
 *
 * Failures of individual sources are reported, not thrown: the caller gets
 * the records the other indexes returned plus a `sourceErrors` entry naming
 * each one that did not answer.
 * @param request - the search as a tool call or the browser view states it.
 * @param signal - optional caller cancellation, merged with each source's own timeout.
 * @returns the merged, ranked, and truncated records with the failure report.
 * @throws LiteratureError `LITERATURE_INVALID_REQUEST` for a request
 *   {@link validateRequest} refuses, or `LITERATURE_ALL_SOURCES_FAILED` when
 *   no index answered.
 */
async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult>

/**
 * Search from the browser view, which has no cancellation of its own.
 * @param request - the search the view states.
 * @returns the merged, ranked, and truncated records with the failure report.
 */
@Remote('search') remoteSearch(request: LiteratureSearchRequest): Promise<LiteratureSearchResult>

/**
 * The queries this profile searched, newest first.
 * @returns the retained history rows.
 */
@Remote('recent') recent(): Promise<LiteratureRecentResult>

/**
 * Drop one query from the history.
 * @param request - the row to drop; an id the table does not hold is not an error.
 * @returns `{ ok: true }` once the row is absent.
 */
@Remote('forget') async forget(request: LiteratureForgetRequest): Promise<LiteratureForgetResult>
```

Source: [`packages/sci/sci-literature/src/runtime.ts`](../../packages/sci/sci-literature/src/runtime.ts)

<a id="ctxscimemory--scimemoryservice"></a>

### `ctx.sciMemory` — `SciMemoryService`

Memory observation, its durable index, and the recall endpoints over past sessions. The service reads and repairs memory nodes; it never creates, resumes, or drives an Agent or Session.

```ts cordis-catalog
/**
 * List every session in the logical corpus as one recall row.
 * @returns newest-first rows carrying the opening request and delivered titles.
 */
@Remote('index') async index(): Promise<RecallIndexValue>

/**
 * Read one past session's dialogue with tool traffic stripped.
 * @param request - the session to transcribe.
 * @returns the transcript, or `session-not-found` for an id the corpus does not hold.
 */
@Remote('session') async session(request: RecallSessionRequest): Promise<RecallSessionResult>

/**
 * Snapshot the memory index.
 *
 * The rows are the package's durable output: `sci audit rebuild` replays the
 * log into a fresh medium and compares the result against this snapshot.
 * @returns one immutable row per indexed slug.
 */
memoryIndex(): readonly MemoryIndexRecord[]

/**
 * Score how early the indexed memory nodes were written in their sessions.
 * @returns the score in `[0, 1]`, or `undefined` while nothing is indexed.
 */
timingScore(): number | undefined
```

Source: [`packages/sci/sci-memory/src/index.ts`](../../packages/sci/sci-memory/src/index.ts)

<a id="ctxsciremotehosts--sciremotehostsservice"></a>

### `ctx.sciRemoteHosts` — `SciRemoteHostsService`

Host registration, key custody, and the managed `~/.ssh/config` block.

The service never reads a private key back out for a caller: `list` reports only the path of the key an entry uses, so no endpoint of this package can return key material to whoever asks.

```ts cordis-catalog
/**
 * List every registered host, switched-off entries included.
 * @returns the roster with each entry's key path, or `malformed-config` when the file's markers cannot be paired.
 */
@Remote('list') async list(): Promise<HostsResult<HostsListValue>>

/**
 * Register one machine, replacing any entry that already carries its alias.
 *
 * The three writes commit in custody order: the credential record, then the
 * key file the entry will point at, then the block entry itself. An
 * interruption therefore leaves at worst a key nothing references, never an
 * entry naming a key that was never written.
 * @param request - the host to register and the private key it authenticates with.
 * @returns the roster as it stands after the write, or the refusal.
 */
@Remote('upsert') async upsert(request: UpsertHostRequest): Promise<HostsResult<HostsListValue>>

/**
 * Deregister one machine.
 *
 * The entry goes first, so no live entry ever points at a key that has been
 * emptied. The key file is then overwritten with nothing rather than removed:
 * `ctx.fs` has no unlink verb, and leaving the material readable would keep
 * the machine reachable from a sandbox the user just revoked it from.
 * @param request - the alias to remove.
 * @returns the roster as it stands after the removal, or the refusal.
 */
@Remote('remove') async remove(request: RemoveHostRequest): Promise<HostsResult<HostsListValue>>

/**
 * Switch one registered machine on or off.
 *
 * A switched-off host keeps its entry, commented out, and keeps its key: the
 * archived skill defines a commented entry inside the block as a host the
 * user turned off, and switching it back on must not require the key again.
 * @param request - the alias and the state to leave it in.
 * @returns the roster as it stands after the switch, or the refusal.
 */
@Remote('toggle') async toggle(request: ToggleHostRequest): Promise<HostsResult<HostsListValue>>
```

Source: [`packages/sci/sci-remote-hosts/src/index.ts`](../../packages/sci/sci-remote-hosts/src/index.ts)

<a id="ctxscitierfork--scitierforkservice"></a>

### `ctx.sciTierFork` — `SciTierForkService`

The upgrade fork endpoint. It creates and opens sessions; it never runs one, and it reads nothing but the source session's own log.

```ts cordis-catalog
/**
 * Continue one session's work at another tier, in a new session.
 * @param request - the session to continue from and the tier to continue at.
 * @returns the new session's identity and preset, or why the fork was refused.
 */
@Remote('fork') fork(request: SciTierForkRequest): SciTierForkResult
```

Source: [`packages/sci/sci-tier/src/fork.ts`](../../packages/sci/sci-tier/src/fork.ts)
<!-- END GENERATED cordis-surface -->
