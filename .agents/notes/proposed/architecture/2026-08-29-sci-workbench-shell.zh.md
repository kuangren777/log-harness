# Agent Note：sci 工作台壳 —— 图标轨、工具卡框架、产出芯片、文件面板 chrome

状态：proposed

[English](2026-08-29-sci-workbench-shell.md) | 中文

## 问题

`sci` 档案上线时用的是 harness 原装的壳：侧栏、对话，以及一个由 `ui-sci-files` 提供 文件 模式的详情列。产品设计稿（Claude Design 项目 `225a21da…`，「CaMeL Science 工作台」）要的是另一种框架——一条图标轨，用来在对话和若干全宽屏幕之间切换；工具调用以带实时状态的卡片呈现，扇出时展示智能体星系；每一轮的产出以芯片行列出；右侧面板带文档 chrome（徽标、预览/源码、宽模式、下载）。设计稿里的每个数字和按钮都必须有真实会话数据支撑，不允许画任何占位。

三个约束决定了代码能放在哪。客户端没有路由，`ui-layout` 拥有每一个顶层区域（[布局轨道/视图笔记](2026-08-29-layout-view-rail.zh.md)）。keyed 槽位的单元可以被更低优先级的条目遮蔽，但遮蔽者不能重声明被遮蔽条目的子槽（`SlotCore.register` 拒绝第二次声明），所以替换 `ui-tool` 的工具调用渲染器会静默丢掉所有专属视图。而 `conversation.chat.turnTail` 是 chain——每轮只有一个赢家——芯片行和星系看板不能同时挂在那里。

## 提案

三个 sci 自有的浏览器插件，加 `ui-tool` 里一个通用座位；宿主不动。

- **`ui-sci-shell`** 占 `rail`，并声明 `rail.item` / `rail.footer`，之后的屏幕各自加按钮。它带对话项、基于 `ctx.theme` 的主题切换、个人资料按钮（浮层读网关 `/gate/api/me` 与 `/gate/api/credit/balance`；网关不可达时只显示一行离线提示；退出登录 POST `/gate/api/logout`），以及作为 click-through `shell.overlay` 条目的极光背景。
- **`ui-tool` 新增 `tool.call.frame`**（single，session），由它自己的 tool-call 条目声明。`ToolCallTree` 先分发每工具的展开体，再把整个调用——展开体、子调用分支、选中目标、`openDetails`——交给框架占用者，回退为原有行。锚点仍留在 ui-tool 的包裹元素上，选中与滚动不依赖占用者。
- **`ui-sci-conversation`** 用工作台卡片填这个框架，在 `subagent` / `workflow` 调用上把展开体换成智能体星系。一个 turn 作用域的 `sci-artifacts` 节点定义把 `deliver_files` 与 `univer_export` 的结算折叠进 turn data，因此产出芯片只凭 turn data（与 deliverables 读数取并集）就能在优先级 −10 认领 turn tail，点击交给 `ctx.sciFiles.locate`。会话头的 打开产出 动作和一份只用 token、作用在原装对话 `data-*` 属性上的样式表补齐换皮。
- **`ui-sci-files`** 长出面板 chrome、本会话全部产出路径的芯片行、`sciFiles` 服务，以及一个优先级 −10 的 `conversation.details.tool` 占用者来呈现工作台的工具详情。

`ui-brand-sci` 承载共享 token（`--dsw-sci-*`）和 `SciLogo` 标志。`ui-conversation` 把 `openDetails` 传给 keyed 节点渲染器，卡片才能选中自己的调用并打开详情列。

## 考虑过的替代方案

**用 sci 树遮蔽 `conversation.chat.node['tool-call']`。** 第一版就是这样；注册表拒绝重声明 `tool.call.toolview`，而放弃声明就丢掉 web / 终端 / diff / 读取 / 搜索视图。框架座位让 ui-tool 继续拥有每工具渲染，也给之后任何换皮同一个钩子。

**在档案里禁用 `ui-tool`，由 sci 包重新注册它的视图。** 需要 ui-tool 导出七个内部视图，把它变成某个档案的实现细节。否决。

**星系看板作为第二个 `turnTail` 条目。** chain 只挂载一个赢家，看板和芯片会互相争抢。看板本来就属于那次委派调用，所以住在那张卡片的展开体里。

**芯片只从 deliverables 读数认领。** 只经 `deliver_files` 产出的轮次不出芯片。sci 包自有的 turn 作用域定义补上这个缺口，且不碰 `ui-deliverables`。

**照设计稿画配额 / 方案徽标的占位。** 网关和 harness 里都没有这些数据源；画出来就是虚构。省略。

## 验收标准

- 图标轨可见且对话项激活；主题切换翻转 `ctx.theme` 并在刷新后保持；个人资料浮层显示网关身份或离线提示。
- 一个真实会话为 `bash` / `write` / `deliver_files` 生成卡片，有运行中 → 已结束的变化，可折叠的展开体仍显示 ui-tool 的专属视图，↗ 在 `tool` 模式打开详情列并显示 sci 的详情体，芯片行能在 文件 模式定位产出文件。
- 文件 面板头显示徽标 / 名称 / 大小，预览/源码 可切换，宽模式把列拉到 `DETAILS_WIDE_RATIO` 并隐藏侧栏，下载得到文件，关闭折叠该列。
- 集群档的一次委派渲染出星系，带每个智能体的状态与耗时；token 数只在结算携带时出现。
- `pnpm run test:gui`、`tsc -b tsconfig.client.json`、`pnpm run lint`、`pnpm run doc-sync` 通过；每个新包逐文件 100% 覆盖。

## 风险

- 换皮依赖原装对话的八个 `data-*` 属性；改名任意一个都会静默丢掉一条规则。它们列在包 README 里。
- 文件 store 是跨会话的单实例，切换会话时已展开的目录集合会带过去。
- `toolDisplayName` 是固定的中文表而非 locale 条目；英文界面显示中文工具名。
- 停放在未来屏幕后面的列仍在渲染（见布局笔记）。
