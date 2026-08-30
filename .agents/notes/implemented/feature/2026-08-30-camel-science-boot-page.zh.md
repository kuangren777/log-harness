# Agent Note: CaMeL Science 启动页

Status: implemented

[English](2026-08-30-camel-science-boot-page.md) | 中文

## Problem

不依赖框架的启动页此前渲染 `HARNESS` 字标加一个 20px 旋转圆弧。那是 harness 自身的出厂标识，不是本部署对外呈现的产品标识：`ui-brand-sci` 会接管全部品牌 slot，换成 CaMeL Science 的 mark、字标与 token 层，于是用户看到的第一帧与其后每一帧互相矛盾。

启动页也无法 import 那个插件。它先于浏览器插件树激活而运行，正是为了让客户端 bundle 与插件激活失败仍然可见，而 React 只随 UI renderer 到达。它要展示的任何品牌都必须内联进 kernel。

重做过程中暴露出两个缺陷。该页未声明 `font-family`：`ui-brand-sci` 的 `sci.css` 会设置 `--dsw-font-family`，但那张表随插件挂载，因此启动页掉到了浏览器默认的衬线字体。另外，铺满视口的径向渐变在 8-bit 量化下会带出肉眼可见的同心圆条带。

## Decision

启动页直接呈现 CaMeL Science。它绘制轨道字形——三个绕实心核心旋转 0°/60°/120° 的椭圆，几何与 `ui-brand-sci` 的 `SciLogo` 完全一致——通过 `createElementNS` 构建为内联 SVG，另有双字重的 `CaMeL Science` 字标、一条 determinate 进度条，以及紧邻原样保留的 `Loading plugins…` 提示的「已激活/名册」计数。卡片背后是一层双色斑漂移的 aurora 光晕。

进度从旋转圆弧改为单调进度条。`updateProgress` 把 `--dsh-boot-progress` 写为下限 8% 的百分比，于是首次激活之前进度条已可见、且永不回退；`setTotal` 到达之前计数渲染为空。`data-dsh-boot-spinner` 钩子保留在字形上，使 hydrate 在 UI renderer 交接期间仍能识别同一节点。

调色板作为 `--dsh-boot-*` 回退内联，取值与 `SCI_TOKENS` 对齐，并在其前叠加 `--dsw-*` 读取，因此 token 层落地后该页无需重排即可采用真实 token。有两个值刻意不从插件读取：字体栈以自带的 Apple 优先回退列表声明；aurora 透明度由 kernel 自持，因为 `--dsw-sci-aurora-opacity` 是按面板尺寸的表面调过的，直接读会让光晕在启动中途跳变。

光晕之上一张静态 `feTurbulence` 噪点贴片抖动掉了渐变条带。启动中止时根元素置上 `data-dsh-boot-failed`，停掉字形自转、轨道辉光与核心脉动——名册已死却仍在动会被读成还有进展——而光晕继续漂移。失败报告新增发丝边框卡片、错误圆点与标题，仍以代码字体逐条原样列出失败 entry id 与 sweep 文本。

## Verification

`boot-page.client.spec.ts` 覆盖加载骨架的字标与提示、字形的 `viewBox` 与元素数量、`--dsh-boot-progress` 在 `8%` / `54%` / `100%` 上的单调推进（并在一次 `loading` 更新后保持 spinner 节点同一性）、已激活/名册计数、失败 entry 列举、`data-dsh-boot-failed` 标记、完整 sweep 报告与销毁。三个状态另在 Chromium 1280×800 下按明暗两套方案实际渲染过；衬线回退、渐变条带与失败态仍在动画这三处都是在那里发现并修掉的，单元测试抓不到。

`apps/web/tests/settings-chrome.e2e.ts` 精确匹配 `Loading plugins…`，因此计数是兄弟元素而非追加文本。

## Alternatives considered

**import `ui-brand-sci` 的 `SciLogo` 而非内联几何。** 它是动态加载插件里的 React 组件；启动页存在的意义恰是在该插件加载失败时仍然活着。几何是刻意重复的，两份互相指名。

**只读 `--dsw-font-family` 而不带回退列表。** 这正是被修的缺陷：该变量由随插件挂载的样式表定义，所以启动页必须自带字体栈。

**保留旋转圆弧。** indeterminate 转圈无法表达名册进度，而圆弧 `72deg`–`288deg` 的取值范围读起来像一个卡住的圆，而不是已知总量的一个分数。

**用模糊掩盖 aurora 条带。** `filter: blur(40px)` 叠在渐变上让环状条带更强而非更弱。噪点贴片一次绘制即可消除。

## Consequences

启动页现在承载了 kernel 必须维护的产品品牌：`SciLogo` 的几何、`BRAND_NAME`，或 `SCI_TOKENS` 里的底色与强调色一旦改动，都要在此同步，且没有任何 gate 守住这一点。计数与 `Loading plugins…` 的精确字串对 Chromium e2e 匹配是承重的。`--dsh-boot-arc` 已移除，由 `--dsh-boot-progress` 取代。
