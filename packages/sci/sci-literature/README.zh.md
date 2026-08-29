# sci-literature —— `sci` 档案的全库文献检索、跨源合并与检索历史

[English](README.md) | 中文

`sci` 档案的模型手上有 `web_search`，它返回的是网页。而一条引用需要的是一件作品：标题、写它的作者、发表的期刊与年份，以及一个读者能解析的标识符。这个包就是这项能力。一次查询并行扇出到 OpenAlex、Semantic Scholar、arXiv、Crossref，四份答案按作品合并成一条记录，返回结果里每一条都带 DOI 或 arXiv id —— 也正是 prompt 要求模型只能照抄的那个东西。

这里没有 provider 选择 seam。`ctx.web` 每次调用只选一个 provider，有多个可用时直接拒绝；而文献检索要的是四个库一起上，因为每个库都知道别人不知道的事 —— OpenAlex 有被引数和开放获取状态，Crossref 在出版元数据上最权威，arXiv 比期刊早几个月就有预印本，Semantic Scholar 有另外三家有时缺的摘要。「扇出」本身就是契约而不是实现细节，所以 `ctx.sciLiterature` 是独立服务，而不是 `ctx.web` 的第五个 provider。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| 工具 `literature_search` | `ctx.tools.register()`，render intent `generic`（`kind: 'search'`） | `sources`、`maxPerSource`、`timeoutMs` |
| 服务 `ctx.sciLiterature` | `LiteratureRuntime extends TypertRemoteService` | `Config` 全部 |
| Remote `sci.literature` | `search` / `recent` / `forget` | — |
| 存储域 `sci_literature` | 表 `sci_literature_history` | `historyLimit`（默认 `50`） |
| 会话事件 `sci/literature-searched` | 仅工具路径追加，`ignorable: true` | — |
| Prompt 章节 `tool:literature_search` | order `111`，紧跟在 `tool:web_search` 之后 | — |

## Config

| 字段 | 默认 | 决定什么 |
|---|---|---|
| `mailto` | `''` | 发给 OpenAlex 和 Crossref 的联系地址。留空则不进这两家的 polite pool，速率限制更低，但仍然能用。 |
| `s2ApiKeyEnv` | `'S2_API_KEY'` | 指向**可选**的 Semantic Scholar key。graph API 无 key 也能答，只是共享 IP 下限额很低；没有 key 是吞吐变低，不是这个源消失。 |
| `timeoutMs` | `8000` | 一次扇出中每个源的预算。 |
| `maxPerSource` | `15` | 合并前向每个库要的记录条数。 |
| `userAgent` | `'camel-science/0.1 (+https://sci.camelco.de)'` | 每次外发请求声明的产品身份；绝不伪装成浏览器。 |
| `sources` | 四个全开 | 一次检索要走哪些库。空列表在加载时就被拒。 |
| `historyLimit` | `50` | 历史表保留多少条检索，超出的丢最旧的。 |

## 一次检索都做了什么

`search(request, signal?)` 先校验 —— 空查询、超过 300 字符的查询、落在 `1..20` 之外的 limit、终点早于起点的年份区间，都会在联系任何库之前就是 `LITERATURE_INVALID_REQUEST`。随后每个配置了的源在 `AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])` 下运行，四路经 `Promise.allSettled` 落定。失败的源变成一条 `sourceErrors` 条目，带源名和一个可机器路由的 code；其他源返回的记录照常返回。只有**一个源都没答上来**的扇出才抛错，即 `LITERATURE_ALL_SOURCES_FAILED`。

对外报出的失败信息只带源名和 HTTP 状态码，不带传输细节 —— 连接被拒读作 `arxiv: request failed`，因为 harness 连不上的那个地址不是模型或用户需要知道的东西。

## 身份与合并

四个库会用四种方式描述同一件作品。一条记录按它携带的最强 key 被识别 —— 先 DOI，再 arXiv id，最后归一化标题 —— 并且只要这三个 key 中**任何一个**已被某个分组占用，它就并入那个分组。这正是「OpenAlex 那条带 DOI、arXiv 那条只有 id」能落到同一条记录上的原因，也是每次合并后要重新登记分组 key 的原因：一个刚刚获得 DOI 的分组，必须在 Crossref 用另一种标题写法返回同一件作品时认得它。

合并只保留事实，不做判断。有值胜过没值；被引数取各源报出的最大值；作者列表取更长的那条，因为被截断的作者名单不是事实；`sources` 是按到达顺序取并集；`source` 指向元数据最完整的那个库（`openalex > semanticscholar > crossref > arxiv`），而不是先答上来的那个。

排序是 `Σ 1/(位次 + 1)`（对该作品出现过的每个源列表累加）加上 `0.15 · log₁₀(被引 + 1)`，同分先按年份降序、再按标题。跨库一致性是主导项，被引项是对数的：5000 次被引大约值 0.55，比「第二个库把它排到第四」多，比「第二个库把它排到第一」少。

## 传输面

每个适配器都经 `src/http.ts` 触达自己的库，所以一套规则同时管住四家：只允许 `https:`，主机固定白名单 `api.openalex.org`、`api.semanticscholar.org`、`export.arxiv.org`、`api.crossref.org`，`redirect: 'error'`，以及**边读边卡**而不是收完再查的 2 MB 上限。查询由模型决定，主机永远不由模型决定；某个库若开始用一个白名单从未放行过的地址重定向作答，这里是拒绝而不是跟随。

arXiv 不提供 JSON，Node 也没有 `DOMParser`，所以 `src/adapters/arxiv.ts` 自带一个只读七个元素的阅读器。它是「那一个 feed 的阅读器」，不是 XML 解析器：它假定 arXiv API 实际产出的那种格式良好、无 CDATA 的文档，遇到形状不同的 feed 的结果是少返回几条，而不是返回错的。它还会把查询词用 AND 连接，因为 arXiv 把词之间的裸空格读成 `OR` —— 一个不加引号的四词主题否则会匹配上任何含其中任一词的东西。

## 检索历史不是投影

其他每张 `sci_*` 表都是会话日志的折叠结果。`sci_literature_history` 做不到：从浏览器检索视图发起的检索没有 agent 会话，所以 `search()` 末尾写下的那一行是「这次查询发生过」的唯一记录。丢掉介质就是丢掉历史，而不是重建历史。因此这张表只装「最近检索」那一条芯片带上要显示的东西，别的层也不读它。

行的 key 是查询文本折叠大小写、压缩空白后的 `sha1`，所以重复检索同一个东西是把一条芯片挪到最前，而不是叠出第二条一模一样的。`./invariant` 对已提交的行断言这层关系：一行若存在于「它自己的 query 推不出来」的 key 下，就是一条用户永远删不掉的芯片 —— 因为 `forget` 调用会静默地什么也没删到。

## Model Experience

### 工具 schema

#### 模型看到什么

模型看到生成的 [`literature_search` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-literature)：必填 `query` 字符串，加上可选的 `year_from`、`year_to`、`limit`。描述里点名四个库并写明分工 —— 只要答案是一篇论文，就用它而不是 `web_search`。声明的 `output.schema` 是完整的记录形状（`id`、`title`、`authors[]`、`year`、`venue`、`abstract`、`doi`、`arxivId`、`url`、`pdfUrl`、`citedBy`、`source`、`sources[]`）加上 `total`、`sourceErrors[]`、`elapsedMs`，因此 Code Mode 程序直接读 `records[i].doi`，不必去解析渲染出来的列表。

#### Token 效果

在工具可见的每次请求上是固定的 schema 开销。

#### KV Cache 效果

只要定义和可见性不变就是前缀稳定的。`MAX_QUERY_LENGTH` 和 `MAX_SEARCH_LIMIT` 出现在参数描述里，改任一个都会让前缀失效；`mailto`、`sources`、`timeoutMs`、`maxPerSource`、`historyLimit` 不出现在模型能看到的任何地方，改动零代价。

### Prompt 章节 `tool:literature_search`

#### 模型看到什么

order `111` 上的一节，紧跟 `tool:web_search`，写明论文走哪个工具、引用只能写检索返回过的标识符、什么都没查到时该怎么说，以及部分失败的结果仍然可用。

##### 该章节逐字原文

```markdown
查学术文献用 literature_search，不要用 web_search：它同时检索 OpenAlex、Semantic Scholar、arXiv、Crossref，返回带 DOI 或 arXiv id 的结构化文献记录。引用时只写返回记录里的 DOI 或 arXiv id，不要凭印象补全或改写。返回为空时直接说没有检索到，不要编造文献。部分来源失败时结果仍然可用，在回答里说明少了哪个来源。
```

#### Token 效果

固定，约 130 token，出现在挂载了本包的组合里的每一次请求上。

#### KV Cache 效果

前缀稳定：文本是没有插值的字面量，任何配置改动都不会重写它。它位于 system prompt 中、在对话之前，因此挂载或卸载本包会让其后的一切失效。

### 工具调用历史与结果

#### 模型看到什么

一份编号列表，每条返回记录一行：标题、最多三位作者后接 `et al.`、期刊、年份、`被引 N`、`doi:…` 或 `arXiv:…`，以及有开放获取 PDF 时的链接。首行写明合并总数和实际返回条数，因此被截断的结果永远不会读成完整结果。失败的源连同 code 写在 `来源错误：` 一行上，每次结果都以 `引用时写 DOI 或 arXiv id。` 结尾。空结果渲染成 `没有检索到文献。` 而不是一个空列表。调用渲染为以查询为标题的 `generic` 卡（`kind: 'search'`）；完成态卡也是 `generic`，所以没有文献卡能力的 UI 回退到的就是这同一段文本。`sci/literature-searched` 事件只进日志，从不进入模型历史。

#### Token 效果

与返回记录数成正比：每行大约 30–60 token，因此默认 limit 10 一次花费几百 token。摘要在规范值里供 Code Mode 使用，但不进渲染文本，这正是行数能保持平坦的原因。

#### KV Cache 效果

只追加；一次检索加上一次工具调用和它的结果，不扰动任何更早的前缀。`elapsedMs` 与合并总数逐次不同，所以两次相同的查询不共享结果前缀。

## Known Limitations and Deferred Work

- **检索历史不可重建。** 它是唯一一张不是日志投影的 `sci_*` 表（见上文）。丢了存储介质的档案会丢掉全部最近查询且无从重建，而从浏览器视图发起的检索在别处不留任何痕迹。
- **Semantic Scholar 按共享 IP 限流。** 没有 key 时 graph API 大约允许该地址上所有人合计每 5 分钟 100 次请求，所以在繁忙部署里 `429` 是常态失败。它会落进 `sourceErrors`，另外三个源照常作答；但想稳定用上 Semantic Scholar 的部署必须提供 `S2_API_KEY`。
- **arXiv 阅读器只覆盖 Atom 的固定子集。** `id`、`title`、`summary`、`author/name`、`published`、`title="pdf"` 的链接、`arxiv:doi`、`arxiv:journal_ref` —— 仅此而已。带 CDATA、用了 `arxiv:` 以外的命名空间前缀、或标题被拆进嵌套元素的 feed，结果是少返回几条而不是返回错的；且没有任何诊断能区分「arXiv 什么也没返回」和「阅读器什么也没看懂」。
- **arXiv 的年份区间是近似的。** 该 API 没有年份过滤，所以带区间的检索先要 `maxPerSource` 条、之后再丢掉区间外的。若某个带区间的查询的命中全都落在前 `maxPerSource` 条相关性结果之外，arXiv 这一路就返回空，而另外三个源正常作答。
- **跨 key 合并是单趟的。** 两条记录在其一携带了分组已认得的 key 时才归并。三条只在传递意义上属于同一作品的记录 —— A 与 B 同标题、B 与 C 同 DOI、而 C 比 B 先到 —— 会留成两个分组，因为分组只在「获得新 key 的那次合并之后」登记这些 key。
- **Crossref 被限制在 `journal-article`。** 会议论文集、书章节、数据集，以及在 Crossref 注册的预印本不会由该源返回。当 OpenAlex 或 arXiv 收录它们时，它们仍然能通过那两路进入结果。
- **尚未录制 keyless snapshot。** `literature_search` 是模型可见变更，欠一份 snapshot，场景文件已写好；录制需要 `DEEPSEEK_API_KEY` 以及 `examples/sci-agent` 里挂载本包的组合条目。在那之前，组装 transcript 这一层只由本包的真实组合测试覆盖。
