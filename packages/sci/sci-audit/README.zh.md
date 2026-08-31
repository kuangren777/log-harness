# sci-audit — `sci` profile 的 session log 审计投影、按需汇总与冷重建

[English](README.md) | 中文

对应原平台设计了却一行没写的审计与统计层（`ClawsGO-System/09-Target-Architecture/08-security-model.md` §审计，表清单见 [`04-persistence-model.md`](../../../../ClawsGO-System/09-Target-Architecture/04-persistence-model.md)）：OpenClaw 规划了 74 张运行时表，其中 `audit_events` 始终是空的，统计页则挂在一个「session 结束」钩子上。这里，append-only 的 session log 是唯一真相源，每张表都只是它的投影，面板上的数字在有人问的时候才算——这套 harness 根本没有 `session/end` 事件可挂。

## 表面

| 表面 | 位置 | Config |
|---|---|---|
| 实时投影 | `session/event`，进程持有的每个 session | — |
| `sci_audit`、`sci_delivery`、`sci_plan` | `ctx.storageDomain`，domain `sci_audit` | — |
| 人类命令 `/audit-rebuild` | `ctx.commands`，session id 参数可选 | — |
| `ctx.sciAudit.rebuild(sessionIds)` | 经 `ctx.sessionQuery` 冷重放 | — |
| `ctx.sciAudit.summarize(sessionId)` | 按需计算，无任何触发器 | `webToolNames` |

## 表的归属

持久化模型列了六张投影表。本包只拥有其中三张——`sci_audit`、`sci_delivery`、`sci_plan`——也只重建这三张。**这是对规格的一处更正**：规格读起来像是一个投影器拥有全部六张，实际上 `sci_skill_usage` 与 `sci_skill_lifecycle` 由 [`@deepseek-ai/dsh-sci-skills`](../sci-skills/README.zh.md) 按它自己的策展规则写，`sci_memory_index` 由 [`@deepseek-ai/dsh-sci-memory`](../sci-memory/README.zh.md) 从它观察到的文件 frontmatter 写。两者都无法仅凭 log 重建，因此都不能在这里被清空重放。`summarize` 通过 `ctx.sciMemory` 只读 memory 索引，从不写它；没挂那个包的组合照样能出汇总，只是少了时序分。

## 投影

`project(event, sessionId)` 是纯函数且完全：一条 log 记录进，零到多行出，不读时钟也不做 I/O。每行 `sci_audit` 都以它来源的 log 坐标为键（`<sessionId>#<seq>`），所以重放一遍 log 写的是与实时路径相同的键，而不是追加重复行。交付行与计划行则以其事件自带的身份为键。

只读 session log。`tools/post-execute`、`workflow/end` 以及其余仅存在于 cordis 的事件一律不看：从它们折出来的行无法被冷重放复现，而那正是本包存在的唯一保证。

`AuditFold` 承载单条事件决定不了的那一点点状态。今天恰好只有一条关系——一次 workflow run 属于它之前声明的那个 plan，而 `tool-workflow/run-start` 只带 run 的身份——所以 fold 记住尚未被认领的声明，并只认领一次。`projectLog` 用一个全新的 fold 跑完整条 log，也正是 `rebuild` 重放的东西。 2026-08-30 起 fold 还承载第二种关系：最近一次 `sci/plan-declared` 之后的每次 `subagent_<persona>` 调用与每个 `tool-workflow/agent-start`（直到下一次声明）都会重发该 `sci_plan` 行，带上 `spawnedAgents`、`spawnedPersonasJson`（workflow agent 记为 `workflow:<label>`）与 `reconciled`（相对 `declaredAgents` 的 `fewer` / `match` / `more`）。被研究平台画了计划卡、却跑脚本里写的任何东西，没有人比对两者（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §5 第 8 行）；这一行就是那次比对，`planRecords` 返回一份日志里每次声明的最终记录。

`sci/authorized`、`sci/tool-denied`、`sci/tier-resolved`、`sci/tier-upgrade-suggested` 按事件类型字符串匹配、按结构读取字段，因为 `sci-guard` 与 `sci-tier` 排在本包之后落地。每一处都带 `TODO(sci-audit)` 注明将来要导入的 payload 类型；payload 缺字段时对应列留空，而不是写一个空值。

## 重建

`/audit-rebuild` 重投影 `ctx.sessionQuery` 语料库里的每个 session；带上 session id 则只重投影这些。任何一张自有表的 schema 变了，做法是清空重放，不做迁移。

请求的 id 会在删除任何东西之前先对语料库校验，因为 `rebuild` 先删后读——一个语料库拿不出来的 id 否则会把它的表清空后就地卡住。所有被请求 session 的清空都在任何重投影开始之前完成，这样后一个 session 认领过的 `sci_plan` 行不会在被重写之后又被删掉。

冷读走 `sessionQuery`，它优先取活着的 session，所以仍在内存里的 session 是用实时 fold 看到的同一批记录重放的。重建与实时提交共用一条写链，不会交错。

## 汇总

`summarize(sessionId)` 返回拒绝数（`tool-denied` 加 `fs-denied` 行）、交付数、显式批准的授权数、挂了 memory 索引时的写入时序分，以及本次会话是否漏引。计数取自已提交的行而非 log，这样调用方看到的就是投影真正提交的数字；两者若不一致，正是 `rebuild` 要暴露的东西。

`citationMissing` 在「本次会话查了网，最终回答却没有内联 Markdown 链接」时为真。只有一次 web 工具**调用**不算——失败或被拒的调用没产生任何可引的事实——所以被度量的条件是拿到了结果，并通过 `callId` 与调用配对，因为 `tool/result` 不重复工具名。它只度量，不设门禁。 摘要另有 `planMismatches`（已启动 agent 始终没对上名册的声明数）与 `deliveriesWithoutExecution`（会话里任何 `execToolNames` 调用返回之前就做出的交付数——没有执行在前的交付物正是被研究平台伪造复现的形状，分析 §3；只计量不门禁）。

## Config

`webToolNames` 指明哪些已注册的工具会查网，默认 `web_search` 与 `web_fetch`，即 [`@deepseek-ai/dsh-tool-web`](../../web/tool-web/README.zh.md) 组合出的名字。工具注册是组合层的选择，所以改名或换实现的部署在这里告诉本包，而不是让引用指标悄悄失效。

## Model Experience

Indirectly, through the packages whose events this projection reads and through the human command surface that triggers a rebuild; this package registers no model-visible context, tool, or prompt section of its own.

#### KV Cache effect

No direct invalidation; this package contributes no request tokens, and neither the projection nor a rebuild moves any prefix a model request is assembled from.

## Known Limitations and Deferred Work

- **命令叫 `/audit-rebuild`，不是 `sci audit rebuild`。** `@deepseek-ai/dsh-commands` 的斜杠命令是单个名字，规格里那种三词 CLI 形式注册不了；本包因此发布一个 service，将来的 Remote 表面可以直接调 `rebuild`。
- **没有 RPC 表面。** 安全模型描述的统计页需要一个覆盖 `summarize` 的 Typert Remote 端点；service 方法有了，线上表面没有，补上属于 profile 装配的改动（规格 P12）。
- **没有 `subagent:<id>` 这种 actor。** 安全模型的 actor 词表里有委派出去的 subagent，但本投影获准读取的 log 记录（`02-w0-adversary-resolution.md`，M6）只涵盖 workflow run 及其成员，因此一次委派调用记在发起它的 session 名下。
- **四个 `sci/*` 类型按结构读取。** 在 `sci-guard` 与 `sci-tier` 导出各自 payload 类型之前，这两个包里的一次改名会让本包相应列静默停止填写，而不是让构建失败。
- **重建不清理别家的孤儿行。** memory 节点被删后留在 `sci_memory_index` 里的陈旧行归 `sci-memory` 修；本包既不拥有那张表，也无法重放它。
- **provenance 只量到会话，量不到数字。** `deliveriesWithoutExecution` 只回答「交付之前有没有任何执行返回过」，不把交付物里的某个数字追溯到产出它的那条 `tool/result`。更细的投影得先定义「交付物里的一个数字」是什么（`clawsgo-analysis/CLAWSGO-SCHEDULING.md` §5 第 4 行）；在此之前 `@deepseek-ai/dsh-sci-plan` 强制的 adversary 是对伪造结果的防线，这个数字是审计侧的信号。
- **检索冗余是下界。** `@deepseek-ai/dsh-sci-agents` 只在子会话以相同参数文本调用同一 web 工具时计一次重复；对同一批论文换个措辞再搜不会被识别（§5 第 9 行）。
