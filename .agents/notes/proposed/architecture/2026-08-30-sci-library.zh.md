# Agent Note：sci 知识库——一张表、三个写入者、字节走 RPC 通道之外

Status: proposed

[English](2026-08-30-sci-library.md) | 中文

## Problem

`literature_search`（`dsh-sci-literature`）能在公开索引里找到文献，但只记住查询历史。`sci` 档案里没有任何东西记住文献本身：模型会重新下载已经总结过的 PDF，工作台设计稿里的「知识库」视图没有数据源，②检索视图里找到的记录留不下来。

三个消费者要读写同一份收藏：模型（经工具）、知识库视图、②的结果卡（添加动作）。其中两个在浏览器里，文件字节也要从那里进出——而 Remote RPC 通道的回复上限是 8 MiB，存下来的 PDF 经常更大。

## Proposal

**一个存储 domain，三个表面。** `dsh-sci-library` 拥有 domain `sci_library`（表 `sci_library_entry`），暴露为 `library_search`/`library_add` 工具、带 Remote 命名空间 `sci.library` 的 `ctx.sciLibrary` 服务（`LibraryRuntime extends TypertRemoteService`，沿用 `dsh-sci-literature` 的模式）和两条 HTTP 路由。所有表面都过同一个 runtime，计数、标签直方图与合并语义不可能分叉。

**知识库是直接写入的表，不是投影。** 与 `sci_literature_history` 一样，浏览器侧的改动没有可回放的 agent 会话，这张表就是权威、不可重建。会话事件 `sci/library-changed`（`ignorable: true`）只在存在会话的工具路径追加——model-visible ⟺ logged 规则依然成立，因为记录正文已在旁边的 `tool/result` 里。

**条目身份就是文献记录的身份。** 条目沿用检索层的 id（`doi:…`/`arxiv:…`/`title:…`），裸上传是 `file:<sha256>`，笔记是 `note:<ulid>`。添加已存在的 id 走合并（标签并集、文件并集、缺失字段补齐）并回复 `created: false`——「加入知识库」按两次、或工具添加叠在浏览器添加之上，收敛而不重复。

**字节走 Remote 通道之外。** `POST /library-api/upload`（multipart、扩展名白名单、`413`/`415`）经 `ctx.fs.writeBytes` 写入 `<libraryRoot>/<条目目录>/`——这正是 [fs Agent Note](2026-08-30-fs-write-bytes.zh.md) 为这个消费者补的原语——`GET /library-api/file` 把已存字节流式送回，两条路由都套 Univer 路由同款请求信任检查。文件落在沙箱里，`read` 工具和 PDF 技能按 `library_search` 打印的路径直接打开；prompt 章节 `tool:library`（顺序 112）让模型这么做而不是重新下载。

**`fetchPdf` 把网络当敌对。** 只走 `https:`，每一跳重定向（至多三跳）都拒绝私网主机，尺寸上限在读取中执行，回复既不是 `application/pdf` 也不以 `%PDF` 开头就拒绝——存成 `paper.pdf` 的登录页正是这条检查针对的失败。

**②长出一个 seat，而不是一个依赖。** `ui-sci-search` 的 view 条目声明 `search.result.actions`（逐记录 list seat，owner props 携带记录）；`ui-sci-library` 把「加入知识库」注入进去。没有③的组合只是卡片上没有动作条；没有②的组合只是知识库少一条捷径。两个包在任何方向都没有 import。动作的初始按压态来自挂载时的一次 id 列表（以宿主一页为上限），从不靠猜。

**检索是词法的，并且明说。** 查询分词后对标题（×3）、标签（×2）、摘要（×1）、作者（×1）计分。仓库里不存在向量索引，README 把换种说法查不到写成预期行为而不是假装有语义。

这次改动顺带暴露一个构建管线事实：`tsconfig.base.json` 的 `@deepseek-ai/dsh-*` 通配只映射裸包名，没有自己显式 paths 行的跨包 `/types` 子路径 import 会落到 node_modules，解析到构建产物 `lib/types/*.d.ts`——类型检查照过（声明等价），但 typert workspace analyzer 拿到的是源程序之外的 symbol 身份，于是以 `package reference … is not exported` 拒绝引用方的 Remote 贡献。修法是每个跨包 `/types` import 一条 paths 行（`@deepseek-ai/dsh-sci-literature/types` → `src/types.ts`）；将来任何 Remote 载荷引用别包 `/types` 的包都欠同样一行。

## Alternatives considered

**像 `sci-audit` 的表那样从会话日志投影知识库。** 否决：表里的大部分内容——拖进浏览器的 PDF、在视图里敲的标签——从未 model-visible，不产生可回放的会话事件。投影要么丢掉这些写入，要么给每个浏览器手势伪造一个会话。

**让文件字节走 `sci.library` Remote。** 否决：RPC 回复上限 8 MiB，存下来的 PDF 经常更大；JSON 里的 base64 还让每个载荷膨胀三分之一。两条 HTTP 路由复用 Univer 路由已有的请求信任栅栏，字节通道没有引入第二套信任模型。

**为卡片动作让③ import ②（或反过来）。** 否决：直接 import 耦合两个视图包，破坏「移除一个包恰好移除它自己的表面」的组合规则。`search.result.actions` seat 让带记录类型的 owner props 成为唯一共享词汇。

**为知识库另铸 id，而不是沿用文献记录 id。** 否决：同一篇论文找到两次（或浏览器添加后工具再添加）会重复，而且每个指回检索层的交叉引用都需要一张映射表。沿用 id 让合并成为添加的自然语义。

## Acceptance criteria

- `library_search` 与 `library_add` 从组装好的 `sci` 档案注册；keyless snapshot `examples/sci-agent/tests/library.snapshot.ts` 录下「DOI 解析添加 + 回读检索」，且可确定性回放。
- 知识库视图、rail 按钮、两个工具行、「加入知识库」卡片动作全部经 `ctx.slots.inject` 挂载并随插件 fiber 撤下（`plugin.client.spec.tsx` 证明注册与 disposal）。
- `POST /library-api/upload` 在读 body 之前拒绝不受信请求，超限 `413`，扩展名不在白名单 `415`；`GET /library-api/file` 流式送回已存文件——全部经真实 socket 观察（`upload-route.spec.ts`）。
- `fetchPdf` 拒绝非 `https:` URL、每跳重定向的私网主机、读取中超限的 body、非 PDF 回复（`fetch-bytes.spec.ts`）。
- `packages/sci/sci-library` 与 `packages/client/ui-sci-library` 保持逐文件 100% 覆盖；host 与 client 两个编译面绿，`/remote` 入口的 `lib/typert.remote-client.*` 已生成。

## Risks

- **表按设计不可重建。** 丢失存储介质即丢失库行；只有 `libraryRoot` 下的文件随沙箱幸存。README 已写明；本周期没有备份路径。
- **添加动作的按压态是一次快照。** 挂载时的 id 列表以宿主一页（100）为上限，超过它的库可能对已存记录仍显示「加入知识库」；宿主侧合并让第二次添加无害，这是该上限可接受的原因。
- **`removeEntry` 无法 unlink。** 文件系统 seam 没有删除动词，清空条目文件是截断成零字节，空文件和目录留到沙箱重置。
- **`/types` paths 行的规则容易被忘。** 在 typert workspace pass 跑起来之前什么都不会失败；本 note 记录的报错信息就是留给下一个人的面包屑。
