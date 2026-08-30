# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：AppFrame 外壳（侧边栏拖动手柄与栏宽求解器）加 `ctx.layout` 面板几何服务；它注册到运行时拥有的 `root` slot，并声明 `rail`、`sidebar`、`conversation`、`details`、`view` 和 `shell.overlay`。侧边栏的缩放边界是不可见命中条带；详情栏没有任何缩放边界——打开即占 frame 内宽的 `DETAILS_RATIO`（一半），只有当这一半会把中栏挤到 `DETAILS_CENTER_FLOOR` 以下时才自动关闭。关闭的侧边栏仍保留 56px 控制栏，详情栏则关闭到零宽度。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点，并一并清除其写入的其他全局状态。

AppFrame 始终挂载会话栏和详情栏；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，详情栏则保持关闭，且该 store 从不读写 `localStorage`。hero 和其他未选中状态也会将详情栏的渲染宽度派生为零，但不会改变存储的宽度偏好。AppFrame 会跨越这些状态保留最后一个非 blank 会话 id：首个会话保持关闭；显式打开详情栏的操作会使用约定默认宽度；返回同一会话时恢复其未改变的宽度；选择不同会话时，详情栏会在绘制前关闭。会话 owner share 为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

组件根是一个 flex 行：先是 `rail` 列，然后是网格 frame。`rail` 是位于侧边栏左侧的图标列，它**紧挨**网格而非长在网格里——frame 因此保持恰好三条轨道（外部读者按位置索引它们），而 frame 自己的 ResizeObserver 报出的盒子本就已经扣掉了 rail，任何地方都不再测量或相减。无占位者时 rail 是一个零宽 flex 项，三栏的表现与没有它时完全一致。它的占位者会收到 `{ view, showView }`，并拥有自己声明的全部内部座位。`view` 是承载顶层整幅界面的 keyed slot：当 frame 的视图不是 `CONVERSATION_VIEW` 时，注册在该 id 下的条目渲染在一个额外的网格单元里，横跨全部三条轨道，侧边栏与详情栏轨道收缩为零。三栏占位者**不会被卸载**——它们留在原处并继续在该视图之后渲染，带上 `data-view-hidden`、`aria-hidden` 与 `inert` 标记，并且用 `visibility` 而非 `display` 隐藏，因此未发送的输入草稿、滚动位置以及其他保存在 DOM 里的状态都能完整穿过一次视图往返。详情栏宽度是产品决定而非用户偏好：它没有拖动手柄，也没有宽模式；frame 会输出 `data-view` 供 CSS 使用。

`ctx.layout` 还承载详情栏的模式手势，使贡献某个模式的插件无需导入拥有该栏的插件即可唤起自己的内容：`showDetailsMode(id)` 会选中 `id` 指定的 `conversation.details.mode` 条目，然后打开详情栏。写入本身属于该栏的占位插件，它通过 `registerDetailsModeSelector` 注册选择器，并随自身 fiber 一并释放；后一次注册会替换前一次，而被替换的 disposer 不会移除任何东西，因此 HMR 换装后保留的是新的选择器。选中先于打开，详情栏因此不会先绘制上一个模式。若没有注册选择器，则不写入任何状态，该手势等同于 `openDetails`；`id` 指向的条目不存在时，面板保持在 `tool` 模式。`showView(id)` 切换 frame 的顶层视图（`CONVERSATION_VIEW` 恢复三栏）。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController`、`CONVERSATION_VIEW` id 和六个 owner-share 接口。AppFrame、面板 store 与栏宽求解器仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **自动关闭通过推导零宽度实现，不会改动打开偏好**：窗口变宽时详情栏会自行恢复；消费方禁止把 store 中的详情值当作实际渲染宽度（渲染宽度由求解器拥有）。
- **被停放的列仍在渲染**：keyed 视图是隐藏三栏而非卸载它们（这正是状态得以保留的原因），因此一个内容繁重的会话在视图背后仍持续付出渲染开销；需要独占整个 frame 的视图必须预期这三列仍然活在树里。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
