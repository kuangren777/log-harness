# @deepseek-ai/dsh-client-ui-sci-agents

[English](README.md) | 中文

CaMeL Science 的智能体面：全屏「智能体」视图——profile 挂载的各个 persona 的名册、单个 persona 的配置、单个 persona 的调用日志——以及指向它的图标轨按钮。两条注册都落在本包并不拥有的两个座位上：ui-layout 的 keyed `view` 与 [sci 外壳](../ui-sci-shell/README.zh.md)的 `rail.item`，因此把本包从 cordis.yml 撤下时，视图与按钮一起消失，其他任何界面都保持原样。契约见[槽位系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

与线路打交道的只有 `src/client/index.ts` 一处，而且命名空间的整个生命周期都归它。`apply` 自己挂载宿主生成的 Remote 契约——`ctx.remote.$mount(agentsRemote)`，在任何注册之前 await——因为 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.zh.md) 是每个 profile 都要启动的基础组装，只属于科研侧的命名空间不该进那个包。挂载的 disposer 挂在本 fiber 的一个 effect 上，所以把这一行从 cordis.yml 撤下时命名空间随之消失。同理，`inject` 里有 `remote` 却**没有** `remote.sci.agents`：一个 fiber 注入它自己 apply 提供的服务就永远不会激活。因此命名空间用 `ctx.get('remote.sci.agents')` 读取，而不是 `ctx.remote['sci.agents']`：可追踪服务代理会把那次属性读取转发到同名的 context 属性，而 context 属性只对注入过它的 fiber 解析得出。

注入面把这些信封转成 `src/client/contract.ts` 声明的纯记录与完备结局，所以任何组件都见不到 RPC 错误。被拒绝的设置写入作为一个错误码抵达，万一命名空间没挂上则作为 `AGENTS_REMOTE_UNAVAILABLE` 抵达，没能拿到应答的调用作为 `AGENTS_REMOTE_FAILED` 抵达——三者都渲染为陈述出来的事实，而不是事件处理里的一次抛出。

屏幕上的每个数字都是宿主的。副标题数的是真正处于启用状态的 persona 个数，以及它们本月真实委派次数之和；卡片上的三格是该 persona 的本月调用、平均耗时与输出 token，宿主算不出平均耗时或 token 总量的 persona 就少画那一格，而不是显示一个它从未测量过的零。状态 pill 是关于日志的事实，不是猜测——加载过程会读每个 persona 的调用日志，所以「运行中」意味着确实有一次调用在飞；启用但没有在飞调用的读作「待命」，被设置关掉的读作「已停用」。

配置页只提供宿主真会认的东西——这也正是它不提供推理深度控件的原因。基座模型控件就是宿主的模型目录，每个 provider 一组分段控件，当前生效的那个处于按下态；读不出目录时就直说该智能体沿用会话模型，而不是给出一个空的选择。三个权限开关映射到宿主在 `ctx.tools.restrict` 时刻施加的 `toolFilter.deny`，启用开关则点名一个被停用的 persona 会拒绝哪个工具。这里没有保存按钮，因为没有东西需要保存：每次操作都立即写入，页面按宿主应答回来的 agent 重画，所以顶部用一个指示器陈述那次写入的状态——包括失败——而不是摆一个什么都不做的控件。

调用日志是回到研究流的通路，而不是只读报表：每一行可聚焦，除点击外也响应 Enter 与空格，并把整行的读法写进它的无障碍名称。激活一行会调用 `ctx.sessions.open(sessionId)` 并把框架切到对话视图，重新打开做出那次委派的会话。token 列仅当至少有一次结算携带了 usage 时才存在，因为一列破折号等于宣称宿主测量了它并没有测量的东西；仍在运行的调用写「进行中」，而不是编造一个耗时。

store 保存整个视图必须一致的那些事：当前页、它所关于的 persona、名册、已读到的日志、模型目录，以及上一次写入的状态——所以从研究流绕一圈回来看到的仍是同一份名册，而不是又一次加载；刷新也不会让读者丢失所在的位置。若某页所关于的 persona 已不在名册里，视图退回名册页，而不是画一个空框。样式一律走 token，写在 CSS Modules 里，因此每个界面都随主题明暗自适应；`CONVERSATION_VIEW` 是本包从 ui-layout 引入的唯一符号，以 `dsh.client.external` 声明为模块图请求。`/client` 的导出只有插件体（`apply`/`inject`）。

## Model Experience

None，本包是纯浏览器侧的配置面，Node 半边只是一个惰性 loader 座位：不注册任何工具、提示词段落或会话事件，它画出的每个事实都由 `sci-agents` 宿主包在 `tool-subagent` 的 settings 段落与 `sci_audit` 表之上算出——那些包各自拥有自己的 Model Experience。

#### KV Cache effect

None；本包既不组装也不发送任何模型请求。

## Known Limitations and Deferred Work

- **记录类型仍是镜像的，不是 import 来的。** `src/client/contract.ts` 复述了规格 §2.3 的名册／调用／目录词汇，`src/client/index.ts` 复述了其上的四个端点签名；因此宿主侧改名会以「卡片看起来不对」的形式抵达本包，而不是类型错误。挂载已经把生成的契约作为值 import 进来，其声明也随之进入本次编译，所以把两处镜像换成 `@deepseek-ai/dsh-sci-agents/types` 只是一次机械跟进，而非被卡住的事。
- **生成的契约连同 zod 一起被打进包里。** `lib/client.js` 内联了挂载所需的编解码器，与基础的 `dsh-api-remotes` 客户端产物同一形状、同一量级——那个包也内联了自己的一份。组合这一行的 profile 要多付一份该运行时的拷贝；要共享就得把线路编解码器做成模块表的一行，那是超出本包的决定。
- **没有推理深度控件，契约里也没有深度字段。** 规格 §3 曾勾画一个以模型目录是否声明 `reasoningEfforts` 为条件的三档选择器，而规格 §2.1/§5 已预先授权：若 `AgentOptions` 承载不了 effort 就整体不做。事实是承载不了：`AgentOptions` 只声明 `provider`、`model`、`maxTokens`（`packages/core/agent/src/runtime-types.ts:24-31`），而子循环只会从既有的会话头里恢复 `reasoningEffort`（`packages/core/agent-loop/src/agent.ts:437-455`）——新建的子智能体并没有那个头。真要打通得改两个 core 包并加上按路由的校验，因为 effort id 归适配器所有且不透明：`llm-deepseek` 给的是 `off`/`low`/`high`/`max`，规格里 `low|medium|high` 这个联合类型根本叫不出这些名字。因此 `sci-agents` 不把该字段放上线路，本包也不把它放进 `contract.ts` 与 UI，而不是摆一个写下去也到不了任何地方的控件。
- **检索列只在子会话日志可读时出现。** `retrievalCalls` / `retrievalRepeats` 来自 `@deepseek-ai/dsh-sci-agents` 扫描子会话的 web 调用；重复按逐字重发计，所以是冗余度的下界（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §5 第 9 行）。
- **模型目录只坏了一部分时，这里表现为列表变短，而不是一条警告。** `models()` 同时会返回目录查询失败的那些 provider，而本注入面丢掉了这一半：分段控件只列出应答成功的 provider，对没应答的只字不提。只有整个目录为空时才会给出明确的文案。逐 provider 地展示失败是设计稿没有画的控件，因此这里选择留待后续，而不是自行发明。
- **名册每次挂载只读一次，且没有推送。** 设置与审计行在宿主侧都会变——另一个标签页写了配置，或者某次委派在本视图打开期间结束——而没有任何东西会告知本视图。重新打开视图会重读全部内容；这里没有订阅，因为 `sci.agents` 命名空间不发布事件（规格 §2.3）。
- **每个 persona 的状态 pill 各要一次日志读取。** 加载过程为了判断是否有委派在飞，会对每个 persona 各调一次 `calls()`，因此六个 persona 的名册在打开时要发七次往返。名册载荷里加一个 `running` 计数就能把它们合并，但那是宿主侧的字段，本次发布不加。
- **三个权限开关是这里提供的全部工具控制。** 宿主的 `toolFilter` 接受任意 allow 与 deny 列表；本页只写规格点名的三组（联网、沙箱代码、写入知识库），无法表达按单个工具的例外。若某个 persona 在这三组之外用手写过滤器配置过，在这里只会以其 deny 列表所蕴含的那几个开关的形态出现。
- **token 总量取决于结算携带了什么。** `monthTokens` 与某一行的 `outputTokens` 仅当 usage 抵达了审计记录时才存在，所以那一格与那一列对某些 persona 出现、对另一些不出现；这种参差是宿主的测量结果，不是渲染选择，本视图如实陈述其缺席，而不是拿零去填。
- **这里的「月」是宿主的月。** 副标题与「本月调用」格数的都是宿主视为当前月的那一段，本视图既不提供时间范围选择，也不说明用的是哪个边界。
