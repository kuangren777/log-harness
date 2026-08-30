# Agent Note：名册就是那六行已挂载的委派工具，而不是它们旁边的一张表

Status: proposed

[English](2026-08-31-sci-agents.md) | 中文

## Problem

`sci` profile 现在挂载了六行 `@deepseek-ai/dsh-tool-subagent`，一个 persona 一行，每一行都带着一个人可以在两次委派之间重新调整的 settings 段。但目前没有任何东西让人看到或触碰这六个段：`ctx.settings.describe()` 返回的是叫 `subagent-researcher` … `subagent-deliverer` 的命名空间，背后没有 charter、没有展示文案、也没有用量，而浏览器的「智能体」视图三样都要。

被研究的平台用一张名册表加一个 *Agents* 页回答了同一个需求，表里的行可编辑，「训练新智能体」按钮再造更多行（`ClawsGO-System/09-Target-Architecture/04-persistence-model.md`）。那张表是第二份真相：一行可以声称某个 agent 存在、已启用、有模型，而运行中的系统委派的完全是另一回事——委派路径上没有任何东西读那张表。

所以问题不是「名册存在哪」，而是「一个页面如何展示、并改变那些对运行中的系统已经为真的事实」——而且是四类事实、四个不同的所有者：charter（一份包资源）、配置（一个 settings 段）、模型目录（`ctx.llm`）、用量（会话日志及其审计投影）。

## Proposal

`packages/sci/sci-agents` 是压在这四个所有者之上的一层以读为主的投影，发布 `ctx.sciAgents` 和 `sci.agents` 命名空间下的四个 Typert Remote 端点。它不拥有任何表、任何会话事件、任何缓存；它做的唯一一次写入，落到某个委派工具本来就会在每次执行时重读的那个 settings 段。

```ts ignore-check
roster(): { agents: RosterAgent[] }
configure({ persona, patch }): { agent: RosterAgent }
calls({ persona, limit }): { calls: AgentCall[] }
models(): { providers: ModelProvider[]; failures: ModelCatalogFailure[] }
```

- **身份是 persona id，工具名由它派生**：`subagentToolName(persona)`（`@deepseek-ai/dsh-sci-tier`）是 G1 latch、名册提示词、settings 命名空间与本服务共同走的唯一派生，因此一张卡片、一道门禁、一个存储段不可能对「某个 persona 是哪个工具」产生分歧。
- **卡片文案搬进 persona 文档**：`SciPersona` 增加可选的 `display` 块（`name`、`role`、`description`），由读 charter 的同一个解析器读取，于是面向模型的英文与面向人的中文作为同一个文件被评审和翻译。没有声明的文档回退到 `name`/`summary`，而 `personas.spec.ts` 断言**随包发布**的那棵树永远不会走到这条回退上。
- **权限就是 deny 列表**：三个开关不被存在任何地方；它们由 `toolFilter.deny` 算出、也写回 `toolFilter.deny`——那是 `ctx.tools.restrict()` 在子代理创建时施加的清单。只要组内任意一个工具被禁，开关就读作关闭，这是对一个被部分收窄的子代理的诚实读法。
- **读 settings 之前先确保预设已挂载**：`ctx.agentPresets.standingKeyFor(preset)` 在不启动 agent、不建 session、不开 turn 的前提下挂起预设的常驻 composition，这正是页面在没有任何会话打开时也能给出正确答案的原因。
- **`models()` 消费 `ctx.llm`，而不是自建目录**：那是 `sessions.models` 构建会话模型选择器所用的同一份目录，所以部署方注册的 provider 立刻在这里可选，查询失败的 provider 被如实报出而不是让整次调用失败。
- **`durationMs` 是子代理的，且由子代理自己的投影折出**：`subagentTimingProjectionDefinition` 被直接施加在子日志上而不是另行推导，父会话的 call→result 间隔刻意从不使用。

## Alternatives considered

**把名册存进一张 `sci_agents` 表**：一次读取，无需扫描，统计还能边发生边累加。否决：这就是被研究平台失效模式的重述。每一行都是一句委派路径上没有任何东西去校验的声明，而第一次漂移——某个预设不再挂载某个 persona、某个 settings 段被手改过——恰恰会在那个本该报告它的页面上不可见。

**让 `configure` 就按开关存开关，委派时再翻译成 `toolFilter`**：存储文档会长得和 UI 一样。否决：那样 `tool-subagent` 就得知道「权限分组」，而那是 `sci` 的产品概念；而且 composition 层的 `toolFilter.deny` 与存下来的开关可以互相矛盾，且没有定义谁赢。存被执行的那份清单，才只有一份真相。

**对 composition 没有挂载的 persona 报 `enabled: true`**：卡片显示的是该 persona 的默认状态而不是它实际所处的状态。否决：没有委派能抵达一个未挂载的工具，所以 `true` 就是假的。「不会有工作抵达这里」的两种成因在卡片上不作区分，是因为对一个人来说两者都无法区别对待；`configure` 区分它们，因为在那里这个差别决定了写入是否可能。

**在 `sci_audit` 里给委派建索引，让名册不必扫描**：审计投影本来就折叠 `tool/call`，给行里加上 `callId` 与调用的 `description` 就能把 `calls()` 变成一次表读取。目前否决，但仅仅是「目前」：它是对另一个包拥有的投影和一份存储 schema 的改动，要对既有日志生效还需要一次 `rebuild`，而名册的开销与语料规模成线性，科研部署的语料本来就小。README 把这份开销写成延后工作而不是把它藏起来。

**把 `reasoningEffort` 加进名册与 patch**：规格要求一个三档深度选择器。基于证据否决：`AgentOptions` 只带 `provider`/`model`/`maxTokens`（`packages/core/agent/src/runtime-types.ts:24-31`），而 `agent-loop` 恰好只用这三项播种子请求，`reasoningEffort` 仅从路由已经匹配的持久化 header 中恢复（`packages/core/agent-loop/src/agent.ts:437-455`）。存下来的深度值不会被任何人读到，所以 `RosterAgent` 与 `AgentPatch` 都没有该字段，`models()` 也不声明 `reasoningEfforts`——正是后者让配置页根本不会渲染那个选择器。完整证据在 `2026-08-30-subagent-runtime-settings.md`。

## Acceptance criteria

- `roster()` 按 `PERSONA_NAMES` 顺序返回六行，`toolName` 为 `subagentToolName(persona)`，卡片文案取自随包发布文档的 `display` 块，且不回退到英文。
- 一次 `{ permissions: { web: false } }` 的 `configure` 写入之后，`ctx.settings.get('subagent-<persona>')` 携带含三个 web 工具名的 `toolFilter.deny`，且该工具的下一次委派把它们送进 `ctx.tools.restrict()`。
- 把权限全部打开会从 user 层移除 `toolFilter.deny`，同时保留不属于本映射的那些禁用。
- 在没有任何会话打开时，`roster()` 与 `configure()` 都成功，且已确保预设的常驻挂载。
- `monthCalls` 等于该工具名本月 `sci_audit` `tool-call` 行数，`avgDurationMs` 等于被配对子代理自身 turn 时长的均值；两个可选值在无人报告时是缺席而不是零。
- `models()` 丢弃一个什么都不广告的 provider，并报出查询抛错的 provider，且整体不失败。
- `packages/sci/sci-agents/src` 保持逐文件 100% 覆盖；`tsc -b tsconfig.host.json`、`oxlint` 与 doc-sync 门禁全绿。

## Risks

- **每次名册与日志读取都要扫全量会话语料**：先 `listSessions()`，再对每个会话 `readSession()`，名册的六个 persona 还要各走一遍。语料大的部署会有体感；缓解手段就是上面那条延后的审计索引，而且这次读取是一个人的手势，不在任何模型的路径上。
- **调用与子代理靠创建标签配对**：同一会话里对同一 persona 发出的两次 `description` 文本完全相同的委派是有歧义的；它们按日志顺序被依次认领，这在平均意义上正确，但当两个子代理耗时差异很大时，单行就是错的。charter 收窄能防止兄弟 persona 借出自己的耗时，但没有任何东西能区分两个完全相同的标签。
- **`agentsRoot` 被配置了两次**：本包与 `dsh-sci-profile` 各持一份，改了一边没改另一边的部署，画出的卡片对应的 charter 并非已挂载行携带的那份。挂载时会急切地读那棵树，所以「不是完整名册」的目录会在加载期失败而不是在第一次读取时失败——但两棵**各自合法**却互不相同的树，在这里检测不出来。
- **服务对 `sciAudit` 是可选读取并静默回退**：composed 了名册却没 composed 审计投影的部署，拿到的 `monthCalls` 是从日志推出的，它排除了语料库已无法服务其日志的那些会话。两个数字可以不同，而卡片并不说明自己展示的是哪一个。
