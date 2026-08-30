# sci-library —— `sci` 档案的用户文献与数据集知识库

[English](README.md) | 中文

`literature_search` 能在公开索引里找到文献；但没有任何东西记住它们。本包就是那份记忆：每档案一个文献、数据集与笔记的库，带用户自己的标签、阅读状态和笔记；条目的文件放在沙箱里，任何工具和技能都能直接打开；模型和「知识库」视图经由同一张表的工具与 Remote 面读写。

## 表面

| 表面 | 位置 | 相关配置 |
|---|---|---|
| 工具 `library_search` | `ctx.tools.register()`，呈现意图 `generic`（`kind: 'search'`） | `maxEntries` |
| 工具 `library_add` | `ctx.tools.register()`，呈现意图 `generic` | `maxFileBytes`、`fetchTimeoutMs` |
| 服务 `ctx.sciLibrary` | `LibraryRuntime extends TypertRemoteService` | 全部 `Config` |
| Remote `sci.library` | `list` / `get` / `add` / `update` / `removeEntry` / `related` / `fetchPdf` | — |
| HTTP 路由 | `POST /library-api/upload`、`GET /library-api/file`（仅受信请求） | `maxFileBytes` |
| 存储 domain `sci_library` | 表 `sci_library_entry` | `maxEntries` |
| 会话事件 `sci/library-changed` | 仅工具路径追加，`ignorable: true` | — |
| Prompt 章节 `tool:library` | 顺序 `112`，紧跟 `tool:literature_search` | — |

## 配置

| 字段 | 默认 | 决定什么 |
|---|---|---|
| `libraryRoot` | `/home/user/sci/library` | 沙箱里的库根目录，每条目一个子目录。prompt 章节点名它，模型才会用 `read` 打开已存文件而不是重新下载。 |
| `maxFileBytes` | `52428800`（50 MiB） | 单个上传或抓取文件的上限，在字节流动时执行。 |
| `maxEntries` | `5000` | 表保留的条目数。超出后先丢按 `updatedAt` 最旧且不带文件的条目；带文件的条目绝不被裁掉。 |
| `fetchTimeoutMs` | `30000` | 一次开放获取 PDF 下载的预算。 |

## 条目、身份与合并

条目 id：来自检索层的沿用文献记录 id（`doi:…` / `arxiv:…` / `title:…`），裸上传是 `file:<sha256>`，笔记是 `note:<ulid>`。添加一个表里已有的 id 走合并：标签并集、文件并集、缺失字段补齐，回复标注 `created: false`。删除可以顺带清空条目的文件，但只在明确要求时——而且清空是把每个文件截断成零字节而不是 unlink，因为文件系统 seam 没有删除动词；空文件和目录会留到沙箱重置。

列表是词法扫描——查询分词后对标题（×3）、标签（×2）、摘要（×1）、作者（×1）计分；不带查询按最近更新排序。过滤（`kind`、`status`、`tag`）先于分页，每个回复都携带真实的 `counts` 与标签直方图，「知识库」视图的筛选芯片正来自它们。仓库里不存在任何向量索引，本包也不假装存在。

## 文件：上传、下载与抓取的 PDF

浏览器没有任何既有表面能写进沙箱，所以本包在宿主 web server 上注册 `/library-api`，套用与 Univer 路由相同的请求信任检查。`POST /library-api/upload` 收一个 multipart 文件（扩展名白名单、文件名清洗、超限 `413`、类型不在名单 `415`），经 `ctx.fs.writeBytes` 写入 `<libraryRoot>/<条目目录>/`，返回更新后的条目。`GET /library-api/file` 把已存文件流式送回供预览或下载——绕开 `workspace.readFile` 8 MiB 回复上限的那条路。

`fetchPdf`（以及带 `with_pdf` 的 `library_add`）在服务端下载已知的开放获取 PDF：只走 `https:`，每一跳重定向（至多三跳）都拒绝私网主机，尺寸上限在读取中执行，回复既不是 `application/pdf` 也不以 `%PDF` 开头就拒绝——存成 `paper.pdf` 的登录页正是这条检查针对的失败。

## 知识库不是投影

与 `sci_literature_history` 一样，这张表是直接写入的：「知识库」视图的增改删没有可回放的 agent 会话。`sci/library-changed` 只在存在会话的工具路径追加，携带操作与 id——记录正文已经在旁边的 `tool/result` 里。

## Model Experience

### 工具 schema

#### 模型看到什么

生成的 [`library_search` 与 `library_add` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-sci-library)：检索侧是自由文本 `query` 加 `kind` / `status` / `tag` / `limit` 过滤；添加侧是 `doi` / `arxiv_id` / `title` / `url` / `tags` / `with_pdf`。

#### Token 影响

工具可见的每个请求付固定 schema 成本。

#### KV Cache 影响

定义不变则前缀稳定；页上限出现在参数描述里，改 `maxEntries` 不改写 schema，但改上限常量会。

### Prompt 章节 `tool:library`

#### 模型看到什么

顺序 `112` 的一节，紧跟 `tool:literature_search`：先查用户自己的收藏，值得留的用 `library_add` 存起来，引用只写条目携带的标识，已存文件从 `<libraryRoot>/<条目目录>/` 用 `read` 打开而不是重新下载。文本中的 `libraryRoot` 跟随配置值；下方展示默认值。

##### 章节逐字文本

```markdown
用户的知识库用 library_search 查：里面是用户自己收藏的文献、数据集和笔记，还带着他们自己写的标签、状态和笔记。问题涉及「我收藏的」「我之前存的」资料时先查知识库，再决定要不要用 literature_search 检索公开索引。把值得长期留存的文献用 library_add 存进去：给了 doi 或 arxiv_id 会自动补全元数据，只有标题时按手工条目保存。引用知识库条目时写它自己的 DOI 或 arXiv id，不要凭印象补全。条目的文件就在沙箱里 /home/user/sci/library/<条目目录>/ 下，library_search 的结果里给的是完整路径，读 PDF 或数据文件直接用 read 或 pdf 技能打开那个路径，不要重新下载。
```

#### Token 影响

固定约 160 token，挂载本包的组合里每个请求都付。

#### KV Cache 影响

`libraryRoot` 固定则前缀稳定；改该配置会改写这一节并破坏一次前缀。

### 工具调用历史与结果

#### 模型看到什么

`library_search` 每条目渲染一行——标题、至多三位作者后接 `et al.`、年份、状态、至多三个标签、标识符、条目文件的完整路径——外加真实的计数行。`library_add` 渲染一行确认：条目、是新建还是合并、以及 PDF 抓取错误（如有）。

#### Token 影响

与返回条目数成正比，默认上限 50 时每行约 30–60 token；定向查询远低于此。

#### KV Cache 影响

只追加；时间戳逐次不同，两次相同检索不共享后缀。

## Known Limitations and Deferred Work

- **检索是词法的。** 仅标题/标签/摘要/作者的分词计分；仓库里没有语义索引。换种说法的查询落空是预期行为，不是缺陷。
- **表不可重建。** 浏览器侧改动没有会话日志可回放；丢失存储介质即丢失库行（`libraryRoot` 下的文件随沙箱幸存）。
- **内联预览止步 8 MiB。**「知识库」视图经 `workspace.readFile` 预览；更大的文件改由 `/library-api/file` 提供下载。
- **`sci-deliver` 仍以 `.base64` 文本快照。** 交付 spool 早于 `FileSystem.writeBytes`，本周期不迁移。
- **keyless snapshot 尚未录制。** `library_search` / `library_add` 是模型可见变更、欠一条；场景文件已写好，录制属于组装步骤。
