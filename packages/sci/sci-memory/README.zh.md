# sci-memory — `sci` profile 的 memory 节点、写入时序与召回

[English](README.md) | 中文

对应原平台的 memory 与召回层（`ClawsGO-System/06-Memory-and-Tasks/README.md`，数据模型见 `ClawsGO-System/09-Target-Architecture/04-persistence-model.md`）：memory 节点带 `metadata.originSessionId` 回指蒸馏来源的 transcript，但模型漏写时没有任何机制补上；`clawsgo-recall` skill 靠在沙箱里 glob 原始 JSONL 取 transcript。这里，缺 origin 的节点由执行写入的那个 session 就地补写，「每条记忆是在什么时候写的」成为一张投影，召回则通过两个 RPC 端点读 harness 自己的 session log，而不是某种私有的磁盘格式。

## 表面

| 表面 | 位置 | Config |
|---|---|---|
| memory 写入观察器 | `tools/post-execute`，只放行 | `memoryDir`、`memoryTools` |
| `metadata.originSessionId` 补写 | `ctx.fs.editText`，用读内容前取到的版本做守卫 | `memoryDir` |
| 会话事件 `sci/memory-written` | 追加到执行写入的 session，`ignorable` | — |
| `sci_memory_index` 投影 | `ctx.storageDomain`，domain `sci_memory` | — |
| RPC `sci.recall.index` | Typert Remote，命名空间 `sci.recall` | `openingRequestLimit`（默认 `120`） |
| RPC `sci.recall.session` | Typert Remote，命名空间 `sci.recall` | — |

`memoryDir` 必填且无默认值：各沙箱镜像的 home 布局不同，猜错的默认值会让插件看起来正常却什么都索引不到。

`memoryTools` 声明哪些工具的成功调用会被检查，以及每个工具用哪个参数表示路径 —— 这些名字归工具层所有：`write` 与 `edit` 用 `file_path`，`str_replace_editor` 用 `path` 并把读写复用在一个 `command` 参数后面。只声明 `commandArg` 不声明 `writeCommands`（或反之）会让加载失败：任一半单独存在都会静默地把所有读当成写，或者什么都不索引。

## 观察

观察器挂在 `tools/post-execute` 上，永远返回调用链已经得出的决定；它可以丰富日志，但绝不拦截写入。`fs/write-intent` 与 `fs/edit-intent` 刻意不碰：两者都是单槽 waterfall，已由 `@deepseek-ai/dsh-fs-observation-policy` 占用，第二个占用者会让该策略的 compare-and-set 守卫失效。

被放行的调用，若目标解析后落在 `memoryDir` 之下且以 `.md` 结尾，就会被读回并解析。没有 frontmatter 映射的文件不是 memory 节点，原样放过。缺 `metadata.originSessionId` 的节点用一条以整个 frontmatter 块为锚的字面编辑补写，并用读内容之前取到的版本做守卫，因此并发写入者会让补写失败而不是破坏节点。随后记录的内容是 slug（frontmatter `name`，否则取文件基名）、origin，以及这次写入落在第几轮。

写入之后的失败被收敛并记日志：工具调用已经成功、结果也已经回给模型，所以在写入与读回之间被删掉的节点只是不进索引，而不会把一次已放行的调用变成错误。

## 写入时序

`memoryTimingScore(rows)` = `1 - mean(writtenAtTurn / turnsTotal)`：在多轮会话的第一轮写下的节点接近 `1`，拖到最后一轮才写的是 `0`。它按需计算，不依赖任何「会话结束」触发 —— `session/end` 并不存在。`turnsTotal` 跟随 `turn/end`，而该事件自带的 `turn` 号正好等于会话已完成的轮数，所以实时投影与冷重放结论一致。在任何轮次打开之前写下的节点在会话中没有位置，不参与计分。

## 召回

`sci.recall.index()` 为 `ctx.sessionQuery` 语料库中每个会话返回一行：id、起始时间、工作目录、按 `openingRequestLimit` 截断的开场人类需求，以及会话期间交付的文件标题。插件、工具或 compaction 替换产生的消息永远不会成为开场需求。`sci.recall.session({ sessionId })` 返回该会话的对话，剥掉工具调用、工具结果、流式分片与 reasoning，并在 compaction 替换历史的位置留一个标记。

交付标题以结构方式从 `sci/delivered` 记录中读取，而不是 import `@deepseek-ai/dsh-sci-deliver`，因此只挂 memory 不挂 deliver 的部署仍然能出索引 —— 只是 `deliveries` 为空。

## Model Experience

### memory 节点内容

#### 模型看到什么

写入时什么都看不到。补写发生在模型已经收到工具结果之后，所以模型稍后重新读自己的 memory 节点时，会发现一行自己没写过的内容：`metadata` 下的 `originSessionId`，指明产生该节点的会话。正是这一行让 `sci.recall.session` 能从一条被召回的事实反查回去。

#### token 影响

补写的那一行约二十个 token，只算一次，且只出现在真正读回该节点的请求里。本包注册的任何东西都不进 system prompt 或常驻 context，所以普通一轮完全不为它付费。

#### KV-cache 影响

无。`sci/memory-written` 只进日志，从不进入模型请求，因此本包拥有的前缀不会移动，也不会让任何已缓存前缀失效。

### 召回 RPC 结果

#### 模型看到什么

只在模型主动要的时候间接看到：`sci-recall` skill 在沙箱里调用这两个端点，输出以普通命令结果的形式到达。真正约束这份开销的是 transcript 投影 —— 剥掉工具流量，往往就是「被召回的会话装得进 context」与「装不进」的区别。

#### token 影响

与模型所要的量成正比：每个历史会话一行，或者某一个会话的正文。两者都不是常驻 context。

#### KV-cache 影响

除了任何工具结果追加进对话时的常规开销之外，没有额外影响。

## Known Limitations and Deferred Work

- **不观察 memory 节点的删除。** `ctx.fs` 没有 unlink 动词，经 bash 删除的节点会在 `sci_memory_index` 里留下孤儿行。同名 slug 下次被写入时该行会被纠正；清理孤儿属于 `sci audit rebuild`（规格 P9）。
- **`turnsTotal` 是实时折叠的。** 若某会话的轮次是在本插件未挂载期间结束的，相关行的总数会偏低，从而把时序分数抬高。修复这一点的冷重建属于 P9，不属于本包。
- **生成的 Remote 客户端未注册。** `pnpm run build` 会依据 `./typert` 与 `./remote` 导出产出 `lib/typert.host.*` 与 `lib/typert.remote-client.*`，但把本包加进 `packages/api/remotes/src/client/index.ts` 是 profile 组装层负责的跨包改动。
