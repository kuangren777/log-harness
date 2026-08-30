# sci-citations —— `sci` 画像的按项目引用池

[English](README.md) | 中文

`sci-library` 记住用户关心的文献；这个包管的是某一篇稿子真正引用的那些。一个引用池只属于一个论文项目：池里的条目、用户把它们归进的分组、确定性的置信分、每个 citekey 在正文里真实出现的次数，以及磁盘上那份 `refs.bib`——上面这些都写进它、也从它读回来。

## 对外面

| 面 | 挂在哪 | 配置 |
|---|---|---|
| 工具 `citations_list` | `ctx.tools.register()`，渲染意图 `generic`（`kind: 'read'`） | `projectRoot` |
| 工具 `citations_add` | `ctx.tools.register()`，渲染意图 `generic`（`kind: 'other'`） | `projectRoot`、`maxCitations` |
| 服务 `ctx.sciCitations` | `CitationsRuntime extends TypertRemoteService` | `Config` 全部 |
| Remote `sci.citations` | `projects` / `pool` / `upsertGroup` / `removeGroup` / `move` / `add` / `update` / `removeCitation` / `rescan` / `exportBibtex` | — |
| 存储域 `sci_citations` | 表 `sci_citation`、`sci_citation_group` | `maxCitations` |
| 会话事件 `sci/citations-changed` | 仅工具路径追加，`ignorable: true` | — |
| Prompt 章节 `tool:citations` | order `113`，紧接 `tool:library` | — |
| 不变式 `./invariant` | 每一条落库的、低于隔离阈值的条目都带着隔离标记 | — |

## 配置

| 字段 | 默认值 | 决定什么 |
|---|---|---|
| `projectRoot` | `/home/user/sci/projects` | 一个项目一个子目录的那个根目录。工具靠会话工作目录跟它比对来推断这次调用问的是哪个池，对不上就拒绝。 |
| `scanMaxBytes` | `2000000`（2 MB） | 正文扫描愿意读的单个 `.md` / `.tex` 上限。后端报告超过这个大小的文件直接跳过，不去读。 |
| `maxCitations` | `2000` | 一个项目的池最多装多少条。到顶之后新 citekey 会被拒绝；重复添加池里已有的那条仍然可以。 |

围绕它的那些论文包目录名不是配置。`papers/<slug>/src/refs.bib` 和 `workspace/` 是每次 `sci-paper` 技能运行都会写出的布局，改名的部署在碰到这个包之前就已经把技能弄坏了。

## 参考文献文件是权威，用户的决定则无处再生

一条引用记录有两半，归属不同。

书目那一半——标题、作者、年份、期刊、DOI、arXiv id——来自 `refs.bib`，随时可以重读，这正是 `rescan` 做的事：解析每个论文包的参考文献，没见过的 citekey 建一条新记录，见过的刷新字段。正文引用次数 `uses` 同样可再生，办法是通过模型 `read` 工具用的那个 `ctx.fs` 缝隙扫描项目自己的 `.md` 与 `.tex`。

另一半没有第二个出处：用户把条目归进了哪个分组、写下的备注、手动设的隔离。表之外没有任何东西记得这些，所以 `rescan` 绝不碰它们。置信只对来源仅有 `refs.bib` 的记录重算；来自真实索引的记录带着文件里从来没有过的信号（尤其是 `citedBy`），照着文件重算只会一次次把它压低。

`upsertBibtexEntry` 只替换它要改写的那个 citekey 所占的那一段，所以一份满是注释、`@string` 宏和手工排版的参考文献文件，能在模型往里写一条之后原样存活。解析不了的块会变成一条带文件与行号的 `parseErrors`，而不是从池里凭空消失。

## 置信是算出来的，不是评出来的

这个分数是个纯函数，不调模型也不走网络：三个及以上来源一致 `+45`，两个 `+35`，一个 `+15`；有年份 `+10`；有期刊 `+10`；不是只有 arXiv 预印本 `+10`；引用数按对数贡献 `0–25`，到 1000 饱和。总和封顶 100。仅仅因为 `refs.bib` 提到、又没有 DOI 的条目直接记 30 分，因为公式的那些输入对它一项都没被核实过。知识库状态是人的判断而不是信号，所以它最后才收口：`verified` 读作 100，`low-confidence` 压到 60。

低于 70 的条目会被隔离，而这一半标记谁都无权放下——`update({ quarantined: false })` 和把条目移出 `quarantine` 分组，都只会让弱条目继续被隔离，返回的记录也如实这么写。高于阈值时这个标记纯粹是人的决定，任何重算都不会把它清掉。

## Model Experience

### 工具 schema

#### 模型看到什么

生成的 [`citations_list` 与 `citations_add` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-citations)：list 一侧是 `project` 和 `group`；add 一侧是 `project`、`doi`、`arxiv_id`、`library_id`、`citekey`、`group`。没有必填参数——`project` 留空表示当前会话正在做的那个项目。

#### Token 影响

工具可见的每次请求上都是固定的 schema 成本。

#### KV Cache 影响

只要定义不变就前缀稳定；两个 schema 里都不出现任何配置值，所以改 `projectRoot` 或 `maxCitations` 不会重写它们。

### Prompt 章节 `tool:citations`

#### 模型看到什么

order `113` 的一节，紧接在 `tool:library` 之后：每条引用都走 `citations_add`，用它返回的 citekey 来引，不要自己编、也不要手写 `refs.bib` 条目，交稿前跑一次 `citations_list`。

##### 章节原文

```markdown
写论文或综述时，每引用一篇文献先调用 citations_add 放进本项目的引用池，它会解析文献并写入 papers/<slug>/src/refs.bib，然后用它返回的 citekey：LaTeX 里写 \cite{citekey}，Markdown 里写 `[citekey]`。不要自己编 citekey，也不要手写 refs.bib 条目——引用池里没有的 citekey 在排版后是 [?]。交付前调用 citations_list 核对：带「隔离」的条目不能出现在正文里，引用次数为 0 的条目要么用上要么移除。project 参数留空表示当前会话所在的项目。
```

#### Token 影响

固定约 190 tokens，出现在挂载了这个包的组合的每一次请求上。

#### KV Cache 影响

前缀稳定：文本里不带任何配置值，cordis.yml 里没有东西能改写它。

### 工具调用历史与结果

#### 模型看到什么

`citations_list` 先渲染一行真实计数，然后每条引用一行编号——citekey、标题、年份、置信、分组、正文引用次数，被隔离的还带「隔离」——只有确实存在隔离条目时才补一句提醒。`citations_add` 渲染一行，写明 citekey 和正文里可用的两种写法。会话不在任何项目目录里时得到的是一条明确指出该待在什么目录形态下的拒绝，绝不是猜出来的 slug。

#### Token 影响

与池的大小成正比：每行大约 30–50 tokens。装到 2000 条上限的池远比一次列举该有的规模大，所以 `group` 过滤才是让核对保持便宜的办法。

#### KV Cache 影响

只增不改；计数每添加一条都变，所以一次添加前后的两次列举不共享后缀。

## Known Limitations and Deferred Work

- **正文里的 `[n]` 不会链回引用池。** `ui-primitives` 只解析行内代码形式的 mention，所以消息里渲染出来的 `[key]` 就是文本；能把它变成通往引用池视图的链接的那道缝隙还没有做。
- **来源分歧看不到。** `sci-literature` 在这一层看到之前就已经把四个索引合并掉、丢弃了各来源的原始值，所以两个索引给出不同年份的文献读起来只有一个年份，没法看到冲突。要呈现这个分歧，得先让合并保留它的输入。
- **两张表不可重建。** 从浏览器视图做的改动没有会话日志可回放。书目那一半在 `refs.bib` 里活着、能靠 `rescan` 回来；分组、备注和手设的隔离回不来。
- **`scannedFiles` 只属于当前进程。** 头部那个文件数是本进程最近一次 `rescan` 走过的数量，重启后在下次扫描前读作 `0`。它是个摆设而不是关于池的事实，把它持久化意味着第三张表里放一个谁也没法据以行动的数字。
- **参考文献只归一个论文包。** `citations_add` 写进列目录顺序上的第一个论文包。一个项目里两篇引用不同文献的稿子，需要 `rescan` 加人工拆分；按论文包分池没有被建模。
