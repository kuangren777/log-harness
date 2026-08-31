# Agent Note：科研 profile 的调度门禁 —— 每个计划必带 adversary、任务判定档位、委派作用域

Status: implemented

[English](2026-08-30-sci-scheduling-gates.md) | 中文

## 问题

`clawsgo-analysis/CLAWSGO-SCHEDULING.md` 从调度角度读了被研究平台的 28 份 transcript，列出九条缺陷。对照 `packages/sci/` 逐条核查，三条已经由构造本身封住（转述授权 —— 被委派子会话的 `approval/policy` 钉死为 `never`；指针型 prompt 漂移 —— `sci-prompt` 的 reminder→章节 invariant；声明即授权 —— `sci-tier` 的 latch），其余是开着的。档位仍在任务未知时就被绑死：组合在 `balanced` 的会话遇到需要真实实验的任务，唯一出口是建议升档工具，而均衡档文本只对调研类任务给了这条出口 —— 正是原平台模型造出空壳复现并交付编造数字时的那个形状（§3）。`declare_research_plan` 接受只有生产者的计划，蜂群里从来没有一个节点被要求去推翻蜂群自己的产出（§2、§6.2）。引用与记忆两条 reminder 带着「若本轮不适用，忽略此 reminder」，正是原平台 transcript 里分别漂到 100% 违反与 0% 执行的那两条规则（§4.2）。被委派子会话的文件系统边界只是 prompt：`sci-workspace` 把兄弟项目、项目根、沙箱 home 下任何点目录都归为 `other` 并放行读取，原平台的环境检查 agent 就是这样引用了四个兄弟项目（§2.2、§6.3）。`sci-guard` 自己的测试里也没有一条证明授权性质在上一层成立。

## 决定

**计划必须包含一个证伪者。** `validatePlan` 在结构规则之外加一条组成规则：至少一个 agent 带 `VERIFIER_ICON`（`security`，即 `adversary` 人格）；当计划声明了 `PRODUCER_ICONS` agent（`code`、`check` —— 会留下代码、结果或交付文件的人格）时，必须有一条边从某个生产者指向某个 adversary，让核查跑在产物出现之后、跑在产物本身上。只读蜂群（`web`、`search`）配一个并行 adversary 即满足。归档的两 agent 安装调用现在被拒绝，测试里保留为被拒的形状，`AUDITED_INSTALL` 是被接受的形状。工具描述和集群档文本都写明这条规则，模型不必从一次拒绝里学。

**档位可以由任务判定。** `sci-tier` 的 `Config.tier` 增加第三个值 `auto`，并有第三个 preset `sci-auto`：挂好蜂群但先关着的集群组合。`./resolve` 挂载 `resolve_tier`，它追加带 `resolvedBy: 'model'` 和理由的 `sci/tier-resolved`；门禁读会话**最后一条**这样的记录（G0：首次调用前为 `unresolved`，判定为 `balanced` 后为 `tier`，之后与集群档一样过 G1），所以第二次调用能把均衡会话中途升为集群，而集群会话永远不会被降下来。自动档会话创建时不追加档位记录；invariant 改读最后一条而不是任意一条，升档后的会话可以扇出。`SciTierResolvedData` 增加可选的 `resolvedBy` 与 `reason`；固定组合的 payload 不变，已录制的 snapshot 仍然有效。默认 preset 仍是 `sci-balanced`。

**均衡档文本封掉第三条出口。** 对一遍过盖不住的任务 —— 现在在调研之外点名「真实实验或复现」—— 模型恰好有两条出口：一个真正做小、写明范围、数字来自本会话真实运行代码的结果，或 `suggest_tier_upgrade`；数字并非任何运行产出的「看起来很大」的结果被点名并拒绝。同一句话出现在 G2 的拒绝文本和建议工具的描述里，自动档文本也带着它，只是把升档作为第二条出口。

**两条 reminder 改成发送前自检。** 引用与记忆两条 reminder 去掉逃逸口，写成模型发送前要走一遍的检查，并写明空情况的结论（「无可链接/无可写，通过检查」）；记忆自检还拒绝把本会话没有真实事件支撑的内容写进记忆。文件规则保留逃逸口，因为 `sci-workspace` 无论如何都会强制它。

**被委派的会话按位置设界。** `sci-workspace` 新增规则 `delegation-scope`：`delegationDepth ≥ 1` 的会话触及沙箱 home 之内、自己项目（`header.cwd`）之外、又不属于共享区域（`skills`、`spool-pending`、`private`）的任何路径，一律拒绝。这条规则在查路径表之前对每个文件系统工具生效，`delegationScopeOperand` 把它施加到 shell 命令里每个像路径的操作数（`../p2/x`、`~/.claude/...`、`cd ..`）。沙箱 home 之外的路径（`/usr`、`/tmp`）交给沙箱自己的权限；顶层会话不受限。

**授权性质在 `sci-guard` 自己的测试里被断言。** 带 `approval/policy: never, source: delegation` 的被委派子会话撞上不可逆操作门禁时，不问任何应答者就被拒绝，并把 `sci/authorized` 记为 `denied`；顶层会话仍然到达应答者。

## 考虑过的替代方案

- **只在计划「声称承重产出」时要求 adversary。** 没有字段承载这个声称，让模型填的字段正是规则要绕开的生产者自述。统一规则每次扇出多一个 agent；生产者/边这半条让只读调研仍然便宜。
- **把 `auto` 做成在 `suggest_tier_upgrade` 时自动 fork 的均衡会话。** fork 会开新会话，界面得跟过去；会话内升档保住工作区、日志和对话。fork 保留给固定 preset。
- **把 `sci-auto`设为默认 preset。** 分析文档推荐任务驱动而非用户预绑，但蜂群的开销是产品选择；由部署翻 `agent-presets.default`。
- **在 `sci-agents` 里按工具组限制被委派的读取。** `permissions.ts` 收的是整个工具而不是路径；子会话要么留着读工具要么失去它。只有路径规则能把兄弟项目和子会话自己的项目分开。
- **把交付数字和执行轨迹关联起来的 provenance 投影（§5 第 4 行）。** 没做到数字粒度：得先定义「交付物里的一个数字」，今天没有任何东西承载它。改为在会话粒度度量 —— `sci-audit` 的摘要新增 `deliveriesWithoutExecution`，即任何 `execToolNames` 调用返回之前就做出的交付数 —— 强制 adversary 仍是拒绝伪造结果的那道线。

## 后果

- 只有生产者的蜂群在声明时就被拒绝；每次扇出都带一个 adversary，产出时还带一条指向它的边。`sci-plan` 的测试描述了拒绝和被接受的形状。
- `sci-auto` 与两个固定 preset 并列出货；`resolve_tier` 进入工具目录，profile 测试 harness 认识 `./resolve` 子路径。`SciDenialRule` 增加 `unresolved`；`sci-audit` 像其它规则一样分桶。
- `sci-workspace` 增加 `RULE_DELEGATION_SCOPE`、`isOutsideDelegationScope`、`sandboxHomeSegments`、`delegationScopeOperand`；门禁测试展示两类工具都对被委派会话拒绝兄弟项目、对顶层会话放行。
- 示例树增加 `auto.cordis.yml` 和两份无 key 快照：未判定时的拒绝，以及均衡判定后的拒绝、升档、再撞 latch。
- 分析文档剩下的三行改为度量而非门禁。`sci-audit` 的 `AuditFold` 让声明保持打开，此后每次 `subagent_<persona>` 调用与 workflow agent 启动都重发它的 `sci_plan` 行，带 `spawnedAgents`、`spawnedPersonasJson`、`reconciled`（`fewer` / `match` / `more`）；摘要计 `planMismatches`（§5 第 8 行）。`sci-agents` 把每个子会话的 web 检索次数与其中逐字重复的次数记到委派行的 `retrievalCalls` / `retrievalRepeats`，`ui-sci-agents` 在委派日志里以「检索」列展示（§5 第 9 行，是下界：换措辞的查询不算重复）。`sci-audit` 的摘要计 `deliveriesWithoutExecution`（§5 第 4 行）。各自的边界写在两个包的 Known Limitations。
