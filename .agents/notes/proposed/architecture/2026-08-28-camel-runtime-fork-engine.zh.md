# Agent Note：camel-runtime —— 放在工作区旁边、而非取代工作区的 fork 引擎

状态：proposed

[English](2026-08-28-camel-runtime-fork-engine.md) | 中文

## 问题

`sci` 档案的集群档把工作扇出给子智能体，但所有子智能体共用同一个 Dormice 沙箱：一套文件系统、一组运行中的进程。参数扫描、或几个都要改动工作区的竞争假设，在那里无法并行而不互相踩踏；一次有风险的变换也无法在不手工复制整个工作区的前提下先试一试。

在生产主机上做的同机对照（`ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md`，2026-08-28）表明：AgentENV 的 Firecracker microVM 约 1.4 s 完成快照、约 80 ms 恢复出一个连内存、进程、文件都完整的 fork —— gVisor 没有这个能力；而 Dormice 仍是长命工作区更好的归属：按名幂等获取、闲置内存低 3 倍、磁盘上没有内存镜像、生命周期永不删除。用一个取代另一个，等于拿工作区的持久性去换一个计算特性，还得让网关自己重建 AgentENV 没有的 name→sandbox 映射。

## 提案

新增 `@deepseek-ai/dsh-camel-runtime`（`packages/sci/camel-runtime/`），一个 `ctx.e2b` 与 `ctx.tools` 的 Consumer，把 AgentENV 严格当成计算引擎：

- 工作区留在 Dormice。引擎每次调用导出一次（`tar` 走命令通道，受 `maxWorkspaceBytes` 约束），从配置的 AgentENV 模板播种一台 microVM，快照，再从快照为每个变体恢复一台 microVM。
- 结果单向回流。每个变体的 stdout、stderr、退出码与可选的收集目录写进真实工作区的 `<forksDir>/<forkId>/<variant>/`。变体做的其他一切都不留存；所有 microVM 与快照在 `finally` 里删除。
- 模型只看到一个工具 `fork_workspace`，且只挂在 `sci-cluster` preset。拒绝（变体数、名字形状、重名、爬出工作区的 `collect`）发生在执行器里；非零退出是结果而非失败，所以一个变体坏了的扫描仍会报出其余变体。
- 一个事件 `sci/fork-completed`，`ignorable: true`；包不变量断言同一会话内 fork id 不重复，因为它就是结果目录的名字。
- AgentENV 密钥从集群进程的 `apiKey` 或 `AENV_API_KEY` 读取，绝不转发进任何一侧沙箱，与 Dormice provider 的 never-forward 规则一致。

## 备选方案

- **把工作区迁到 AgentENV。** A2 已否：重做部署链与网关映射要 1–2 周，生产主机上要跑挂了 `/dev` 的特权容器，多约 600 MiB 常驻内存，还多一套持久化模型 —— 换来的延迟收益模型驱动的会话根本感知不到。
- **在 Dormice 里用 `docker commit` 分叉。** 只能抓文件系统层，抓不到进程与内存，Dormice 的 API 也没有暴露这种操作。
- **在 AgentENV 保留每用户热快照。** 能省掉导出导入，但它就是工作区的第二份持久副本；推迟到有实测需求再说。

## 验收标准

- `sci-cluster` preset 里的 `fork_workspace` 从 Dormice 工作区的一份 AgentENV 快照跑 N 个变体，并把 `stdout.txt`、`stderr.txt`、`exit-code` 与收集目录写到 `<forksDir>/<forkId>/<variant>/`；均衡 preset 没有这个工具。
- 无论 fork 成功，还是在导出、播种、快照或某个变体的传输上失败，所有 microVM 与快照都会被删除；删除失败绝不掩盖 fork 自身的错误。
- 拒绝 —— 无变体、超 `maxVariants`、名字不合法或重复、命令为空、预算超出 `[1, maxCommandTimeoutSeconds]`、`collect` 爬出工作区 —— 都发生在工具执行器里，并点名违反的规则。
- AgentENV 密钥不出现在任何一侧沙箱的任何命令环境里。
- 包测试每文件 100 % 覆盖；在生产 AgentENV 上跑一次真实 fork，两个变体收集结果不同、工作区未变。

## 风险

- **工作区体积。** 归档以 base64 走命令通道，两端都在内存里缓存；`maxWorkspaceBytes`（默认 64 MiB）是护栏，数据量大的工作区在换成流式传输之前需要 `exclude`。
- **生产主机上的特权 sidecar。** `aenv-server` 以 `--privileged` 挂载 `/dev` 运行，只绑回环；它的 API key 放在集群进程环境里。集群进程被攻破暴露的是引擎，不是工作区 daemon 的 token。
- **模板漂移。** AgentENV 模板必须与 Dormice 镜像带同一套工具链，否则变体会因为模型在工作区里看不到的原因失败；部署把两者钉在同一个 `sci-sandbox` tag。
- **硬崩溃留下孤儿 microVM。** harness 进程被杀会跳过 `finally`；AgentENV 自己的 TTL（`sandboxTimeoutSeconds`，默认 30 分钟）是兜底。

## 后果

- `fork_workspace` 是集群档唯一的隔离并行**改动**原语；子智能体仍是对同一工作区并行**阅读**与**推理**的原语。
- 部署多一个 sidecar（`aenv-server`，仅回环）和每台集群 VM 一个环境变量。均衡档不变。
- 包测试覆盖客户端、传输、引擎生命周期（含每条失败路径上的清理）、工具文案、Loader 组合与不变量，100 %；真实路径在生产 AgentENV 上以两个写不同文件的变体跑过一次。
