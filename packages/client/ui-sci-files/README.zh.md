# @deepseek-ai/dsh-client-ui-sci-files

[English](README.md) | 中文

详情栏的「文件」模式：上方项目树、下方单个文件的预览，作为 `conversation.details.mode` 的 `files` 项注册（标签条与内置的 `tool` 检查器由 [ui-conversation](../ui-conversation/README.zh.md) 拥有）。面板只挂载当前激活的模式，因此其他标签显示期间本包既不绘制也不取数。从 cordis.yml 中删去这一项即移除该标签；只剩一个模式的详情栏根本不渲染标签条。契约见 [slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

树以会话的项目目录为根，每个展开的目录列一次层级并保留结果，因此重新展开不产生任何开销。层级来自 `workspace.listDirectory`，它与读取共用同一道按会话 cwd 的包含围栏，因此两个界面对「项目之内」的判定完全一致。每一行要么是可展开的目录，要么是可预览的文件，要么两者都不是——套接字、设备或断链的软链接以不可交互的形式显示，因为它们既没有字节可读也没有层级可列。网关会下发以点开头的条目，由本客户端隐藏，与 workspace 目录选择器的默认一致；名为 `versions` 的目录带只读标记，因为 sci workspace 拒绝在其中编辑。层级要么完整要么没有：超出部署条目上限的目录以 `too-many-entries` 失败，而不是被截断后送达；七个列目录错误码各有自己的一句话。

预览按文件本身分派。Office 文档（`.univer`、`.xlsx`、`.docx`、`.pptx`）在任何读取发生前就按扩展名路由到 Office 框架——`.univer` 是 SQLite 容器，导出格式是压缩包。其余文件经 `workspace.readFile` 整份读取（超出部署 `readFileMaxBytes` 上限的文件会被拒绝，而不是截断），再按宿主推导的 media type 分派：Markdown 经 `MarkdownText` 渲染为正文，源码与纯文本渲染为带大小行的高亮 `CodeBlock`，图片走 data URL，PDF 经 blob URL 交给浏览器自带的阅读器并随面板释放。没有渲染器的字节只说明其大小与不可预览。`workspace.readFile` 的七个错误码各有自己的一句话；未识别的错误码按内部失败呈现，而不是静默消失。

`OfficeFrame` 向 Office 运行时的 `/univer-api/state` 询问该文档的 Viewer 目标与 Gateway 存活状态，随后以 `mode=embedded&scope=trunk` 嵌入。只有 Gateway 运行时才授予编辑（`editable=true`）——编辑就是一次协同写入，Gateway 不在时其背后无物；Gateway 已停止则以只读方式嵌入并明确说明。运行时完全不作答时——未组合 Office 插件、Gateway 启动失败、许可过期——给出具体原因，绝不呈现空白矩形。其中一种「不作答」只是时序问题，因此不会立刻下结论：刚重启的宿主在挂载好会话之前会以 `SESSION_SCOPE_UNAVAILABLE` 拒绝该读取，仅这一个错误码会重试三次（间隔 0.8 秒、1.6 秒、3.2 秒）后框架才给出结论；其余失败一次即定案，而提示上自带的「重试」按钮供宿主慢于整段等待时由用户再读一次。

该应答是一段没有任何 RPC schema 覆盖的无类型 JSON，其 `viewerUrl` 会成为 `<iframe src>`，也就是在本源内执行脚本——因此它按其本来面目作为线边界校验。`trustedViewerUrl` 只接受 `/univer-gw/` 前缀下的同源相对路径：`javascript:` 与 `data:` 引用解析出不透明源，`//host` 与任何绝对 URL 解析出外部源，而 `/univer-gw/../evil` 会被规范化到前缀之外——这正是校验读取解析后的 pathname 而非原始字符串的原因。`gatewayRunning` 必须严格等于布尔 `true` 而非仅为真值，因为它决定是否授予编辑。`embeddedViewerUrl` 重复同一道来源校验，对无法担保的目标直接抛错而不是组装它；两个调用方彼此独立，这个汇点值得两道防线。框架本身带 `sandbox="allow-scripts allow-same-origin allow-forms"`——Viewer 所需的能力，仅此而已，尤其不含弹窗、顶层导航、下载与模态框。

自动定位的两半读的是同一个事实。显示哪个文件是对会话 conversation 快照的纯推导：最近一次完成的 `deliver_files`、`univer_export` 或 `univer_new` 调用在自己的参数里点名了它，因此打开标签即落在刚刚产出的东西上、其所在目录已展开，且重新加载的会话与实时会话落点一致。何时把该栏推到前台则必然是实时的——conversation 事件 Definition 会在每次加载会话时重放整个窗口，从那次折叠里切换标签会导致每次刷新都强行弹开面板——因此 watcher 跟随当前会话已装配的快照，把第一次读数作为基线，只在此后发生变化时调用 `ctx.layout.showDetailsMode('files')`。

用户点击行会固定选中项，并记录下当时最新的产出文件。该选择只压过那一刻的产出状态：会话产出更新的文件时，模式立即重新跟随，因此第二次交付能自动定位，而第一次的选择也不会显得被忽略。store 只保存这个固定项与展开目录集合；文件字节、目录层级与 Office 状态由展示它们的组件按选择逐次获取。

`/client` 导出的是插件体（`apply`/`inject`）、store 工厂及其状态类型，以及注入面的数据词表。组件、分派表、路径运算与 watcher 都留在包内，藏在 slot 注册之后。

## 模型体验

无，因为这是一个浏览器侧的详情栏模式，其 Node 侧只是惰性的加载器座位：它不注册任何工具、提示词段落或会话事件，展示的每一个字节都是在用户操作时从宿主读取的。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **每个层级在面板生命周期内只读一次。**没有任何机制让列目录结果失效，因此 agent 写进已展开目录的新文件要等到详情栏重新打开才会出现。线上没有可订阅的文件系统变更事件；轮询被否决，因为那意味着面板要为每个展开的目录持续付出这笔开销。
- **自动定位读的是调用参数，而非调用结果。**线上把工具面向模型的结果只作为渲染文本承载，因此产出路径取自调用自身的 JSON。于是最后一个文件被拒绝的 `deliver_files` 调用会定位到一个并未送达用户的路径，而一次交付多个文件时只定位最后点名的那一个。
- **跟随状态下收起某个祖先目录不会保留。**模式跟随产出文件期间，揭示该文件的目录被叠加在用户自己的集合之上保持展开，收起其中之一会在下一次渲染时重新展开。固定任意文件即解除这一叠加。
- **Viewer 框架的 sandbox 限制的是能力，不是源。**`allow-same-origin` 是必需的——协同客户端到 Gateway 的 WebSocket 走本源的 `/univer-gw/ws` 反代，需要授权它的会话 cookie，而不透明源会丢掉这个 cookie。它与 `allow-scripts` 同时存在，意味着已经加载起来的框架可以自行清除 sandbox 属性，因此该属性约束的是行为正常的 Viewer，而不是围困一个恶意文档。真正挡住恶意文档的是 `viewerUrl` 的来源校验，即 `trustedViewerUrl` 与 `embeddedViewerUrl` 两处。要围困一个被攻陷的 Viewer 产物，需要为反代单独启用一个源，并把 cookie 限定到该源。
- **Office 框架报告的是连接，不是同步进度。**表头每份文档只读一次 `/univer-api/state`；Viewer 没有可供本面板订阅的框内同步信号，因此框架加载后掉线的协同会话在重新选择该文档之前仍显示为已连接。
