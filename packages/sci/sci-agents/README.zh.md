# sci-agents —— persona 名册、它的实时配置与委派日志

[English](README.md) | 中文

替代被研究平台的 *Agents* 页——那里的「训练新智能体」是一个按钮，底下压着一张没有任何东西真正执行的名册表（`ClawsGO-System/09-Target-Architecture/04-persistence-model.md`）。这里的 persona 不是表里的一行：它是一个**已挂载**的 `@deepseek-ai/dsh-tool-subagent` 实例，名字叫 `subagent_<persona>`，它的 charter 经 provider 抵达子代理，它的可用性、基座模型与工具作用域住在那个实例自己的 settings 段里。本包自身不持有任何状态：它读 `@deepseek-ai/dsh-sci-profile` 随包发布的 persona 文档、那些实例注册的 settings 段、`ctx.llm` 发布的模型目录、以及语料库保存的会话日志——它只写一样东西，就是委派工具下一次执行时会重新读取的那个 settings 段。

这也正是为什么没有「训练新智能体」这个端点：第七个 persona 需要第七行挂载，而挂载来自预设的 composition 文件，不来自一次点击。

## 配置

```yaml
- name: '@deepseek-ai/dsh-sci-agents'
  config:
    preset: sci-cluster
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `preset` | `sci-cluster` | 挂载六行 `subagent_<persona>` 的预设 id |
| `agentsRoot` | `dsh-sci-profile` 随包发布的目录 | persona charter 目录的绝对路径 |
| `webTools` | `web_search`、`web_fetch`、`literature_search` | `web` 开关关闭时禁用的工具名 |
| `codeTools` | `bash`、`write`、`edit`、`univer_execute` | `code` 开关关闭时禁用的工具名 |
| `libraryTools` | `library_add`、`citations_add` | `writeLibrary` 开关关闭时禁用的工具名 |

这三份工具清单是配置而非常量，理由和 `dsh-sci-audit` 的 `webToolNames` 一样：工具注册本身是一个 composition 选择，部署方随时可能改名或替换其中任何一个。`agentsRoot` 必须与 `dsh-sci-profile` 那一行保持一致，否则名册画出的卡片对应的 charter 并不是已挂载行真正携带的那份。

## 四个端点

`sci.agents.roster`、`configure`、`calls`、`models` 是 `sci.agents` 命名空间下的 Typert Remote 端点。

`roster()` 按 `PERSONA_NAMES` 顺序返回六个 persona。卡片文案——名称、一行角色、描述——来自每份文档的 `display` frontmatter 块；部署方自己的目录若没声明，则回退到 charter 自带的英文 `name` 与 `summary`。可用性、锁定的模型路由与三个权限开关来自 settings 段 `subagent-<persona>`；统计数字来自日志。

`configure({ persona, patch })` 把可用性、基座模型路由或三个权限开关写进同一个段。写入走的是按路径寻址的编辑而不是 merge patch，因为把权限全部打开意味着**删除**那份 deny 列表，而 merge 表达不了删除。

`calls({ persona, limit })` 从发起委派的那些会话日志里读出该 persona 的委派记录，最新在前。

`models()` 返回本部署可以把子代理路由过去的基座模型，读自 `ctx.llm`——也就是 `sessions.models` 为会话模型选择器服务的同一份目录——所以部署方新增的 provider 一注册就出现在这里。目录查询失败的 provider 会进 `failures`，而不是让整次读取失败。

### 先确保名册已被 composed

settings 段属于已挂载的 `tool-subagent` 行，而一个预设是由第一个加入它的会话在进程内挂载一次的。因此在任何会话存在之前打开的名册页会读到六个未注册的命名空间。`roster` 与 `configure` 会先调 `ctx.agentPresets.standingKeyFor(preset)`，它在不启动 agent、不建 session、不开 turn 的前提下确保那次常驻挂载。

部署 composition 没有为其挂载任何一行的 persona，报告为 `enabled: false`。两种成因——运维把它关了、composition 从来就没带它——在卡片上刻意不作区分，因为对一个人来说唯一可行动的事实就是：不会有委派抵达它。对这样的 persona 调 `configure` 则会明确报错并指出是哪个预设。

## 权限就是 deny 列表

三个开关本身不被存储，被存储的是 `toolFilter.deny`：因为那才是 `tool-subagent` 随每次启动请求发出、并由 `ctx.tools.restrict()` 在子代理创建时施加的清单——被禁的工具既从子代理的提示词里消失，也拒绝执行。存开关本身会造出第二份真相，而 composition 层的禁用可以在无声无息中与它矛盾。

| 开关 | 禁用 |
|---|---|
| `web` | `web_search`、`web_fetch`、`literature_search` |
| `code` | `bash`、`write`、`edit`、`univer_execute` |
| `writeLibrary` | `library_add`、`citations_add` |

只要某一组里**任意**一个工具被禁，该开关就读作 `false`，而不是要求整组都被禁：一个丢了 `web_search` 但保留 `web_fetch` 的子代理并不具备联网权限，把它报成已授予就是在描述一项它没有的能力。写入只触碰本映射拥有的那些名字，因此由别处写入的禁用会原样留存。

## 数字从哪里来

卡片上没有一个数字是估出来的。`monthCalls` 是自本月第一毫秒起、`kind` 为 `tool-call` 且 `toolName` 为该 persona 的 `sci_audit` 行数；没有 composed `sciAudit` 的部署则回退为统计同一次扫描刚读到的 `tool/call` 记录条数。

`durationMs` 是**子代理自己**的 turn 时长，用 `@deepseek-ai/dsh-subagent` 的 `subagentTiming` 投影在子日志上折叠得到——刻意不用父会话的 call→result 间隔，因为对 `continuable` 委派而言那是毫秒级的派发时间，而子代理要干上几分钟。一次调用与它的子代理靠两者共享的创建标签配对（`tool/call.arguments.description` 就是 descriptor 的 `label`），并被收窄到携带该 persona charter 的子代理；每个子代理只被认领一次，所以两次同标签的调用不会都去认领第一个。

`retrievalCalls` 与 `retrievalRepeats` 来自同一份子日志：对 `webTools` 里任一名字的每次调用，以及其中有多少次以相同参数文本重复了同一工具的更早一次调用。被研究平台的文献子代理对同一批论文搜了 29 次（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §5 第 9 行）；这个数是下界，因为对同一批结果换个措辞再搜不算重复。

`outputTokens` 与 `monthTokens` 只在结算携带了 `meta.usage.outputTokens` 时出现。本仓库目前没有任何东西附上这份 meta，所以这一列通常是缺席而不是零。

## 模型体验

无。本包不注册任何工具、提示词章节或会话事件：每个端点都由浏览器的智能体视图在用户手势下调用，而它唯一写出的东西——某个委派工具的 settings 段——只会在之后、作为那个工具在下一次委派时的可用性与工具作用域，间接抵达模型。

#### KV Cache 影响

直接影响没有，间接影响有一条值得写明。本包写出的任何东西都不进入提示词装配，所以它拥有的前缀不会移动。但一次改动了某 persona `toolFilter` 的 `configure` 写入，会改变**子代理**下一次委派时的工具目录，从而让那个子代理的前缀失效——绝不会影响父会话（它自己的目录没被动过），也不会追溯影响已经在跑的子代理。

## 已知限制与延后工作

- **不提供推理深度**：`AgentOptions`（`packages/core/agent/src/runtime-types.ts:24-31`）只带 `provider`、`model`、`maxTokens`，而 `agent-loop` 恰好只用这三项去播种子请求，`reasoningEffort` 仅从路由已经匹配的会话持久化 header 中恢复（`packages/core/agent-loop/src/agent.ts:437-455`）。存下来的深度值不会被任何人读到，因此 `roster` 与 `configure` 都不带该字段、`models` 也不声明 `reasoningEfforts`——配置页宁可不渲染深度选择器，也不渲染一个接不到任何东西的旋钮。见 Agent Note `2026-08-30-subagent-runtime-settings.md`。
- **每次读取都要扫全量语料**：`roster` 与 `calls` 会列出每个会话并读取每份日志，因为审计投影只记下「某个工具被调用过」，不记 `callId` 也不记调用参数，而子代理耗时住在子代理自己的日志里。开销与语料规模成线性且每次调用都要付；一个按工具名索引委派的投影可以消掉它，而那属于 `dsh-sci-audit` 而不是本包。
- **composition 层的部分禁用会表现为一个打不开的开关**：composition entry 的 `toolFilter.deny` 是 settings 层抬不起来的底线，所以一个只禁了组内某一个工具的预设，会让那个开关无论用户怎么拨都保持关闭。随包发布的六份 charter 都没有声明 `tools.deny`，因此这只在部署方自带预设时可达。
- **没有会话事件记录配置写入**：配置一个 persona 背后既没有 session 也没有 Agent，所以 `sci-audit` 无法展示某个 persona 是何时被关掉的；settings seam 自己的提交记录是唯一痕迹。
- **生成的 Remote 客户端尚未注册**：`pnpm run build` 会从 `./typert` 与 `./remote` 导出生成 `lib/typert.host.*` 和 `lib/typert.remote-client.*`，但把本包加进 `packages/api/remotes/src/client/index.ts` 属于 profile 装配拥有的跨包改动。
