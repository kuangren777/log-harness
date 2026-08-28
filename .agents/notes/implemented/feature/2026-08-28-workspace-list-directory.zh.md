# Agent Note: workspace.listDirectory（有条目上限、限定在 workspace 内的目录列举）

Status: implemented

[English](2026-08-28-workspace-list-directory.md) | 中文

## 问题

[`workspace.readFile`](2026-08-28-workspace-read-file.zh.md) 已让客户端能取到 agent 工具所处世界里某个文件的字节，但没有任何东西告诉它有哪些文件。因此覆盖会话项目目录的文件面板只能靠带外途径拿到路径，永远无法呈现一棵树。

`host.listDirectory` 不是这件事该用的 seam。它服务的是走 `ctx.directoryPicker` browse 后端的原生目录选择器：遍历的是 Host 文件系统，携带的也是选择器词汇（供面包屑用的 ancestry，且没有逐条目大小）。在 sci 部署里 `ctx.fs` 就是 Dormice 沙箱：其中的 `/home/user/sci` 并不是 Host 路径，Host 遍历要么列举另一个世界，要么什么都找不到。包含关系的判定同样归该 seam，因为只有后端能规范化自己的路径。

## 决策

**`workspace.listDirectory` 通过 `ctx.fs.listDir` 提供完整的单层目录，以所指定会话自己的 cwd 为围栏，并受部署可配置的条目上限约束。**

- 约定：`WorkspaceApi` 上的 `listDirectory(request: RpcRequest<{ sessionId, path }>, signal): Promise<RpcResponse<WorkspaceDirectoryListing>>`，其中 `WorkspaceDirectoryListing` 为 `{ path, entries }`，每个条目为 `{ name, path, kind: 'directory' | 'file' | 'other', size? }`。两处 `path` 都是后端执行世界里的规范路径。
- 寻址：与 `readFile` 一致，只有一处有意的差别。`path` 为绝对路径，或相对 `session.header.cwd`，而**空** `path` 寻址的就是该 cwd 本身——面板打开时的入口。`workspaceReadFileRequestSchema` 保持 `z.string().min(1)`，`workspaceListDirectoryRequestSchema` 则用 `z.string()`：文件没有“空路径”的含义，目录有。
- 共用前序与围栏：`workspaceFsScope(ctx, sessionId)` 解析会话、其 cwd 与 `fs` seam，或返回相应拒绝；`resolveWorkspaceTarget(fs, cwd, path, signal)` 解析 target 并判定 `fs.contains(root, target)`。`readFile` 已改为共用这两者，因此两个方法不可能在围栏上走偏。对空路径，`resolveWorkspaceTarget` 直接给出 root target，因为 seam 会把空字符串当作非路径拒绝。
- 不涉及 Agent，也不预先 stat：与 `readFile` 相同的 `skill.list` 立场。列举前不做 `stat`，因为 `listDir` 本身就会以 `FS_NOT_FOUND` 拒绝不存在的目标、以 `FS_NOT_DIRECTORY` 拒绝非目录；网关只收敛这两个码，其余折叠为 `internal`。
- 符号链接：`kind` 是该条目解析到的类型，因此指向目录的链接是 `directory` 行，悬空链接是 `other`。该行的 `path` 仍是条目自身的路径，而非其目标的路径，因此浏览器展示的仍是用户看到的那棵树。本地后端从 `FsDirEntry` 给出的正是这个结果（`target.displayPath` 即 `join(parent, name)`，`type` 来自跟随符号链接的 `probe`）。
- 排序与 dotfile：网关把所有目录排在其余条目之前，组内按 `localeCompare` 排序——正是 seam 自己使用的比较器。dotfile 一律包含；是否隐藏由客户端决定，何况 `.env` 或 `.gitignore` 往往正是用户打开面板要找的东西。
- 上限：`ApiProxyService.Config.listDirectoryMaxEntries`（`z.natural().default(5000)`）在 `listDir` 返回后作用于完整的一层。更大的目录回答 `too-many-entries {path, maxEntries}`，而不是给出前缀。
- 错误词汇：新增两行 `RpcErrorDetailsMap`——`not-a-directory {path}` 与 `too-many-entries {path, maxEntries}`——并复用 `readFile` 已有的 `path-out-of-scope`、`file-not-found`、`session-not-found`、`cancelled` 与 `internal`。

## 备选方案

**给 `host.listDirectory`加一个会话地址。** 否决：它是走 `ctx.directoryPicker` 的目录选择器方法，属于另一个 seam、另一个世界，值也是 browse 形状的（`ancestors`，无大小）。重载它会让同一个方法依据 payload 从两个文件系统作答。

**给 fs seam 新增一个 `listDir` 形状的方法。** 没有必要——`FileSystem.listDir` 已经存在，`FsDirEntry` 已携带 `name`、`type`、`target` 与 `size`，local 与 e2b 两个提供方都已实现。本次未改动任何 seam 包。

**列举前先 `stat` 目标，以便从已知类型给出 `not-a-directory`。** 出于与 `readFile` 否决“读取前复核大小”相同的理由否决：真正拥有该问题的操作已经作答，多一次往返只会引入一条仅在“后端的 `stat` 与 `listDir` 互相矛盾”时才可达的分支。

**递归列举，或加一个深度参数。** 否决：按需展开的树对每个打开的节点各发一次调用，这正是该消费方实际产生的流量；而递归遍历会让条目上限在深树面前失去意义。

**用续传游标替代 `too-many-entries`。** 目前否决：为目录分页需要在并发变更下有稳定顺序，而 seam 并未作此承诺，且没有任何消费方会浏览 5000 条目的目录。明确拒绝是诚实的，悄悄截断的一层不是。

**用逐码点比较排序。** 出于对称性否决：本地后端的 `listDirectory` 已按 `localeCompare` 排序，再引入第二个比较器只会在组内无端改变行序。

**把 `symlink` 作为第四种 `kind` 报告。** 否决：面板要回答的是“打开这一行会发生什么”，也就是目标是什么。`FsInfo` 本就有意解析符号链接，而需要区分链接本身的信任边界消费方另有 `FsPathInfo`／`lstat`。

## 后果

面板一次只浏览一层，且完全打不开超过 `listDirectoryMaxEntries` 的目录——连部分内容都拿不到。两点都已记入 apiproxy README 的已知限制。产出目录确实巨大的部署应调整该上限，而不是接受一份被截断的视图。

`readFile` 现在与 `listDirectory` 共用 `workspaceFsScope` 与 `resolveWorkspaceTarget`。其可观察行为没有变化，自身的测试套件也未经修改即通过，但两个方法在会话、cwd、后端与包含关系上的失败从此完全一致，因为每一项都只有一份实现。

新增一行 `RpcMethodMap` 同样会被编译器锁定到本包之外的三处实现——connection fixture 的内存版 `ApiProxy` 及其穷尽式 `dispatch()`，以及 connection 与 runtime 的两个 `IApiClient` fake。

`tests/api-proxy-list-directory.spec.ts` 在真实的 `SessionStore` 与根植于临时目录的 `@deepseek-ai/dsh-fs-local` 之上组合网关，因此这些列举都是真实列举：以空路径取 cwd 并验证 dotfile 与目录优先的排序、空目录、嵌套相对路径与同一绝对路径结果相等、指向目录与指向文件的符号链接以及一个悬空链接、把 FIFO 判为 `other` 以及对它的 `not-a-directory` 拒绝、`../` 越界与无关的绝对路径与指向项目外的符号链接一律被拒、把普通文件判为 `not-a-directory`、目标缺失与穿过普通文件的路径、恰好等于上限的列举与超出一条的拒绝、未附加的会话、无 cwd 的头部、缺失的后端、已中止的信号，以及 `Error` 与非 `Error` 两种后端失败都折叠为 `internal`。
