# 科研智能体产品层

[English](sci.md) | 中文

`sci` 层是建立在 harness 之上的产品组合，而不是主干的新组成部分：它复刻了一个被研究过的科研智能体平台的行为——那个平台的全部产品表面都是服务端拼装的 prompt——并把其中每条规则落到一个类型化扩展点上。[`packages/sci`](../../packages/sci) 下的每个包，要么是既有事件上的策略，要么是模型可见的工具，要么是存储投影，要么是把它们组合起来的 bundle；agent 循环没有改动。沙箱执行由 E2B seam 的 [`dormice`](../../packages/e2b/dormice) provider 承担。

其中四个包发布了服务，本页是它们词汇的归属地。

## `ctx.sciAudit` —— 审计投影

源码：[`packages/sci/sci-audit/src/index.ts`](../../packages/sci/sci-audit/src/index.ts)

只对 session log 做投影，从不读进程事件：它把 `tool/call`、`tool/result`、`tool-workflow/*` 记录、`turn/end`、`request/context`、`approval/decided` 以及各 `sci/*` 事件折叠进三张自有表（`sci_audit`、`sci_delivery`、`sci_plan`），并读取 `sci-skills` 与 `sci-memory` 各自拥有的表来做汇总。正因为唯一输入是日志，`rebuild` 才能从持久状态截断并重新投影任一会话——这使这份投影是缓存，而不是第二个真相源。`summarize` 按需计算每会话计数：没有「会话结束」事件可供挂靠。

行与报告契约（`AuditRecord`、`DeliveryRecord`、`PlanRecord`、`AuditSummary`、`RebuildReport`）记录在[包 README](../../packages/sci/sci-audit/README.zh.md)。

## `ctx.sciMemory` —— 记忆节点与召回

源码：[`packages/sci/sci-memory/src/index.ts`](../../packages/sci/sci-memory/src/index.ts)

观察落在记忆目录内、已被接受的 write 与 edit 工具调用，解析节点的 frontmatter，在节点未声明来源会话 id 时补写，并记录写入发生在第几轮。两个 RPC 操作服务于召回：`index` 每会话返回一行定位信息，`session` 把一个会话投影成剥掉工具流量、保留压缩点的干净对话。写入时序分布是一项**度量**而非门禁——被研究平台的「当场写记忆」规则带逃逸口，实测执行率为零，所以这一层选择把行为**可见化**，而不是假装换个更软的提醒就会奏效。

契约（`MemoryIndexRecord`、`RecallIndexValue`、`RecallSessionRequest`、`RecallSessionResult`）记录在[包 README](../../packages/sci/sci-memory/README.zh.md)。

## `ctx.sciRemoteHosts` —— 托管的 SSH 主机

源码：[`packages/sci/sci-remote-hosts/src/index.ts`](../../packages/sci/sci-remote-hosts/src/index.ts)

拥有沙箱 `~/.ssh/config` 里一个带定界符的块。保证是双向的：块内内容归本服务改写，块外每一个字节原样保留，因此用户自己的 `ProxyJump` 链与已注册主机共存。被关掉的主机在块内注释掉，而不是删除。私钥经凭据 seam 存取，从不进入任何事件载荷；进入配置文件的只有 `IdentityFile` 路径。

契约（`HostsListValue`、`HostsResult`、`UpsertHostRequest`、`RemoveHostRequest`、`ToggleHostRequest`）记录在[包 README](../../packages/sci/sci-remote-hosts/README.zh.md)。

## `ctx.sciTierFork` —— 升档

源码：[`packages/sci/sci-tier/src/fork.ts`](../../packages/sci/sci-tier/src/fork.ts)

均衡档不能扇出，所以当任务超出单遍能力时，智能体记录一条建议，由用户决定。用户接受后创建的是一个**基于集群 preset 的新会话**，而不是对旧会话做 fork：fork 会复制那段「智能体解释自己做不到」的对话，而这恰恰是新会话最不该继承的历史。新会话拿到的是源会话最后一条用户输入、已交付物的标题，以及那条陈述的理由。

契约（`SciTierForkRequest`、`SciTierForkResult`）记录在[包 README](../../packages/sci/sci-tier/README.zh.md)。

## 其余部分在哪

承担了大部分产品行为的门禁与工具都不发布服务：档位与扇出门禁在 [`sci-tier`](../../packages/sci/sci-tier)，路径与 manifest 所有权策略在 [`sci-workspace`](../../packages/sci/sci-workspace)，交付在 [`sci-deliver`](../../packages/sci/sci-deliver)，不可逆操作授权在 [`sci-guard`](../../packages/sci/sci-guard)，计划声明在 [`sci-plan`](../../packages/sci/sci-plan)，skill 目录及其沙箱同步在 [`sci-skills`](../../packages/sci/sci-skills)，prompt 章节在 [`sci-prompt`](../../packages/sci/sci-prompt)，manifest 校验在 [`sci-manifest`](../../packages/sci/sci-manifest)，组合本身在 [`sci-profile`](../../packages/sci/sci-profile)。每个包的 README 都写明它替代了被研究平台的哪个机制、改了什么。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

Source: [`packages/sci/sci-audit/src/index.ts`](../../packages/sci/sci-audit/src/index.ts)

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
