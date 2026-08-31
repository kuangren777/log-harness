# sci-plan —— `sci` 档案的 `declare_research_plan` 工具、被校验的 agent DAG 与扇出授权

[English](README.md) | 中文

替代被研究平台的 `mcp__clawsgo__declare_workflow_plan` MCP 工具（`ClawsGO-System/02-MCP/clawsgo-server.md` §3）。参数 schema 逐字沿用，因为前端的进度卡片美术是按那五个图标取的。变了三件事。那里的计划照单全收 —— 重复的 agent id、指向从未声明过的 agent 的边、成环的依赖，都会照样画出卡片且毫无怨言；这里 `validatePlan` 一次把它们全部拒掉，并逐条点名出问题的 agent 下标、id 或边。那里计划只作为卡片存在于用户浏览器里，模型什么也读不回来；这里被接受的计划按运行顺序回显，模型承诺了什么就写在 transcript 里。那里「先声明再扇出」只是 system prompt 里的一句纪律；这里这次声明就是被记录的 `sci/plan-declared` 事件，由 `@deepseek-ai/dsh-sci-tier` 的 G1 门禁在下一次 `workflow` / `subagent` 调用时消费（`ClawsGO-System/09-Target-Architecture/05-tier-model.md`）。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| 工具 `declare_research_plan` | `ctx.tools.register()`，render intent `generic` | `maxAgents`（默认 `16`） |
| 会话事件 `sci/plan-declared` | 追加到发起声明的 agent 会话 | — |
| `ICON_PERSONA` | 普通导出，`sci-tier` 扇出时读取 | — |

## 一个计划要满足什么

`validatePlan(input)` 是纯函数，且一次报出全部违规 —— 因为一次被拒的调用必须足以让模型在下一次写对：

1. 每个文本字段都被 trim，边也按 trim 后的 id 匹配，前后空白因此永远不会变成悬空引用。
2. `id`、`name`、`task` 非空，id 唯一，且至少声明一个 agent。
3. 每条边恰好两个端点，不指向自己，两端都命名已声明的 agent。
4. 至少一个 agent 带 `security` 图标，于是每个蜂群里都有一个被要求去推翻其他人产出的 `adversary`；当计划声明了 `code` 或 `check` agent —— 会留下代码、结果或交付文件的那种 —— 必须有一条边从其中之一指向某个 adversary，让核查跑在产物上，而不是跑在生产者自己的陈述上。只读蜂群（只有 `web` 和 `search` agent）配一个并行的 adversary 即满足规则。被研究平台的伪造复现之所以能出厂，正因为它的 DAG 里全是生产者（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §3）。
5. 只有在不存在任何字段、引用或组成错误之后才做成环检查 —— 端点无法解析的图没有有意义的环可报 —— 成环时点名被困住的每一个 agent。

`topologicalSort` 是基于下标的 Kahn 排序：id 已由 `validatePlan` 解析完毕，所以它唯一的失败模式就是环。同时就绪的节点保持声明顺序，因此运行顺序可从日志复现；重复声明的依赖只计一次，而不会把目标节点永久堵死。

## 身份与扇出门禁

每次被接受的声明铸一个 `SciPlanId`（`Branded<'SciPlanId'>` 的 UUID）并追加 `sci/plan-declared`。该事件是 **required-on-read**，不带 `ignorable` 标记：跳过它的读端会放行部署本要拒绝的扇出 —— 进程重启后 `sci-tier` 正是靠重放日志重建那把闩。`./invariant` 在已提交的日志上断言对应关系：同一会话内没有两次声明共用一个 plan id，因为重复会把已经花掉的令牌再交给闩一次。

`maxAgents` 存在是因为一个部署真正跑得动的集群宽度取决于它的机器。超宽的计划在声明处就被拒 —— 那时模型还有这一轮可以收窄 —— 而不是先收下再有一半跑不起来。

## 图标与人格

`ICON_PERSONA` 把五个卡片图标各映射到 `sci` preset 安装的六个子 agent 人格之一：`web` → `researcher`、`search` → `scout`、`security` → `adversary`、`code` → `writer`、`check` → `deliverer`。在被研究平台上图标只是装饰，跑哪个人格是稍后由 Workflow 脚本里的散文决定的；这里用户看到的卡片与实际运行的 agent 定义是同一个选择，在声明时一次做完。

## Model Experience

### Tool schema

#### What the model sees

模型看到生成的 [`declare_research_plan` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-plan)：`agents[]` 每项 `{ id, name, icon, task }`，其中 `icon` 枚举 `web | search | security | code | check`；以及可选的 `edges[]`，每项是 `[from, to]` 二元组。描述里写明每个图标选中的人格，并声明门禁强制的那条义务 —— 一次声明授权一次扇出 —— 因为只能从被拒的 `workflow` 调用里学到这件事的模型已经白丢了一轮。

#### Token effect

工具可见时，每次请求付固定的 schema 开销。

#### KV Cache effect

定义与可见性不变时前缀稳定；`maxAgents` 不出现在描述里，所以收窄它不会让前缀失效。

### Tool-call history and result

#### What the model sees

被接受的调用返回一行摘要、按运行顺序排列的 agent（各带其图标选中的人格），以及以文本画出的依赖图（`installer → verifier`）。被拒的调用一次返回全部问题，每条点名引发它的 agent 下标、id 或边。调用渲染为 `generic` 卡片，标题带上声明的 agent 数量。`sci/plan-declared` 是仅日志事件，不进入模型历史。

#### Token effect

结果与计划规模成正比：大致每个声明的 agent 一行，外加每个被别人等待的 agent 一行。十六个 agent 的计划一次花掉几百 token。

#### KV Cache effect

只追加；一次声明只增加一次工具调用及其结果，不扰动此前任何前缀。

## Known Limitations and Deferred Work

- **声明不等于强制。** 本包只记录授权；消费它的 G1 门禁在 `@deepseek-ai/dsh-sci-tier`，这里没有任何东西会拒绝扇出。只挂 `sci-plan` 而不挂 `sci-tier` 的档案，得到的是「计划被校验、被记录」加「扇出不受约束」。
- **本包只声明，不对账。** 计划是模型宣布的意图，不是集群的记录。与真正启动的 agent 的比对住在 `@deepseek-ai/dsh-sci-audit` 的 `sci_plan` 行（`spawnedAgents`、`spawnedPersonasJson`、`reconciled`）和它的 `planMismatches` 摘要数字里；这里没有任何东西会拒绝一次名册偏离声明的扇出。
- **`plotter` 从任何图标都到不了。** 绘图工作在卡片这一层不可区分 —— 对盯着计划看的用户来说，绘图步骤读起来就是 `code` —— 所以第六个人格只能由编排线程从 agent 的 `task` 文本里选出。加第六个图标会改动前端取美术资源的 schema。
- **摘要行数的是声明的依赖数，不是去重后的数量。** 重复声明的一对只画一次，但在头行里计两次，因为这个数描述的是模型写了什么。
