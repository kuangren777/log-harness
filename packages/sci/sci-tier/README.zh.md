# sci-tier — 均衡 / 集群档位、它的提示词段，以及让档位成真的两道门禁

[English](README.md) | 中文

替代被研究平台的两条逐轮档位注入 —— 762 字节的均衡注入与 3.5 KB 的智能体集群注入（`ClawsGO-System/04-System-Prompts/verbatim/reminder-B-balanced-mode.txt` 与 `reminder-C-cluster-mode-2026-08-24.txt`，分析见 `ClawsGO-System/09-Target-Architecture/05-tier-model.md`）。在那里档位只是文字：十三个均衡会话零扇出，是因为模型服从，而不是因为它做不到；集群注入每一次请求都重新物化 3.5 KB，同时断言了本 harness 并不具备的运行时行为 —— 永不到达的完成通知、`TaskOutput` 轮询循环、`resumeFromRunId` 恢复。这里档位是 agent preset 的属性，它的文本是只组装一次的提示词段，并由两道门禁强制：集群档每次扇出消费一份已声明的计划，均衡档直接拒绝每一个扇出工具名。

## 表面

| 表面 | 位置 | Config |
|---|---|---|
| 档位段 `sci:tier:balanced` / `sci:tier:cluster` / `sci:tier:auto` | `ctx.systemPrompt.section()`，order `170` | `tier` |
| G1，先声明再扇出 | `tools/pre-execute`，集群档与自动档 | `fanoutTools` |
| G2，均衡档二道锁 | `ctx.tools.guard()` 加一次加载期拒绝，仅均衡档 | `fanoutTools` |
| G0，判定锁 | `tools/pre-execute` 加 `ctx.tools.guard()`，仅自动档 | `fanoutTools` |
| 工具 `suggest_tier_upgrade` | `./suggest`，只由均衡档 preset 挂载 | — |
| 工具 `resolve_tier` | `./resolve`，只由自动档 preset 挂载 | — |
| RPC `sci.tier.fork` | `./fork`，宿主平面 | — |
| 会话事件 `sci/tier-resolved` | 均衡/集群档在 `session/created` 时追加，自动档由 `resolve_tier` 追加（以最后一条为准），读端必需 | — |
| 会话事件 `sci/tier-upgrade-suggested`、`sci/tool-denied` | 由该工具与两道门禁追加，可忽略 | — |

本包提供三个可挂载模块，因为它们属于三个不同的位置。入口进入**两个**科研 preset；`./suggest` 只进 `sci-balanced`，在那里建议升档是模型唯一合法的出口；`./fork` 是 Service，因此属于宿主平面 —— 从入口发布服务会在第二个 preset 挂载的那一刻发生冲突。

## G1 · 先声明再扇出

一个 latch 是来自 `@deepseek-ai/dsh-sci-plan` 的一条 `sci/plan-declared` 记录，加上它是否已被扇出消费。权威副本存在本进程内，因为消费必须是**原子**的：同一条 assistant 消息里的两次 `workflow` 调用都会在任一结果进入日志之前到达 `tools/pre-execute`，靠重读日志判断的门禁会把两次都放行。`rebuildLatch` 是重放路径 —— 重启后它从最后一条声明以及其后的扇出 `tool/call` 恢复同一状态，并排除当前正在裁决的那次调用（agent loop 已经把它的 `tool/call` 写进了日志）。

在重建时，一次被拒绝的扇出也算消费掉了计划。这是安全方向：代价是多一次声明，而放行一次未授权的扇出代价是一整个蜂群。

## G2 · 均衡档二道锁

`ctx.tools.restrict()` 在这里不可用。它会把每个名字对照已挂载的 catalog 校验，遇到 preset 从未挂载的名字就抛错（`packages/core/tools/src/index.ts:1088`），而这恰恰是均衡档的处境：它并不挂载那些要被拦的名字。`ctx.tools.guard()` 只拒绝、不校验名字，在整条 `tools/pre-execute` waterfall 之后运行，且无法被某个 listener 强行放行，因此档位能在它所保护的组合中存活。

加载期检查是互补的另一半：本行挂载时 catalog 里**已经**存在的扇出工具是配置错误而非意外，`apply` 会带着它找到的名字抛错。

## G0 · 判定锁

`auto` 组合里扇出工具是挂着的，所以加载期拒绝和静态 guard 都不适用。改由 `tools/pre-execute` 监听器和一道 `ctx.tools.guard()` 同时读会话最新的 `sci/tier-resolved`——本进程按会话缓存，首次使用时从日志重建，以最后一条为准，因为升档会再追加一条。未判定时，每次扇出都以 `unresolved` 规则拒绝，出口是 `resolve_tier`；判定为 `balanced` 时以 `tier` 规则拒绝，出口是升档；判定为 `cluster` 后，调用就和集群档一样过 G1。`resolve_tier` 自己拒绝把集群会话降回均衡：蜂群的开销是用户预留的，已经开了蜂群的会话就在蜂群里做完。自动档会话创建时不追加 `sci/tier-resolved`——模型自己那次调用就是记录。

均衡档文本只给模型两条出口——真正做小的真实结果并写明范围，或 `suggest_tier_upgrade`——并点名封掉第三条：数字并非真实运行产出的「看起来很大」的结果。原平台的文本只在调研类任务上给了诚实出口，复现任务上模型造了空壳（分析 §3）。

## 升档 fork

刻意不使用 `ctx.sessions.fork()`：它会把源日志作为种子历史复制进子会话（`packages/core/session/src/index.ts:1091`），而把一份单线程记录重放进蜂群会话，等于让更宽的档位重读已经做完的工作。`sci.tier.fork` 改为创建一个空会话，在 header 的 `parentSession` 里记下源会话，并追加**一条**合成的用户消息，承载新档位需要的三件事：人类输入的最后一条请求、已交付的标题列表，以及上一个会话给出的升档理由。`sci/delivered` 按结构读取，不依赖 `@deepseek-ai/dsh-sci-deliver`，因此只挂档位而不挂交付层的部署同样能 fork。

## Model Experience

### 档位段 `sci:tier:balanced` / `sci:tier:cluster`

#### What the model sees

两段文本中恰好一段，order `170`，位于 `@deepseek-ai/dsh-sci-guard` 在 `165` 贡献的 *Irreversible actions* 章之后一格。两段都以用户所选档位的名字开头，用的正是选择器上显示的字样 —— `Solo mode (单体)` 或 `Swarm mode (蜂群)`。均衡档文本完全不点名任何扇出工具 —— 本档一个都不挂，点名模型看不见的工具只会教会它这些工具存在 —— 并以把超纲任务导向 `suggest_tier_upgrade` 结尾。集群档文本保留原注入六条纪律中的五条（拆解、编排、多角度交叉验证、就地引用、结构化综合），整条删掉第三条，因为 `notification never arrives`、`TaskOutput`、`resumeFromRunId` 描述的是本 harness 没有的运行时；真实语义在 `@deepseek-ai/dsh-sci-prompt` 的 *Runtime environment* 章。集群档文本把门禁写成门禁：一次声明授权一次扇出。

#### Token effect

均衡档约一百 token、集群档约三百 token，只在静态段块里出现一次 —— 此前是每一轮 762 B 或 3.5 KB。

#### KV Cache effect

前缀稳定：段总是在全部动态 context 之前组装，且两段文本在一个会话内从不变化，所以档位不产生任何重物化开销。

### Tool schema

#### What the model sees

仅在均衡档：生成的 [`suggest_tier_upgrade` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-tier)，一个必填 `reason` 字符串。描述明确写出这个工具**不**做什么 —— 它不改变当前会话，也不启动蜂群 —— 因为把「upgrade」读成一个动作的模型会调用它，然后等待永远不会到来的能力。

#### Token effect

工具可见的每次请求上有固定的 schema 开销；集群档不挂它，因此为零。

#### KV Cache effect

只要定义与可见性不变即前缀稳定。

### 扇出拒绝

#### What the model sees

被拒绝的调用读到 `Error: ` 加三句话之一，每一句都给出出路而不只是规则：`declare_research_plan has not been called in this session`，并要求先声明；`the declared plan was already consumed by an earlier fan-out`，并要求重新声明；以及在均衡档的 `this session runs in Solo mode, which has no subagent orchestration`，并指向 `suggest_tier_upgrade`。`sci/tier-resolved`、`sci/tool-denied`、`sci/tier-upgrade-suggested` 三条记录只进日志，从不进入模型历史。

#### Token effect

只在被拒绝的调用上，用两三句话占据工具结果的位置。

#### KV Cache effect

仅追加：两道门禁都在派发前裁决，拒绝占据工具结果本该占的位置，可复用的请求前缀不受影响。

## Known Limitations and Deferred Work

- **加载期 catalog 检查只看得到本行之前挂载的东西。** `apply` 在挂载时读 `ctx.tools.get()`，因此同一 preset 中**更靠后**的行加进来的扇出工具不会触发抛错。guard 让这一点无害 —— 无论工具何时到达它都会拒绝调用 —— 抛错存在的意义是覆盖那些在本行加载当刻就明显写错的组合。
- **invariant 伴生检查的是随仓库发布的扇出工具名，而不是已挂载的 `Config.fanoutTools`。** 伴生每进程只安装一次，读到的日志可能来自其他组合，因此它使用 `DEFAULT_FANOUT_TOOLS`。重命名了自己委派工具的部署仍然保有两道运行时门禁，而它们读的是该部署自己的配置。
- **`sci.tier.fork` 只 fork 存活会话。** 它读 `ctx.sessions.get()`，因此不在本进程内的会话会得到 `session-not-found`，而不是从存储加载。fork 已存储的会话需要 `@deepseek-ai/dsh-session-query`，还需要先决定「最后一条人类请求」在经过一次 compaction 之后意味着什么。
- **effort 维度本期推迟。** `reasoningEffort` 是 `@deepseek-ai/dsh-llm-deepseek` 的插件 `Config`（`packages/llm/llm-deepseek/src/index.ts:163`），没有 per-request 覆盖点，因此逐轮 effort 命令等于运行时改 Config。它需要 llm seam 新增请求字段，不在本包范围内。
