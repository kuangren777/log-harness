# @deepseek-ai/dsh-client-ui-sci-library

[English](README.md) | 中文

CaMeL Science 的知识库表面：全幅的「知识库」视图及其条目详情页、路由到它的图标轨按钮、`library_search` / `library_add` 调用在对话流里渲染的行，以及加入检索视图结果卡的「加入知识库」动作。

线缆接缝只在 `src/client/index.ts`。`apply` 在任何注册之前挂载宿主为 `sci.library` 生成的 Remote 贡献，并经 `ctx.get('remote.sci.library')` 解析命名空间；注入面把传输层的拒绝折叠成 `src/client/contract.ts` 声明的结局，点击处理器永远不会遇到被拒绝的 promise。文件字节走 Remote 通道之外：上传以 multipart 发往 `/library-api/upload`，大文件经 `/library-api/file` 外链，不超过 RPC 回复上限的预览复用文件面板的读取器。

五处贡献，全部经 `ctx.slots.inject` —— 缺少声明包的组合只是少了那块表面：`view` 条目 `library`、`rail.item` 按钮（order 20）、`library_search` 与 `library_add` 的 `tool.call.toolview` 体，以及 `search.result.actions` 条目——按钮在条目不存在时是「加入知识库」，存在后是「已在知识库」，初始状态来自挂载时的 id 列表，从不靠猜。

屏幕上的每个数字都读自宿主回复：筛选芯片背后的计数、标签直方图、被引与年份格、文件大小、相关条目列表。状态、标签、笔记在改动时经 `update` 保存并渲染返回的条目，页面显示的是表里持有的，而不是刚输入的。

## Known Limitations and Deferred Work

- **预览止步于 RPC 回复上限（默认 8 MiB）。** 更大的已存文件渲染指向 `/library-api/file` 的下载链接而非内联预览。
- **添加动作的初始状态是一次快照。**「已在知识库」反映检索视图挂载动作时取的 id 列表；在别的标签页删掉的条目在下次挂载前仍显示为已存在。
- **BibTeX 在客户端重新生成。** `bibtex.ts` 镜像检索视图的 citekey 规则（姓氏 + 年份）而不跨包导入；两者靠各自的规格测试保持一致。

## Model Experience

None, as this is a browser-side presentation package over the `sci.library` Remote namespace: it registers no tool, prompt section, or session event, and everything it draws is host state the user already owns.
