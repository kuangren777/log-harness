# sci-deliver —— `sci` 档案的 `deliver_files` 工具、shell 交付 spool 与失败回注

[English](README.md) | 中文

替代被研究平台并存的两条交付通道 —— `mcp__clawsgo__deliver_files` MCP 工具（`ClawsGO-System/02-MCP/clawsgo-server.md` §2）与 `__CLAWSGO_SEND__` stdout sentinel（`ClawsGO-System/03-Hooks-and-Mechanisms/mechanism-D-stdout-sentinel.md`）—— 把两者收敛到同一条校验链之后。那里工具有 schema 而 sentinel 没有；交付区规则是一句硬编码的「必须在 workspace 内」，两个 manifest 例外只写在 skill 散文里；sentinel 交付一旦路径写错就什么都不产生：没有卡片、没有报错，智能体继续以为文件已经送达用户。这里 `validateDelivery` 是两条通道都在 harness 侧重跑的同一个纯函数，拒绝理由直接给出补救动作，失败的 shell 交付会被恰好一次地物化进模型的下一轮 prompt。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| 工具 `deliver_files` | `ctx.tools.register()`，render intent `generic` | `deliveryDir`（写进工具描述） |
| shell spool 拾取 | `agent/pre-step`，每轮的第一步 | `spoolDir`、`pollOnTurnStart`（默认 `true`） |
| 交付快照 | `ctx.fs`，落在 `<snapshotDir>/<deliveryId>/` | `snapshotDir`、`maxDeliveryBytes`（默认 64 MiB） |
| prompt context `sci:delivery-failures` | `ctx.systemPrompt.context()`，order `50` | — |
| 会话事件 `sci/delivered` | 追加到发起交付的 agent 会话 | — |
| 会话事件 `sci/delivery-failed` | 为被拒的 spool 条目追加 | — |

`projectRoot`、`spoolDir`、`snapshotDir` 必填且无默认值。沙箱镜像的 home 布局各不相同：`projectRoot` 猜错会拒掉智能体的每一次交付，`spoolDir` 猜错则会去读沙箱内 `sci` 命令根本不写的目录 —— 那正是本包要消除的静默失败。

## 交付区

`isDeliverablePath(path, config)` 就是全部规则，且完全不碰文件系统。只有两种形状通过：`<projectRoot>/<projectId>/<deliveryDir>/` 下的任何文件，以及位于自己 bundle 目录内的 `.paper` / `.sciplot` manifest（`<papers>/<slug>/<name>.paper`）。`.canvas` 画板不是第三个例外 —— 它本来就写在交付区里，按第一条规则通过，并从那里带出自己的 manifest 类别。其余一律拒绝，理由会告诉模型把文件拷进交付区再交付副本。

本包刻意不依赖 `@deepseek-ai/dsh-sci-workspace` 的 `classifyPath`：那个函数回答的是更大的问题（十二类路径中的哪一类，用于 write/edit/delete 决策），而交付只需要一个四值判定；两者又是并行开发的。

## 校验链

`validateDelivery(request, io)` 对注入的 `exists` / `isFile` / `readManifest` / `alreadyDelivered` 谓词是纯函数，其步骤顺序是模型可见的行为，不是实现细节：

1. 交付区判定，在任何 I/O 之前完成 —— 路径写错时告诉模型文件该放哪，而不是告诉它文件不存在。
2. 存在性，然后是「是普通文件」。
3. manifest 类：先过 `@deepseek-ai/dsh-sci-manifest` 校验器，再查本会话的一次性额度 —— manifest 会打开一个实时工作台，所以第二次交付被拒，理由是 `already delivered; later edits reach the open workbench live — describe the change in chat instead`。

额度直接读会话日志里的 `sci/delivered` 记录，因此可重放且无需旁表。`./invariant` 在已提交的日志上断言同一关系，抓的是绕过门禁的调用方，而不是信任门禁本身。

## spool

沙箱内的 `sci deliver` 命令往 `<spoolDir>/pending/` 写一条 JSON（`{ path, title, description? }`），保留 sentinel 唯一的优点 —— 能嵌进 shell 循环 —— 并补上 schema。`<spoolDir>/pending/` 是 `.sci/` 下唯一模型可写的路径，所以条目是不可信输入，事件上的 `via: 'spool'` 是**展示字段，不是认证信号**：模型可以伪造它。正确性只来自在这里重跑校验链。

`FileSystem` 既没有 unlink 也没有 rename，因此「移动」一条已决条目 = 把它写到 `done/` 或 `failed/`，再用墓碑 `{"consumed":true}` 覆盖 pending 里的副本，下一轮读到即跳过。若在这两次写之间崩溃，最多重投一条：manifest 会被一次性规则拒掉，普通文件则多出一张卡片。

## Model Experience

### Tool schema

#### What the model sees

模型看到生成的 [`deliver_files` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-deliver)：`files[]` 每项 `{ path, title, description? }`。描述里插入配置的交付目录名，因为那正是模型必须写对的事实。

#### Token effect

工具可见时，每次请求付固定的 schema 开销。

#### KV Cache effect

定义与可见性不变时前缀稳定。

### Tool-call history and result

#### What the model sees

结果是一行「送达了什么」（`delivered 2 files: report.md (12 KB), fig1.png (340 KB)`），外加每个被拒文件一行及其理由 —— 四个文件里成功三个的调用仍然交付三个，而不是整体失败。调用渲染为 `generic` 卡片，`locations` 带上全部请求路径。`sci/delivered` 与 `sci/delivery-failed` 会话事件都是仅日志的，不进入模型历史。

#### Token effect

结果体量小且形状固定；调用参数像任何工具调用一样留在历史里，直到被压缩。

#### KV Cache effect

仅追加；一次交付除工具结果外不额外消耗 token，也不扰动 KV-cache 复用。

### Delivery-failure context

#### What the model sees

spool 拾取记录一次失败之后，下一次 assembly 会带上 `sci:delivery-failures` 运行时上下文 —— 每条失败条目各一行及其理由 —— 再下一次 assembly 则不再携带。

#### Token effect

暴露失败信息的那一轮花几十个 token；其余时候没有开销。

#### KV Cache effect

运行时上下文的开关翻转会重新物化整块 reminder 快照，所以那一轮要付一次 KV-cache miss —— 这是接受的代价，因为静默丢失一次交付更贵。

## Known Limitations and Deferred Work

- **非 UTF-8 快照以 base64 存储。** 快照路径早于 `FileSystem.writeBytes`，尚未迁移过去，所以交付的 PNG/PDF 仍以 base64 文本写进带 `.base64` 后缀的快照。事件里的 `sha256` 与 `size` 始终描述原始字节，因此从事件投影出的卡片是正确的；直接读快照文件的消费者必须识别该后缀。把 spool 迁到 `writeBytes` 即可彻底去掉这层编码，但同时会改变既有消费者读取的磁盘快照格式。
- **spool 是按轮拾取，不是 watch。** `pollOnTurnStart` 是「没有目录 watcher」时的兜底，而今天所有部署都没有。因此一次 shell 交付在下一个轮边界才可见；只有当 watcher 驱动同一段拾取逻辑后，`pollOnTurnStart: false` 才是正确选项。
- **已决的 spool 条目从不删除。** `<spoolDir>/done/` 与 `<spoolDir>/failed/` 的保留策略属于镜像的 cron（`ClawsGO-System/11-Deployment-Plan`），不属于本包。
- **canvas 资源靠遍历 manifest 所在目录解析。** `canvasAssetDepth`（默认 `3`）限定遍历深度；被引用但落在深度之外的资源会被判定为缺失并拒绝交付。
