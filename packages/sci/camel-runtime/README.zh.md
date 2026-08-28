# camel-runtime —— `fork_workspace`：把 Dormice 工作区经 AgentENV microVM 分叉

[English](README.md) | 中文

`sci` 档案把每位用户的工作区放在 `ctx.e2b` 背后那个长命的 Dormice 沙箱里（[`../../e2b/dormice/`](../../e2b/dormice/README.zh.md)）：按名幂等、会话间冻结、永不删除。这是工作区该有的归属，却不是并行实验该用的引擎 —— gVisor 容器无法连同进程一起快照再分叉。AgentENV microVM 可以，每次 fork 约 80 ms，但它没有幂等的工作区，默认寿命只有 15 s（[实测](../../../../ClawsGO-System/09-Target-Architecture/A2-agentenv-vs-dormice-poc.md)）。本包把两者接起来而不搬动工作区：`fork_workspace` 把 Dormice 目录导出一次，播种一台 microVM，快照，从该快照为每个变体恢复一台 microVM，各跑自己的命令，再把结果写回真实工作区的 `.sci/forks/<forkId>/<variant>/`。调用结束时所有 microVM 与快照一律删除，无论中途发生什么。设计：[`ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md`](../../../../ClawsGO-System/09-Target-Architecture/A3-camel-runtime.md)。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| 工具 `fork_workspace` | `ctx.tools.register()`，渲染意图 `generic`，`collect` 作为 location | `forksDir`、`maxVariants`（两者写进描述）、`commandTimeoutSeconds`、`maxCommandTimeoutSeconds` |
| AgentENV 客户端 | 原生 REST，`X-API-Key`；沙箱命令与文件走同一端点上的 E2B SDK | `endpoint`、`apiKey`（缺省 `AENV_API_KEY`）、`template`、`sandboxTimeoutSeconds` |
| 工作区传输 | 命令通道上的 `tar -czf … \| base64 -w0`，另一侧 `files.write` + `tar -xzf` | `exclude`、`maxWorkspaceBytes` |
| 事件 `sci/fork-completed` | 追加到调用方 agent 的会话，`ignorable: true` | — |

`inject = ['tools', 'e2b']`。本插件只属于集群（蜂群）preset：均衡档没有扇出，`AENV_API_KEY` 也只注入集群进程。随包发布的集群 preset 用该变量门控这一行（`disabled: !!js process.env.AENV_API_KEY === undefined`），没有 AgentENV 服务的部署就没有 `fork_workspace`；一旦设了密钥，其他任何配置错误都在加载时失败。密钥由本进程读取，绝不转发进任何一侧沙箱。

## 一次 fork

1. 给了 `collect` 就先在 `ctx.e2b.cwd` 内解析；爬出去的路径在任何动作之前被拒。
2. 工作区归档一次（应用 `exclude`；默认 `./.sci`、`./.dsh-e2b`、`*/node_modules`、`./.git`、`*.bin`），超 `maxWorkspaceBytes`（默认 64 MiB）即拒。
3. 从 `template` 起一台种子 microVM，在相同绝对路径解包，然后快照（内存 + 文件系统；实测约 1.4 s）。
4. 同时最多 `concurrency` 个变体从快照起机，以工作区路径为 `cwd`、在 `timeoutSeconds` 内跑 `command`。非零退出是结果。超时报退出码 `124`。
5. 每个变体把 `stdout.txt`、`stderr.txt`、`exit-code` 写到 `<forksDir>/<forkId>/<name>/`；给了 `collect` 时，该目录（若在变体中存在）的内容拷到 `…/<name>/collect/`。
6. `finally`：杀掉所有 microVM、删掉快照。删除失败绝不掩盖 fork 自身的错误。

变体彼此不可见、也看不见真实工作区；变体在 `collect` 之外写的任何东西都不会留下。

## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [`fork_workspace` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-camel-runtime)：`variants[]` 每项 `{ name, command }`，可选 `collect` 与 `timeoutSeconds`。描述里插入 `forksDir` 与 `maxVariants`，这是模型必须写对的两个事实。

#### Token 影响

工具可见的每个请求都付固定 schema 开销；仅集群 preset。

#### KV Cache 影响

按部署静态：描述只随 `forksDir` 或 `maxVariants` 变化。

### 工具调用历史与结果

#### 模型看到什么

每个变体一行：`- <name>: exit <code>, results in <resultDir>`，随后是 stdout 的最后 4000 个字符，退出码非零时再附 stderr 的尾部。被拒的请求会点名出错的变体或字段以及违反的规则。

#### Token 影响

每个变体每条流以 `TAIL_CHARS`（4000）为界；完整输出在结果目录的磁盘上，不进 transcript。

#### KV Cache 影响

每次调用追加一次，此后不变。

## 已知限制与后续工作

- **归档以 base64 走命令通道。** `maxWorkspaceBytes` 之所以存在，是因为 stdout 在两端都缓存在内存里；有大数据文件的工作区需要 `exclude`，或者换成更底层的传输（envd 文件流、共享对象存储）之后才能有意义地提高上限。
- **AgentENV 侧刻意不设幂等工作区。** 每次 fork 都从归档重建种子；在 AgentENV 保留一份每用户的热快照能省掉导出导入，但会引入工作区的第二份持久副本，这正是 A3 拒绝的。
- **快照内存包含种子当时在跑的一切。** 种子除导入外不跑任何东西，所以今天的快照就是一份文件系统加空闲 guest。预热（常驻 Python 内核、已加载的数据集）需要在模板上加 `--start-cmd`，不是改这里。
- **工具没有按变体的资源覆写。** CPU 与内存来自 AgentENV 模板；AgentENV 只对冷启动的 OCI 镜像接受覆写，不对快照恢复接受。
