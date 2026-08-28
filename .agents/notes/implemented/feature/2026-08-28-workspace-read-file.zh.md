# Agent Note: workspace.readFile（有字节上限、限定在 workspace 内的文件读取）

Status: implemented

[English](2026-08-28-workspace-read-file.md) | 中文

## 问题

浏览器此前无法从 agent 工具实际运行的那个世界里取到文件字节。`host.listDirectory` 只返回目录元数据，`host.openPath` 把路径交给操作系统的默认应用（远端浏览器渲染不了任何东西），而 `session.attachment` 寻址的是用户上传的图片，不是 agent 产出的 markdown、代码、图与 PDF。因此，覆盖会话项目目录的右侧文件面板根本没有可用的读取入口。

这个读取不能走 Host 文件系统。在 sci 部署里 `ctx.fs` 就是 Dormice 沙箱：其中的 `/home/user/sci` 并不是 Host 路径，Host 的 `readFile` 要么答自另一个世界，要么直接失败。包含关系的判定同样归该 seam，因为只有后端能规范化自己的路径。

## 决策

**`workspace.readFile` 通过 `ctx.fs` 读取单个文件的完整内容，以所指定会话自己的 cwd 为围栏，并受部署可配置的字节上限约束。**

- 约定：`WorkspaceApi` 上的 `readFile(request: RpcRequest<{ sessionId, path }>, signal): Promise<RpcResponse<WorkspaceFileContent>>`，其中 `WorkspaceFileContent` 为 `{ path, size, mediaType, encoding: 'utf8' | 'base64', content }`。`path` 是后端执行世界里的规范路径，而非请求时的写法，因此客户端可以据此做缓存键。
- 寻址：目录由会话给出。请求的 `path` 为绝对路径，或相对 `session.header.cwd`；它与该 cwd 都经过 `ctx.fs.resolve`，围栏则是 `ctx.fs.contains(root, target)`。包含关系在**解析后**的 target 上判定，因此指向项目目录之外的符号链接会被当作它本身的越界行为拒绝，而不是因为自身路径看起来在界内就被跟随。
- 不涉及 Agent：读取从宿主侧常驻的会话头部解析 cwd，既不创建也不恢复任何东西——与 `skill.list` 立场一致。未附加的会话回答 `session-not-found`；无 cwd 的 legacy 头部与未组合文件系统后端的组合都回答 `internal`，正是 `skill.list` 已经采用的那两种拒绝写法。
- 上限：`ApiProxyService.Config.readFileMaxBytes`（`z.natural().default(8 * 1024 * 1024)`）被原样传给 `ctx.fs.readBytes(target, signal, maxBytes)`。seam 会以 `FS_TOO_LARGE` 拒绝超限目标，而不是返回读短了的内容，因此响应要么完整、要么没有，绝不会被截断。
- 呈现：`mediaType` 取自固定的扩展名表，未列出的一律为 `application/octet-stream`。`encoding` 对 `text/*` 以及 `application/json`、`application/x-univer`、`image/svg+xml` 为 `utf8`，其余为 `base64`。
- 错误词汇：新增四行 `RpcErrorDetailsMap`——`path-out-of-scope {path, cwd}`、`file-not-found {path}`、`not-a-file {path}`、`file-too-large {path, maxBytes}`——外加已有的 `session-not-found`、`cancelled` 与 `internal`。`file-too-large` 携带该上限；实际大小留在后端自己的消息里。

## 备选方案

**照 `ensureProjectDirectory` 的回退方式，用 `node:fs` 在 Host 上读。** 否决：那个回退之所以存在，是因为没有组合 seam 时目录总得在*某处*被创建，而读取只在工具所处的世界里才有正确答案。它还会逼出第二套以 Host 路径表述的包含判定，与 seam 自己的规范 `contains` 并存。

**为无 cwd 的头部单设 `session-no-workspace` 码。** 出于对称性否决：`skill.list` 已经把这种头部视为宿主自身的破损并回答 `internal`，同一事实两种写法只会诱使客户端两边都判。

**只读文本，并以 `unsupported-binary` 拒绝其余。** 在发现 `FileSystem.readBytes` 确实存在且自带字节上限后否决：base64 对每个后端都是真实可行的，因此图与 PDF 面板无需任何能力协商。

**读取前先用 `FsInfo.size` 复核上限。** 否决：seam 在真正拥有该读取的位置强制了这个界限。多一道检查只会引入一条仅在“后端不报告 size”时才可达的分支，而那恰恰是 seam 自身的失败已经覆盖的情形。

**采用 `session.export` 那样的无信封流式 GET。** 就当前消费方而言否决：预览面板要的是一个经过校验的值，而既有载体两侧都已提供 schema 解析。range 请求日后仍可加入，无需改动本方法。

**通过 `historySourceFor` 支持冷会话。** 否决：为一次文件读取而通读整份冷日志只为取回一个 cwd，代价失衡，而 `skill.list` 已经划下了“仅限已附加会话”的界线。

**对 `mediaType` 做内容嗅探。** 否决：客户端依据的是同一文件在产品各处都携带的那个标签；嗅探出的类型会与它自己的名字相互矛盾。

## 后果

base64 会让二进制体积膨胀约三分之一，因此 8 MiB 的默认上限到达时约为 11 MB 的 JSON——该上限约束的是文件而非响应，在意的部署可自行调整 `readFileMaxBytes`。面板只能拿到整文件：不分页、无 range，冷会话也必须先打开才能预览其产物。两点都已记入 apiproxy README 的已知限制。

新增一行 `RpcMethodMap` 会被编译器锁定到本包之外的三处实现——connection fixture 的内存版 `ApiProxy` 及其穷尽式 `dispatch()`，以及 connection 与 runtime 的两个 `IApiClient` fake——因此新增方法从来不是单包改动。`api-proxy.ts` 中 `@deepseek-ai/dsh-fs` 由 type-only 导入改为值导入以取得 `FsError`，它在这个 wire 边界上把该 seam 的拒绝收敛到稳定错误码，作用与 `GoalError` 之于 goal 域相同。

`tests/api-proxy-read-file.spec.ts` 在真实的 `SessionStore` 与根植于临时目录的 `@deepseek-ai/dsh-fs-local` 之上组合网关，因此这些读取都是真实读取：带多字节内容的 UTF-8、按文本处理的 JSON、经 base64 往返的 PNG 字节、未列出的扩展名、绝对路径与嵌套相对路径、`../` 越界与无关的绝对路径与指向项目外的符号链接一律被拒、把 cwd 自身判为 `not-a-file`、文件缺失与穿过普通文件的路径、恰好等于上限的读取与超出一字节的拒绝、未附加的会话、无 cwd 的头部、缺失的后端、已中止的信号，以及未归类的后端抛错。
