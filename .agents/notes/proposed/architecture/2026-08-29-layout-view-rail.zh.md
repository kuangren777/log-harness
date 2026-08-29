# Agent Note：布局框架里的图标轨列与按 key 切换的顶层视图

状态：proposed

[English](2026-08-29-layout-view-rail.md) | 中文

## 问题

Web 壳只有一块屏幕。`ui-layout` 独占内置的 `root` 槽，并声明四个子槽——`sidebar`、`conversation`、`details`（都是 `single`）和 `shell.overlay`（`list`）——所以框架永远是三栏对话，下游插件注册的任何东西都加不出第五个顶层区域。设置是盖在框架上的模态框，技能住在输入框里，客户端没有路由：不存在「显示另一块屏幕」的原语。

`sci` 档案需要几块与对话并列的全宽屏幕（文献库、引用池、智能体名册、检索页）以及在它们之间切换的图标轨；还需要一个加宽的详情列来预览产出的文档。fork `ui-layout` 会复制让步求解器和拖拽把手，并从此与之后的每个修复分叉；用 overlay 做屏幕会让底下的对话仍可交互。

## 提案

`ui-layout` 新增两个通用的 root 子槽和两个 store 字段，没有任何 sci 专属内容。

- `'rail'`（`single`，`root`）是侧栏之外的最左一列。占用者收到 `{ view, showView }`。框架用它已在运行的 ResizeObserver 量出渲染后的轨宽，并从视口里减掉它再做列求解、把手偏移和自动折叠断点，因此空的 rail 占零像素，对既有 bundle 什么都不改。
- `'view'`（`keyed`，`root`）容纳按视图 id 分发的全幅屏幕。store 的 `view`（默认 `'conversation'`）选择其一；`ILayout.showView(id)` 写入它。keyed 视图显示时，三栏被**停放**而非卸载：轨道收成零，列元素带上 `visibility:hidden`、`aria-hidden` 和 `inert`，视图渲染在一个横跨停放轨道的额外网格单元里。停放保住了对话占用者的元素身份，所以输入框草稿和滚动位置能在往返另一块屏幕后幸存。
- `detailsWide` 配合 `ILayout.toggleDetailsWide()`，让详情列取内宽的 `DETAILS_WIDE_RATIO`（不低于 `DETAILS_MAX`），在生效期间把侧栏轨道归零并撤掉两个拖拽把手；`closeDetails` 复位它。

框架根元素带 `data-view` 与 `data-details-wide`，样式表无需 hook 即可按状态选择。

## 考虑过的替代方案

**把 `ui-layout` fork 成 sci 自有框架。** 控制力最强，但让步链、拖拽把手和主题呈现器各多一份拷贝，并与上游每个修复分叉。否决：需要的改动只是两个槽和两个 store 字段。

**用 `shell.overlay` 渲染屏幕。** 零核心改动，但对话列和详情列在底下仍是活的——焦点、滚动、快捷键都要逐屏压制，之后每块屏幕都继承这套变通。否决。

**keyed 视图显示时卸载三栏。** 框架代码更简单，第一版正是这么做的。但每次切屏都丢输入框草稿和滚动位置，而档案的多屏工作流会不断撞上。改为停放。

**让 rail 占用者声明固定宽度。** 省一次测量，但把框架耦合到某一个占用者的 CSS。测量让轨道可以自行定宽。

## 验收标准

- 没有 `rail` 占用者时，框架的列计算、把手偏移和断点不变（既有 `app-frame` 测试在意图上原样通过）。
- 有 66px 的 rail 占用者时，`computeColumns` 收到 `viewport − 66`，两个把手各偏移 66。
- `showView('x')` 渲染 key 为 `x` 的 `view` 条目，保留三个列的 `renderSlot` 调用，给列打上 `data-view-hidden` / `aria-hidden` / `inert`，不渲染任何拖拽把手；`showView('conversation')` 返回相同的列元素。
- `toggleDetailsWide()` 会打开关闭的列，把详情轨道设为 `max(round(inner × DETAILS_WIDE_RATIO), DETAILS_MAX)`，侧栏轨道归零；`closeDetails()` 清掉该标志。
- `packages/client/ui-layout/src` 每个文件保持 100% 覆盖；`pnpm run test:gui` 与 `tsc -b tsconfig.client.json` 通过。

## 风险

- 停放的列仍在渲染，重的对话在另一块屏幕后面继续付 React 渲染成本。对档案的屏幕规模可以接受；将来可用延迟后的 `display:none` 把这份成本换成返回时的一次重排。
- 轨宽参与自动折叠断点，所以 rail 会把窄屏阈值平移一个轨宽。这是预期语义——轨道确实消耗宽度——但对任何挂载它的 bundle 是可见变化。
- `inert` 以空字符串属性写入，因为 React 18 的类型里没有它；React 19 接受布尔 prop，该断言被限制在一个常量内。
