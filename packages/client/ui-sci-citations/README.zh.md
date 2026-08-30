# @deepseek-ai/dsh-client-ui-sci-citations

[English](README.md) | 中文

CaMeL Science 的引用池表面：全幅的「引用池」视图及其分组栏与条目列表、路由到它的图标轨按钮，以及 `citations_list` / `citations_add` 调用在对话流里渲染的行。

线缆接缝只在 `src/client/index.ts`。`apply` 在任何注册之前挂载宿主为 `sci.citations` 生成的 Remote 贡献，并经 `ctx.get('remote.sci.citations')` 解析命名空间；注入面把传输层的拒绝折叠成 `src/client/contract.ts` 声明的结局，点击处理器永远不会遇到被拒绝的 promise。每次写入都以宿主在写之后报告的池作答——插件重读 `pool`，而不信任写操作自己的返回值——所以移动、删组、重新扫描都不会让头部与列表描述两个不同的池。

四处贡献，全部经 `ctx.slots.inject` —— 缺少声明包的组合只是少了那块表面：`view` 条目 `citations`、`rail.item` 按钮（order 30），以及 `citations_list` 与 `citations_add` 的 `tool.call.toolview` 体。工具行在绘制前逐字段校验宿主算出的 `result.meta`，不合形状就让位给通用工具卡；它们不从调用参数推导任何东西，所以重放同一份日志画出同样的行。

屏幕上的每个数字都读自宿主回复：头部的总数、平均置信、隔离数与扫描文件数，每个分组旁的计数，每条的正文引用次数，以及它的置信读数（≥90 绿、≥75 蓝，其余橙）。分组标签弹出项目真实分组的菜单，而不是在分组间轮转；两个破坏性手势——删除分组、移出条目——都先确认再执行。两处离开浏览器的交付是完备的：剪贴板写入与 object-URL 下载各自说明是否落地，「复制引用块」与「导出 BibTeX」不会静默失败。

## Model Experience

None, as this is a browser-side presentation package over the `sci.citations` Remote namespace: it registers no tool, prompt section, or session event, and everything it draws is host state the user already owns.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **正文里的 `[n]` 不链接到引用池。** 对话渲染器只解析行内代码提及，渲染后回答里的编号引用仍是纯文本；引用池经图标轨按钮进入。
- **记录词汇是镜像的，不是导入的。** `src/client/contract.ts` 复述 `packages/sci/sci-citations` 的池类型与命名空间签名；组装时把这块换成宿主的 `/types` 导出与生成的 `ctx.remote['sci.citations']` 声明。
- **工具行显示分组的 key 而非标签。** `citations_list` 结果带的是条目所在的 key，不带项目的分组表，所以用户建的分组读作它的 key 而不是用户输入的名字。
- **分组颜色照宿主所写渲染。** 分组栏原样使用 `group.color`，空串时退回中性点；它不校验该颜色与当前主题的关系。
