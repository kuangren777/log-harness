# Agent Note: Runtime settings for one mounted delegation tool

Status: proposed

[English](2026-08-30-subagent-runtime-settings.md) | 中文

## Problem

`tool-subagent` 只在 `apply()` 中解析一次 `Config`，并在该 fiber 的整个生命周期内闭包持有它。因此它携带的每一项子 agent 选择——子 agent 的模型路由、persona、工具过滤器，乃至这个工具是否存在——都是组装期常量：要改其中一项，就得编辑预设 `cordis.yml` 并重新加载部署。

一款把委派呈现为一份具名智能体名册的产品，需要其中三项选择在运行时随人的一次点击而变化，既不重新加载，也不在会话中途重新注册工具：停用某个智能体、把它指向另一个模型、收回它的某项能力。设置 seam 恰好服务于这一模式——`installSettingsSection` 把存储的 section 叠加在组装项之上，并交给消费方一个每次使用时重新读取的 thunk，正如 `web-search-deepseek` 每次检索所做的那样——但 `tool-subagent` 既没有注入 `settings`，也没有读取这样的 thunk。

剩下的问题是哪些选择该进入该 section，而答案并非“全部”：`provider`、`toolName`、`backgroundMode` 和 `enableRunInBackground` 是工具自身 schema 与提示词 section 已经向模型作出的承诺，而 `persona` 与 `maxDepth` 定义了一个名称不同的实例**是什么**。

## Proposal

`tool-subagent` 为每个已挂载实例注册一个设置命名空间，并在每次执行时重新读取它。

- 命名空间就是该工具自身名称的命名空间写法：默认名称对应 `subagent`，`subagent_researcher` 对应 `subagent-researcher`（`_` 替换为命名空间允许的 `-`）。配置界面无需注册表即可把模型调用的某个工具映射到治理它的 section，而 `subagentSettingsNamespace(toolName)` 被导出，使消费方永远不必自己拼写这套推导。
- `RuntimeConfig` 为 `{ enabled: boolean = true; model?: { provider; model }; toolFilter?: { allow?; deny? } }`，每个字段都有默认值，通过 `installSettingsSection` 注册，并把组装项投影为 `base` 层。既没有组装设置服务的部署，以及设置提供方已分离的部署，都会继续按该组装项运行：这项依赖在构造上就是软的，因为 `installSettingsSection` 把整个注册作用域收在 `ctx.inject(['settings'])` 之下，并在 dispose 时恢复组装项 thunk。插件自身的 `inject` 仍为 `['tools', 'subagents', 'systemPrompt']`——在那里写上 `settings` 会让没有设置服务的组装启动失败，与本意恰好相反。
- `enabled: false` 在执行器处拒绝：工具保持注册，而每一次调用都在读取父级或创建子 agent 之前抛出 `该智能体已停用，请在「智能体」页启用后再委派。`。改为把工具从目录中移除，会在会话中途改变模型的工具列表并使其前缀失效；一条模型能读取并转述的拒绝既更便宜，也更诚实。
- `model` 替换组装项 `agentOptions` 中的 `provider`/`model` 组合，并保留 `maxTokens`。两个字段必须同时给出，因为只有 provider 而没有 model 什么也选不出来。
- `toolFilter` 的合并是不对称的，而且是刻意如此：`deny` 是组装项列表与存储列表的**并集**，因此写进组装项的拒绝是任何存储 section 都无法解除的下限；而 `allow`——一份白名单——采用替换，因为求两份白名单的交集正是让子 agent 最终一个工具都没有的方式。合并后的过滤器仍走既有路径（`SubagentStartRequest.toolFilter` → 提供方 → `applyChildComposition` → `ctx.tools.restrict()`），因此执行点未变，存储的拒绝项既会从子 agent 的提示词中消失，也会拒绝执行。

### 不提供推理力度，以及提供它需要什么

规格要求一个 `reasoningEffort` 字段。它被省略了，因为在本工具与子 agent 模型请求之间的 seam 中，今天没有任何一环能携带它：

- `AgentOptions`（`packages/core/agent/src/runtime-types.ts:24-31`）只声明 `provider`、`model` 和 `maxTokens`。它在任何地方携带的唯一其他字段是 `subagentDepth`，由 `dsh-subagent` 通过声明合并添加（`packages/subagent/subagent/src/depth.ts:11-16`），并由该包自己的深度记账读取，而非由循环读取。
- 循环恰好只按那三项为子 agent 请求播种（`packages/core/agent-loop/src/agent.ts:437-455`）：路由取自 `this.options.provider`/`model`，`maxTokens` 取自 `this.options.maxTokens`，而 `reasoningEffort` **仅**从路由已匹配的会话的持久化 header 中恢复。新建子 agent 没有这样的 header，因此合并进 `AgentOptions.reasoningEffort` 的值不会被任何人读取。
- 唯一真正抵达请求的路径是 agent 作用域的，而非 options 作用域的：`sessions.selectModel` 通过 `ctx.llm.resolveCallConfig` 校验力度，并把它写入一个 `ModelSelectionRef`，由其 `agent/request` 瀑布监听器施加（`packages/host/apiproxy/src/api-proxy.ts:2390-2410`、`packages/core/agent/src/model-selection.ts:54-70`）。该监听器由创建方安装在活跃 agent 自己的上下文上——对子 agent 而言即进程内 subagent 驱动——而本工具既没有子 agent 的上下文，也没有进入其创建窗口的钩子。

因此真正的透传是一次跨两个包的改动：在 `AgentOptions` 上新增 `reasoningEffort?: ReasoningEffortId` 字段，加上在 `agent-loop` 的 `buildRequest` 中为其播种，并相应放宽 `packages/core/agent-loop/src/invariant.ts:44-50` 中的 header 匹配检查。在缺少这些的情况下发布该设置字段，等于交付一个没有接线的旋钮，因此该字段以及本应驱动它的 UI 选择器都被推迟。推迟的第二个理由：力度 id 由适配器拥有且不透明（`LlmReasoningEffortInfo.id`，按精确的模型路由给出），而 `llm-deepseek` 提供 `off`/`low`/`high`/`max`——固定的 `low | medium | high` 联合会命名一个该提供方没有对应 id 的档位。

## Alternatives considered

**把整个 `Config` 放进设置 section。** 一份 schema、一个命名空间，无需投影。否决：`toolName` 与 `backgroundMode` 已经烘焙进已注册工具的名称、描述和提示词 section，因此在运行时改动它们意味着重新注册工具，并在会话中途使父级前缀失效；`provider` 决定了哪个工具存在。一个大多数键都无法生效的 section，比一个更小但总能生效的 section 更糟。

**允许存储 section 解除组装项的拒绝（`deny` 采用直接替换）。** 与 `allow` 对称且更易解释。否决：组装项正是部署写下某个 persona 绝不能做什么的地方，而设置文档是最暴露于 UI 与存储文件的界面。一条只有组装项能下调的下限，能阻止较弱的界面扩大子 agent 的触及范围。

**在 `enabled: false` 时 dispose 工具注册。** 工具从目录中消失，这是最强的执行方式。否决：工具列表在会话中途变化，会使请求前缀失效，并让模型只能自行推断刚刚还在的工具为何不见了。执行器处的拒绝是在作出该决定的操作中执行，并且它会告诉模型发生了什么。

**用 `kind: 'disabled'` 成功结果代替抛出的拒绝。** 中文文案将不带注册表的 `Error: ` 前缀抵达模型。否决：拒绝不是一次完成的委派，而以 `isError: false` 返回它会诱使模型把它当作一个可以等待的、已启动的子 agent。

**现在就给 `AgentOptions` 加上 `reasoningEffort`，而不动 `agent-loop`。** 差异很小，且能让设置 schema 与规格一致。否决：不会有任何代码读取该字段，于是 UI 会为一个不起作用的值呈现一个看似可用的控件——这恰是省略它所要避免的失败。

## Acceptance criteria

- 存储的 `model` 会抵达**下一次**委派的 `SubagentStartRequest.agentOptions`，且组装项的 `maxTokens` 保持不变，工具不被重新注册（其 schema 数量仍为 1）。
- 存储的 `enabled: false` 会产生一个携带逐字固定文案的出错工具结果，且提供方不记录任何 start；重新启用后，在同一上下文中恢复委派。
- 组装项的 `deny` 与存储的 `deny` 会作为一份去重后的列表抵达；在真实 spawn 组装中，两个被拒绝的名称都不出现在子 agent 会话持久化的 `request/header` 工具列表中，而父级仍然公开它们。
- 没有设置服务的组装，以及设置提供方已 dispose 的组装，都会原样发送组装项的 `agentOptions`/`toolFilter`。
- `packages/subagent/tool-subagent/src` 保持 100% 逐文件覆盖率；`tsc -b tsconfig.host.json`、`oxlint` 和 `verify-export-jsdoc` 通过。

## Risks

- 在不具备 `toolFilter` 能力的提供方上，存储的 `toolFilter` 会让委派失败，而不是让挂载失败，因为该能力是在 `ctx.subagents.start()` 处检查的。组装期的键会在挂载时大声失败；存储的键做不到这一点，因为该 section 的寿命长于任何一次挂载。README 说明了每一种失败落在哪里。
- `restrict()` 在遇到未知工具名时抛出，因此存储的拒绝项若命名了子 agent 目录中从未挂载的工具，就会让那次委派失败。这是组装期过滤器的既有行为，如今可从设置文档触达——配置界面应提供可选名称，而非自由文本。
- 命名空间推导会在挂载时拒绝非小写 snake 或 kebab 写法的 `toolName`，而组装期的拼写错误正应在此处暴露。本仓库预设与示例中的每一个 `toolName` 都已经是小写 snake 写法。
- 两个共享同一 `toolName` 的实例现在会冲突两次：工具名冲突与命名空间冲突。命名空间冲突在 `apply()` 期间抛出，比既有的一次性实例重复名称的迟发现（`TODO(subagent-dup-toolname)`）更早、也更有解释力。
