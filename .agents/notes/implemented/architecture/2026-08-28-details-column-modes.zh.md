# Agent Note: 详情列作为模式环

Status: implemented

[English](2026-08-28-details-column-modes.md) | 中文

## 问题

右侧详情列此前是某个组件的私有主体。`ui-conversation` 的 `DetailsPanel` 占据 layout 的单一 `details` slot，并且只渲染一样东西：工具调用检查器，其中 `conversation.details.tool` 是它内部唯一的洞。想在这一列展示别的东西的插件——工作区文件浏览器、预览界面——只有两条路，且都不对。它可以自己去占 `details` 席位，但那是 `single` slot，于是工具检查器连同每个工具 renderer 都要注册进去的 `conversation.details.tool` 声明一起消失；或者注册一个工具 renderer，假装自己的内容是工具结果，这既谎报了面板正在展示什么，又只在用户选中某次调用时才出现。这一列只容得下一个领域，而这个领域由"谁交付了这个面板"来决定。

## 决策

详情列变成一个模式环，形状与对话视图环已有的 tab 机制相同。`details` 注册声明一个子 slot，并托管当前激活的模式：

```ts
type DetailsModeOwnerProps = { sessionId: string; cwd?: string; active: boolean }
interface SlotMap {
  'conversation.details.mode': { kind: 'list'; scope: 'session'; owner: DetailsModeOwnerProps }
}
```

列表配置项的注册选项即模式本身：`id` 是 store 保存的模式 id，`label` 是它的标签文本（用闭包读注册方自己的 `t`，因此标签跟随当前语言，无需重新注册），`order` 是它的位置。owner 份额是 `{ sessionId, cwd?, active }`——会话标识、模式解析与缩短显示路径所需的工作区根目录，以及面板当前是否在展示该模式。

本包一直交付的工具检查器不再是"面板"：它是 `DetailsToolMode`，即模式环中 `order: 0` 的 `tool` 配置项，也正是它声明并渲染 `conversation.details.tool`。`DetailsPanel` 只保留外壳——标题、关闭按钮和标签条——并通过 `only: <激活 id>` 分发激活的配置项。这一列中的一切都是贡献，包括随包交付的那个；模式的注册方式里没有任何标记表明谁是内建。

三条规则让这个接缝保持可预期。标签条从第二个注册模式起才渲染，因此没有组合任何额外模式的部署，其 DOM 与此前一致。激活模式存放在共享 chat store 的 `detailsMode` 中，与检查器已经在读的 selection 并列，因此面板仍是纯读方，模式选择也像其他按会话的偏好一样在视图切换后保留。找不到在册配置项的 id——插件被组合掉、已卸载，或快照持久化于该字段出现之前——回落到 `tool`，这也正是把回落模式定为本包保证的那个模式的原因。

有两个手势会写入模式。`openDetails(target)`，即聊天视图既有的工具行点击，会连同 selection 一起设置 `tool`：该手势要的是某一次调用的输出，因此不能被另一个手势遗留下来的模式吞掉。`showDetailsMode(id)` 是反向手势，一次完成选择模式与打开该列，供想要显露自身界面的贡献方使用。

面板通过注入的投影读取这个环（`DetailsInjected.modes`，即 slot ledger 之上的 `list`/`subscribe`/`version` 三元组），而不是导入注册表，与会话头读取视图环的方式完全一致。两处投影是 `apply.ts` 中的同一个闭包。

## 曾考虑的替代方案

- **把工具检查器留在 `DetailsPanel` 内，让模式环只承载贡献进来的模式。** 这是更小的改动：不拆组件、不迁移 `conversation.details.tool` 声明，`ui-tool` 中六处直接渲染的测试也照旧挂载 `DetailsPanel`。否决原因：这会让随包交付的模式变得特殊——它无法与贡献模式一起排序、无法被 priority 遮蔽、也不出现在 `slots.entries` 中，于是面板需要两条枚举路径，而实时 slot 检查器会少报这一列。"一切皆插件"在此代价很低，而这种不对称的代价不低。
- **给这一列用按模式 id 分发的 `keyed` slot，而不是 `list`。** 否决：keyed 分发要求 owner 知道 key 的取值域，而本方案的要义恰恰是面板不知道存在哪些模式。list 免费带来 `order` 与 `label`——标签条是 ledger 的投影，而不是面板自己维护的表。
- **让某个模式以更低 priority 占用 `details` 席位并遮蔽面板。** slot 遮蔽本就支持这种做法。否决原因：那是替换而非新增——遮蔽方将拥有标题、关闭按钮以及工具检查器的去留；而两个都想要一列的插件会争夺同一个 cell，而不是呈现为两个标签。
- **让访问过的模式全部保持挂载并隐藏，用 `active` 标志切换可见性。** 这能在标签往返时保留文件浏览器的树与滚动位置，也正是 owner 份额上 `active` 存在的理由。暂时否决：这一列由手势打开，而在别的模式展示时就挂载的模式，会付出用户从未请求的一次列举开销。`active` 保留在约定中，使面板日后可以改用 keep-alive 而不改变模式组件必须处理的内容——已经按它分支的配置项两种策略下都能工作。
- **把激活模式放在组件 state 而非 chat store。** 否决：store 正是这一列已经用于 selection 的跨注册共享，它按会话存在且会持久化；而面板之外的写方（`showDetailsMode`、`openDetails`）需要一个面板会读的写入处。

## 后果

没有贡献模式的部署，这一列的渲染与此前完全一致：没有标签条，标题是调用名，主体照旧。`tests/details-panel.client.spec.tsx` 固定了这一点，以及第二个模式解锁的行为——标签条本身、点击写入 `detailsMode` 并切换主体、标题变为该模式的标签、`openDetails(target)` 切回 `tool`，以及未注册的激活 id 回落到 `tool`。`tests/apply-inject.client.spec.tsx` 固定了两处注入面：`showDetailsMode(id)` 设置模式并调用 `layout.openDetails()`，`modes` 投影跟踪 ledger 的注册变化。标签为 `role="tablist"` / `role="tab"` 并带 `aria-selected`，与会话头的视图环一致。

环中目前只有一个配置项，直到 `ui-sci-files` 注册第二个为止，因此标签条在交付的 bundle 中尚未渲染，这个接缝目前仅由测试覆盖。该插件只需注册一个配置项即可进入这一列，无需改动 `ui-conversation`——这正是本次改动的要义，也是它的第一个实证。

`active` 目前恒为常量。每个被挂载的模式读到的都是 `true`，因为面板只挂载激活的配置项。忽略该标志的贡献方，在面板日后改为保持挂载时会悄无声息地需要返工；约定中已写明该标志是面板的告知，而不是可以假定的值。

把 `conversation.details.tool` 声明迁到工具模式上收窄了它的生命周期。该 slot 随 `tool` 配置项被释放而坍缩，而不再是随整个 `details` 配置项。当前所有注册方（`ui-tool`）都经 `ctx.slots.inject` 进入，会等待声明就绪，因此这一变化不可见——但若某个注册方改为立即注册，它依赖的就是一个配置项而非一个面板。

模式 id 是跨插件边界的裸字符串。它是展示层的 cell key，而非跨进程标识，因此未加品牌类型；代价是 `showDetailsMode` 中的拼写错误会静默回落到 `tool` 而非立即报错。另一条路——维护一份已知 id 的注册表——又会把面板拉回"必须知道存在哪些模式"的处境。

这次改动波及了包之外。`ui-tool` 的六处详情测试原本挂载 `DetailsPanel` 来演练自己的卡片，现在改为挂载 `DetailsToolMode`（提交 `84c4ea6590`，仅测试），日后对 `DetailsInjected` 的任何改动都有同等波及面。模式环本身已在 `46034e3865` 中交付。

该手势此后已迁到布局服务上，取代了上文提到的 `layout.openDetails()` 调用：`ILayout.showDetailsMode(id)` 一次调用即完成选择模式与打开该列，`ui-conversation` 的 apply 在挂载时通过 `registerDetailsModeSelector` 注册该列的模式写入器，`ChatViewInjected.showDetailsMode` 则委托过去；于是拥有某个模式的插件只经 `ctx.layout` 就能把这一列切到自己身上——无需导入本包，且此时它自己的配置项还挂在别的标签后面未被挂载。包之外的波及面也随之多了一处：凡是自建 `ctx.layout` 替身又挂载 `ui-conversation` apply 的测试，如今都必须带上 `registerDetailsModeSelector`，这样做的三个 `ui-tool` 测试文件已一并更新。
