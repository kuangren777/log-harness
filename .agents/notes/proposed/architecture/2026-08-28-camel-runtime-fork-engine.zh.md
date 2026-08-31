# Agent Note：camel-runtime —— 放在工作区旁边、而非取代工作区的常驻项目变体

状态：proposed

[English](2026-08-28-camel-runtime-fork-engine.md) | 中文

## 问题

`sci` 档案的集群档把工作扇出给子智能体，但所有子智能体共用同一个 Dormice 沙箱：一套文件系统、一组运行中的进程。参数扫描、或几个都要改动工作区的竞争假设，在那里无法并行而不互相踩踏；一次有风险的变换也无法在不手工复制整个工作区的前提下先试一试。

在生产主机上做的同机对照（`ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md`，2026-08-28）表明：AgentENV 的 Firecracker microVM 约 1.4 s 完成快照、约 80 ms 恢复出一个连内存、进程、文件都完整的 fork —— gVisor 没有这个能力；而 Dormice 仍是长命工作区更好的归属：按名幂等获取、闲置内存低 3 倍、磁盘上没有内存镜像、生命周期永不删除。用一个取代另一个，等于拿工作区的持久性去换一个计算特性，还得让网关自己重建 AgentENV 没有的 name→sandbox 映射。

## 提案

新增 `@deepseek-ai/dsh-camel-runtime`（`packages/sci/camel-runtime/`），一个 `ctx.e2b` 与 `ctx.tools` 的 Consumer，把 AgentENV 严格当成**常驻变体**的计算引擎：

- 一个变体就是一个命名槽位，里面是一台 AgentENV microVM，装着 Dormice 工作区里**一个项目目录**的副本，而不是整个工作区。`create_variant` 把项目归档（`tar` 走命令通道，受 `maxProjectBytes` 约束）进从配置模板起的 microVM；带 `from` 时改为快照一个兄弟变体并从该快照恢复（文件、进程、内存）。
- 槽位按工作区受 `maxVariants` 约束，这是随套餐变化的数字，部署通过 `AENV_MAX_VARIANTS` 按 VM 设置；满了的工作区会被告知先 `delete_variant` 再建。槽位表是工作区里的 `<variantsDir>/registry.json`，新 harness 进程能找到上一个留下的变体，损坏的表会被拒绝而不是当成空表。
- 变体闲置时暂停（AgentENV 自己的 TTL + `autoPause`），下一次 `run_in_variant` 或 `collect_variant` 通过 `POST /sandboxes/{id}/connect` 恢复；`list_variants` 报 `running`、`paused` 或 `missing`。
- 结果单向回流：`collect_variant` 把项目相对目录拷到 `<variantsDir>/<name>/collect/`；真实项目文件从不被变体写。`delete_variant` 杀掉 microVM、删掉分叉的快照、释放槽位。
- 五个工具，只挂在 `sci-cluster` preset；所有拒绝（名字形状、重名、上限、项目缺失、路径爬出项目、沙箱已消失）都发生在执行器里并点名规则与补救。三个 ignorable 事件 `sci/variant-created` / `sci/variant-run` / `sci/variant-deleted`；包不变量断言同一槽位名不会在没有删除的情况下被创建两次。
- AgentENV 密钥从集群进程的 `apiKey` 或 `AENV_API_KEY` 读取，绝不转发进任何一侧沙箱，与 Dormice provider 的 never-forward 规则一致。

## 备选方案

- **把工作区迁到 AgentENV。** A2 已否：重做部署链与网关映射要 1–2 周，生产主机上要跑挂了 `/dev` 的特权容器，多约 600 MiB 常驻内存，还多一套持久化模型 —— 换来的延迟收益模型驱动的会话根本感知不到。
- **在 Dormice 里用 `docker commit` 分叉。** 只能抓文件系统层，抓不到进程与内存，Dormice 的 API 也没有暴露这种操作。
- **在 AgentENV 保留每用户热快照。** 能省掉导出导入，但它就是工作区的第二份持久副本；推迟到有实测需求再说。
- **一次性 fork（`fork_workspace`：导出、快照、N 个变体、收集、全部删除）。** 先做出来并验证过，然后被替换：一次性的东西模型无法查看、延续或再分叉，而且它复制整个工作区，多项目的用户每次调用都为全部项目买单。带显式上限的常驻槽位才是产品要的："开太多了就删一个再建一个"。

## 验收标准

- 在 `sci-cluster` preset 里，`create_variant` 把一个项目目录复制进一台新的 AgentENV microVM（或用 `from` 分叉兄弟），`run_in_variant` 恢复它并在项目目录下运行，`collect_variant` 把项目相对目录拷到 `<variantsDir>/<name>/collect/`，`delete_variant` 杀掉 microVM 并释放槽位，`list_variants` 报 `running` / `paused` / `missing`；均衡 preset 没有这些。
- `maxVariants` 上限在引擎里、注册表锁下执行：第 N+1 次 `create_variant` 被拒并点名在用槽位与 `delete_variant`；删一个之后同一调用成功。
- 播种失败（导入出错）会杀掉新 microVM 且不记录；分叉失败会删掉它的快照；不是 version-1 表的注册表文件被拒绝，绝不当成空表。
- 拒绝 —— 名字不合法或已占用、`project` 是工作区本身、项目在工作区外或不存在、命令为空、预算超出 `[1, maxCommandTimeoutSeconds]`、收集路径爬出项目、未知槽位、沙箱已被 AgentENV 遗忘 —— 都发生在工具执行器里，并点名规则与补救。
- AgentENV 密钥不出现在任何一侧沙箱的任何命令环境里。
- 包测试每文件 100 % 覆盖，Loader 组合测试对本地 AgentENV 驱动 创建 → 撞上限被拒 → 删除 → 创建 → 运行 → 收集 → 列表 全流程，并在生产 AgentENV 上用真实项目跑一遍同样的路径。

## 风险

- **工作区体积。** 归档以 base64 走命令通道，两端都在内存里缓存；`maxWorkspaceBytes`（默认 64 MiB）是护栏，数据量大的工作区在换成流式传输之前需要 `exclude`。
- **生产主机上的特权 sidecar。** `aenv-server` 以 `--privileged` 挂载 `/dev` 运行，只绑回环；它的 API key 放在集群进程环境里。集群进程被攻破暴露的是引擎，不是工作区 daemon 的 token。
- **模板漂移。** AgentENV 模板必须与 Dormice 镜像带同一套工具链，否则变体会因为模型在工作区里看不到的原因失败；部署把两者钉在同一个 `sci-sandbox` tag。
- **孤儿 microVM。** 注册表条目丢失（工作区从旧副本恢复）会留下 AgentENV 永久保留的暂停 microVM；在出现对账流程之前，宿主上的 `aenv list` 是审计手段。
- **槽位便宜好留、容易忘。** 暂停的变体占的是磁盘（内存镜像）而非 RAM，但上限照样数它；每次改动都把槽位计数告诉模型，工作区满之前就看得见。

## 后果

- 变体工具是集群档唯一的隔离**改动**原语；子智能体仍是对同一工作区并行**阅读**与**推理**的原语。
- 部署多一个 sidecar（`aenv-server`，仅回环）和每台集群 VM 三个环境变量（`AENV_API_KEY`、`AENV_ENDPOINT`、`AENV_MAX_VARIANTS`）；gate 按套餐设上限。均衡档不变。
- 包测试覆盖客户端、注册表、传输、引擎生命周期（上限、分叉、每条失败路径上的清理、沙箱消失）、工具文案、Loader 组合与不变量，每文件 100 %；真实路径在生产 AgentENV 上跑过。
