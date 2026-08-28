# sci-profile —— `dsh-sci` bundle、两个档位 preset、六份人格章程

[English](README.md) | 中文

取代所研究平台那套固定且没有名字的组合：在那里科研 agent 是一个部署、一套工具，两个档位靠每轮注入的 reminder 实现，六个人格只以散文形式存在于 Workflow 脚本里（`ClawsGO-System/09-Target-Architecture/05-tier-model.md`）。三处不同。档位是组合而不是请求——`sci-balanced` 根本不挂任何扇出工具，所以拒绝来自工具的缺席加一道 deny-only guard，而不是一句模型可以自己说服自己绕开的话。profile 由三个可以逐层 diff 的 patch 层拼成（`dsh-base`、`dsh-web-app`、`dsh-sci`），科研部署在共享 harness 上加了什么，就是这一个文件。人格是 `config/agents/` 里六份经过评审的文档，作为一段 prompt section 到达模型，而不是六段被反复抄进编排脚本的文字。

## 本包内容

| 产物 | 路径 | 消费者 |
|---|---|---|
| Bundle patch 层 | `cordis.patch.yml` | `dsh --profile sci`，作为 `dsh-base` + `dsh-web-app` 之上的第三层 |
| 均衡档 preset，界面显示 `单体 / Solo` | `config/agent-presets/sci-balanced/` | `dsh-agent-presets`，每进程挂一次，每会话按 scope 加入 |
| 集群档 preset，界面显示 `蜂群 / Swarm` | `config/agent-presets/sci-cluster/` | 同一名册 |
| 人格章程 | `config/agents/*.md` | 下面那个插件，汇成一段 system-prompt section |
| 人格名册插件 | `src/index.ts` | 只有 `sci-cluster` preset 挂它 |

`dsh-web-app` 是一层而不是一种替代：`storageDomain`、`session-query-sqlite` 和浏览器名册都在那里，而审计投影、memory 索引、升档按钮都需要它们。它同时已经把整个 agent plane 移到了 agent preset 后面——这正是本 profile 只剩下两个 preset 目录作为逐 agent 组合的原因。

## 两个平面的划分

判据沿用 web 层写下的那一条，patch 与两个 preset 里的每一行都照它走：被别的行解析的 Service、按 session 或 agent 键控的注册表、以及任何**注入**服务的行，属于 host plane；面向模型的工具、档位段、交付工具，是一个 agent 贡献的东西。

于是 `sci-prompt`、`sci-skills`、`sci-workspace`、`sci-guard`、`sci-credit`、`sci-memory`、`sci-audit`、`sci-remote-hosts`、`sci-tier/fork`、`office-univer` 在 `cordis.patch.yml` 里，而 `sci-tier`、`sci-tier/suggest`、`sci-plan`、`sci-deliver`、`office-univer/tools` 和委派工具在 preset 里，`camel-runtime`（架在 `ctx.e2b` 与 AgentENV 上的 `fork_workspace` 引擎）只在集群 preset 里。`office-univer` 在一个包内部沿用同一划分：host 行运行 Univer Gateway、发布 `univer` 服务、提供 Viewer，且 `tools: false`、`skills: false`——`univer_*` skills 属于受保护的内置层，由 skill vault 经 `sci-skills` 提供，包内自带的副本因此不发布——每个 preset 再在该服务之上挂 `@deepseek-ai/dsh-office-univer/tools`，并禁掉 `univer_screenshot` 与 `univer_lint`，因为 dsh 镜像不带 headless Chromium。`sci-tier/fork` 归 host plane 的理由与 subagent 注册表相同：包入口是一个**两个 preset 都挂**的函数插件，从那里发布服务会在第二个 preset 挂载的一刻撞名。`sci-credit` 归 host plane 是因为它为进程里每个 agent 计量同一条 `llm/stream` waterfall；它的 `vmToken` 没有默认值：没有 gate 的部署应当删掉那一行，而不是把 token 留空。

这一层还换掉了工作区目录选择器，理由与它把 `fs` 与 `subprocess` 搬走的理由相同：两个缝都在 Dormice 里之后，`-auto` 解析出的后端提供的宿主路径会变成一个「每条命令都失败」的会话 cwd。`directory-picker` 被禁用，插入 `@deepseek-ai/dsh-host-directory-picker-e2b` 与它的浏览器一侧 `@deepseek-ai/dsh-client-ui-directory-picker-browse` —— **两侧都要**，因为 patch 改不了一行的 `name`，而 `-auto` 自己会挂客户端界面。这与 `apps/web/tests/pin-browse-picker.overlay.yml` 是同一对「禁用 + 插入」。

preset 里的 service 行必须待在带 `isolate` realm 的 group 中，否则 `dsh-agent-presets` 在挂载时直接拒绝——这就是 `compaction` 与 `delegation` 两个 group 带 realm、而两个文件里再没有别的行发布服务的原因。

## 两个档位

`sci-balanced` 是默认档，因为蜂群是用户主动选择的算力，而不是默认得到的。它不挂任何扇出工具，其 `sci-tier` 行把扇出工具名列了两遍用途：`ctx.tools.guard()` 在调用时拒绝，同一份名单在**加载时**对已挂载的 catalog 做检查，于是「声明一个档位、却能执行另一个档位」的组合会抛错而不是照跑。`suggest_tier_upgrade` 是本档唯一合法出口，只挂在这里。

`sci-cluster` 增加 `declare_research_plan`、位于 entry-local `workflowEngine` realm 后的委派工具，以及人格名册。`declare_research_plan` 刻意不在它的 `fanoutTools` 里：它是令牌的**来源**，把它也门禁掉会让第一次声明无法发生。`tool-subagent-fork`、codex 与 claude-code 两个 provider、`tool-ralph` 的缺席出自档位政策而非平面归属——科研蜂群按已声明的计划扇出到全新的子 agent，而每多一个扇出工具名，latch 就多一条要覆盖的路径。

这两个就是本 profile 提供的全部 preset。patch 的 `agent-presets` 行把 `config/agent-presets/` 声明为名册唯一一个配置根，路径由 launcher 的 `dshBundlePath` 解析——只有能解析到本包的解析器才知道那个绝对路径；`@deepseek-ai/dsh-sci-profile` 把同一个目录导出为 `BUNDLED_PRESET_ROOT`。launcher 只对「一个根都没声明」的组合追加它自己随包发布的根（`apps/cli/src/profile-boot.ts::resolvePresetRootPatch`），于是 `dsh` 那四个通用 preset —— 它们组合的是本 profile 关掉的工具和它并不运行的沙箱 —— 不会出现在选择器里。`includeUserRoot` 留在默认值，所以 `$DSH_HOME/.agent-presets` 仍会被扫描，位置在这个根之后，trust 为 `user`。

## 人格

本 harness 没有从文件发现的 agent 定义，`@deepseek-ai/dsh-tool-subagent` 是**每挂载行**绑定一个 persona，而不是每次调用。因此人格是编排线程写子 prompt 时抄进去的东西，名册也就成了面向模型的文本而不是一份组合。`loadPersonas` 在加载时读 `config/agents/*.md`，拒绝任何不恰好等于 `@deepseek-ai/dsh-sci-plan` 声明的那六个名字的目录，并按 `PERSONA_NAMES` 顺序列出，使组装出的 section 在不同文件系统上逐字节一致。

`plotter` 与 `deliverer` 带排他章程——只有 `plotter` 走 sciplot 渲染路径，只有 `deliverer` 往交付区拷贝——另外四个从反面重申同一件事。这些是**指令而不是强制**：强制在于 `sci-workspace` 拒绝对平台所有字段的写入，以及 `sci-deliver` 无论提交方式如何都重跑校验。

## Model Experience

### Prompt section `Research personas`

#### What the model sees

一段 order 155 的 section，夹在 `Agent-cluster orchestration`（150）与 `Irreversible actions`（165）之间。开头是「把章程逐字抄进每个子 prompt」的指令，随后按 `### <name> (selected by the \`<icon>\` icon)` 或 `(no icon selects it)` 列出全部六个人格，每个后面跟一句摘要和完整章程。只有 `sci-cluster` preset 注册它：均衡档模型永远看不到，因为它无法启动这里描述的 agent。

#### Token effect

整份六人格名册约 700 token，每请求一次。对一个部署是固定值：章程是文件而不是会话状态的函数，成本不随对话增长。

#### KV Cache effect

前缀稳定。列表顺序取自 `PERSONA_NAMES` 而非目录顺序，同样六份文档在任何机器、任何一次启动都组装出同样的字节；改动章程或改指 `agentsRoot` 只在下一次请求失效一次前缀。

## Known Limitations and Deferred Work

- **手工种进 `$DSH_HOME/.agent-presets` 的同名 preset 会变成无声的死重量。** 该目录在声明的根之后被扫描，而发现逻辑按 id 取「第一个根胜出」，所以在那里种下的 `sci-balanced` 或 `sci-cluster` 会被遮蔽：选择器只列出一条、来自本包，对种下那份副本的改动毫无效果。没有任何东西会报告这次遮蔽——在名册声明自己的根之前种过这类副本的部署，应当把它们删掉。
- **人格是 prompt，不是组合。** 没有任何东西核实子 agent 真的按计划图标选中的章程运行：`declare_research_plan` 逐步记录人格，编排线程被信任去抄对应文本。把已声明的计划与实际跑起来的子 agent 对账，是 `@deepseek-ai/dsh-sci-audit` 的问题，不是本包的。
- **工作区选择器再也打不开宿主路径了。** 用沙箱后端替换 `directory-picker` 是有意的，但它是替换而不是新增：真心想打开运行 harness 那台容器上的目录的部署，没有任何一行提供这个能力，只能用第二个 id 重新插入一个宿主后端。profile 里没有任何东西会报告这个缺失。
- **两个 preset 重述共享行，而不是包含它们。** `dsh-agent-presets` 发现的是整个目录，所以 `sci-cluster` 把 `sci-balanced` 的每一行都重写了一遍。只改了一个、忘了另一个，只会被本包的组合测试抓住，loader 不会报。
