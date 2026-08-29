# Agent Note：文献检索作为独立运行时 —— 四个索引，一种记录

状态：proposed

[English](2026-08-29-sci-literature-search.md) | 中文

## 问题

`sci` 档案没有办法把论文当论文来找。`web_search` 返回带摘要片段的 URL；研究者需要作者、期刊、年份、被引数、摘要，以及一个可解析的标识——DOI 或 arXiv id——而且要从真正持有文献的索引拿：OpenAlex、Semantic Scholar、arXiv 与 Crossref。工作台设计还把一块全屏的「检索」视图放在对话旁边，所以同一能力既要服务于会话内的模型，也要服务于没有会话的浏览器。

`ctx.web` 承载不了这件事。它的 seam 在调用时只选一个 provider，两个可用时直接拒绝（`WEB_PROVIDER_AMBIGUOUS`），而 `WebSearchSource` 没有任何书目字段。文献检索的形状恰好相反：每次查询同时扇出到四个索引，答案就是它们的合并。

## 提案

一个宿主包 `packages/sci/sci-literature`，承担 seam 的全部三个角色——只有 sci 档案消费它，四个来源也一起演进。

- `LiteratureRuntime`（`ctx.sciLiterature`，Typert Remote 命名空间 `sci.literature`）把一次查询并行打到四个适配器，各自超时。失败的来源进入 `sourceErrors`；只有所有来源都失败时才抛 `LITERATURE_ALL_SOURCES_FAILED`。回复归一化为同一种 `LiteratureRecord`，按 DOI → arXiv id → 归一化标题合并（一个分组每次合并后重新登记它的键，所以 OpenAlex 的正式记录和它的 arXiv 预印本会收成一条），再按来源内名次加 `0.15·log10(citedBy+1)` 排序。
- 同一个服务在 `Service.init` 里、存储 domain 打开之后注册 `literature_search` 工具与它的 prompt 章节，因此一次调用不可能到达一个历史没有介质的运行时。工具的 `presentationMeta` 携带 `{ kind: 'literature', records }` 供浏览器卡片使用。
- `sci_literature_history` 的行以 `sha1(query)` 为键，重复检索只移动一枚芯片而不会堆叠，`forget` 也能点名一行。这张表是便利存储而非日志投影：浏览器检索没有可回放的会话。
- `sci/literature-searched` 只在工具路径以 `ignorable: true` 追加；记录正文已经在旁边的 `tool/result` 里。
- 出站请求只走 `https:` 到四个主机的白名单，`redirect: 'error'`，读取上限 2 MB，显式的产品 User-Agent 带部署的 `mailto` 进入 polite pool。Semantic Scholar 的 key 可选，经 `ctx.credentials` 解析并回退到环境变量；没有 key 时 `available()` 仍为真。

`packages/client/ui-sci-search` 注册 `view` 键 `search`、`rail.item`，以及 `literature_search` 的 `tool.call.toolview`。它只经 `ctx.remote['sci.literature']` 触达宿主，并在本地镜像记录类型（客户端包不能依赖宿主包），因此两半可以按规格并行构建。

## 考虑过的替代方案

**做成 `ctx.web` 的 provider。** 否决：该 seam 只选一个 provider，其来源形状没有作者、期刊、DOI 或被引数；硬掰会把书目字段泄漏到每个 web 消费者。

**每个索引一个 provider 包，挂在带选择配置的 `LiteratureRuntime` seam 后面。** 与 `dsh-web` 同构，但没人想只选一个索引——产品价值就在合并。改为把四个适配器作为同一个包的模块，各自失败隔离。

**给浏览器视图开一条裸 `webServer` HTTP 路由。** Univer 那样做是因为它的 viewer 是第三方 iframe；「检索」视图是普通客户端代码，Remote 通道已经带信任检查和类型化错误。

**把历史做成 `sci/literature-searched` 的投影。** 该事件只在有 agent 会话时存在；浏览器视图没有会话，投影永远看不到它的检索。

## 验收标准

- `literature_search` 对 `n-type SnSe thermoelectric` 返回合并去重的列表，OpenAlex/arXiv 那一对收成一条并同时带两个来源；Semantic Scholar 的 429 出现在 `sourceErrors` 里，其余三源的记录照常返回。
- keyless snapshot `examples/sci-agent/tests/snapshots/sci-literature-search.txt` 可从录制的 fixture 回放。
- 「检索」视图列出带来源标签的结果、BibTeX 复制、仅在有 OA 链接时出现的 PDF 链接，以及打开预填对话的「在研究流中深入」动作。
- `pnpm run typecheck`、`test:gui`、`lint`、`doc-sync` 通过；两个包逐文件 100% 覆盖。

## 风险

- 没有 key 时 Semantic Scholar 会对共享出口限流；结果退化为三源并带可见错误，绝不静默。
- arXiv 的 Atom 读取器是固定字段解析；feed 变化会以 fixture 测试失败的形式暴露，而不是静默丢字段。
- 合并是单趟的，乱序到达的 A–B–C 传递链可能留成两组（包 README 已记录）。
