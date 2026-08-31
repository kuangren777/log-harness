# camel-runtime —— 常驻项目变体：把 Dormice 工作区复制进 AgentENV microVM

[English](README.md) | 中文

`sci` 档案把每位用户的工作区放在 `ctx.e2b` 背后那个长命的 Dormice 沙箱里（[`../../e2b/dormice/`](../../e2b/dormice/README.zh.md)）：按名幂等、会话间冻结、永不删除。这是工作区该有的归属，却不是并行实验该用的引擎 —— gVisor 容器无法连同进程一起快照再分叉，所有子智能体也共用它唯一的文件系统。AgentENV microVM 可以在远小于一秒内暂停、恢复、快照、分叉（[实测](../../../../ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md)），但它没有自己的幂等工作区。本包把两者接起来而不搬动工作区：一个**变体**就是一个命名槽位，里面是一台 AgentENV microVM，装着**一个项目目录**的副本。模型创建变体、在里面跑命令、把想要的东西拷回来、再删掉它；工作区自己的文件从不被变体碰到。槽位按工作区设上限（`maxVariants`，随套餐变化，由部署按 VM 设置），满了必须先删一个再建。设计：[`ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md`](../../../../ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md)。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| 工具 `create_variant`、`run_in_variant`、`collect_variant`、`delete_variant`、`list_variants` | `ctx.tools.register()`，渲染意图 `generic`；项目或收集路径作为 location | `maxVariants`（写进 `create_variant` 的描述）、`variantsDir`、`commandTimeoutSeconds`、`maxCommandTimeoutSeconds` |
| 变体注册表 | 工作区内 `<variantsDir>/registry.json`，经 `ctx.e2b` 读写；一把进程内锁串行化改动 | `variantsDir`（默认 `.sci/variants`） |
| AgentENV 客户端 | 原生 REST，`X-API-Key`；沙箱命令与文件走同一端点上的 E2B SDK | `endpoint`、`apiKey`（缺省 `AENV_API_KEY`）、`template`、`sandboxTimeoutSeconds` |
| 项目传输 | 命令通道上的 `tar -czf … \| base64 -w0`，另一侧 `files.write` + `tar -xzf` | `exclude`、`maxProjectBytes` |
| 事件 `sci/variant-created`、`sci/variant-deleted`、`sci/variant-run` | 追加到调用方 agent 的会话，`ignorable: true` | — |

`inject = ['tools', 'e2b']`。本插件只属于集群（蜂群）preset：均衡档没有扇出，`AENV_API_KEY` 也只注入集群进程。随包发布的集群 preset 用该变量门控这一行（`disabled: !!js process.env.AENV_API_KEY === undefined`）并从 `AENV_MAX_VARIANTS` 读上限，所以没有 AgentENV 服务的部署就没有变体工具，有的部署按套餐设上限；一旦设了密钥，其他任何配置错误都在加载时失败。密钥由本进程读取，绝不转发进任何一侧沙箱。

## 一个变体的一生

1. `create_variant {name, project}`：槽位名须匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 且未被占用；注册表里的槽位数须少于 `maxVariants`（否则拒绝信息会点名在用的槽位和 `delete_variant`）；`project` 在 `ctx.e2b.cwd` 内解析且必须存在。项目目录被归档（应用 `exclude`，超 `maxProjectBytes`（默认 64 MiB）即拒），从 `template` 起一台 microVM，在相同绝对路径解包。带 `from: <variant>` 时不做归档：先恢复那个兄弟变体，快照（文件、进程、内存），新 microVM 从该快照起机；快照随变体一起删除。
2. `run_in_variant {name, command, timeoutSeconds?}`：microVM 若已暂停则恢复（`POST /sandboxes/{id}/connect`，同时续 idle TTL），命令在项目目录下运行。非零退出是结果；超预算报退出码 `124`。每条流只有最后 4000 个字符到达模型。
3. `collect_variant {name, path?}`：把变体项目里的某个相对目录（默认整个项目）归档并解到工作区的 `<variantsDir>/<name>/collect/<path>`。已收集的文件会被覆盖；真实项目文件不动。
4. 闲置 `sandboxTimeoutSeconds`（默认 30 分钟）后 AgentENV 暂停 microVM（内存落盘，恢复约 50 ms）。`list_variants` 把每个槽位报为 `running`、`paused` 或 `missing` —— 最后一种表示 AgentENV 已经没有这台沙箱（重启、逐出）；missing 的变体必须删掉重建。
5. `delete_variant {name}`：杀掉 microVM，删掉分叉的快照，释放槽位。已收集的文件保留。

注册表就是槽位表：新的 harness 进程能找到上一个留下的变体；损坏的注册表文件会被拒绝而不是当成空表，这样不会有槽位背后出现第二台沙箱。

## 模型体验

### 工具 schema

#### 模型看到什么

五个工具生成的 schema（[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-camel-runtime)）。`create_variant` 的描述里插入 `maxVariants`，这是模型必须围绕它规划的事实；每条描述都说明文件的去向（收集之前什么都到不了工作区）。

#### Token 影响

工具可见的每个请求都付五份固定 schema 开销；仅集群 preset。

#### KV Cache 影响

按部署静态：描述只随 `maxVariants` 或 `variantsDir` 变化。

### 工具调用历史与结果

#### 模型看到什么

每个结果一行：`variant a created, copied from projects/p1; 1/8 slots used`；`variant a: exit 0 (412 ms)` 后接 stdout 尾部、失败时再附 stderr 尾部；`collected 3 files from variant a:out into /home/user/sci/.sci/variants/a/collect/out`；`variant a deleted; 0/8 slots used`；列表形如 `- <name>: <project>, <state>, last used <time>`。被拒的调用会点名槽位或字段以及违反的规则，撞上限时附带"先删再建"的补救。

#### Token 影响

每次运行每条流以 `TAIL_CHARS`（4000）为界；完整输出留在变体里而非 transcript，直到被收集。

#### KV Cache 影响

每次调用追加一次，此后不变。

## 已知限制与后续工作

- **归档以 base64 走命令通道。** `maxProjectBytes` 之所以存在，是因为 stdout 在两端都缓存在内存里；有大数据文件的项目需要 `exclude`，或者换成更底层的传输（envd 文件流、共享对象存储）之后才能有意义地提高上限。
- **变体是一个项目，不是整个工作区。** 变体里的命令只看得到被复制的项目目录；运行时会读兄弟项目或工作区根的项目，需要手工把这些输入拷进去（用 `run_in_variant` 配合已收集的文件 `mkdir`/`cat`）或者重构项目。
- **`missing` 只检测不修复。** AgentENV 在自身重启后仍保留暂停的沙箱，但逐出或运维删掉服务端数据会留下沙箱已不存在的槽位；模型会被告知删掉重建。从最后一次收集的状态自动重建，推迟到真实丢失发生、看清该恢复什么之后。
- **上限数的是槽位，不是资源。** `maxVariants` 限制一个工作区能持有多少台 microVM；每台的 CPU 与内存来自 AgentENV 模板，而 AgentENV 只对冷启动的 OCI 镜像接受覆写，不对模板或快照恢复接受。
