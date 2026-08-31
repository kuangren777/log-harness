# dsh-sci-credit

[English](README.md) | 中文

自有 USD 计费缝的 harness 一侧：**gate 记账，本插件计量并拦截。** 方案见 `ClawsGO-System/13-Billing/00-README.md`（B2，在本仓库之外）；账本、价目表与支付通道属于 gate（`12-Multi-Tenant/artifacts/sci-gate/`）。

全部逻辑落在一个 `llm/stream` waterfall 监听器上，因为那个 waterfall 是每次模型调用唯一必经的缝（`packages/llm/llm/src/index.ts`）。调 `next()` 之前先读租户余额；流结束之后按适配器报告的用量计价并提交扣费。别的都不计量：工具调用不消耗上游 token，所以额度耗尽的租户在模型边界被拦住，它已经发起的工具调用照常跑完。

## 一次计量调用的三步

**查余额。** 带 VM bearer token 的 `GET /gate/api/credit/balance`，比 `balanceTtlMs`（默认 2 秒）新的答案直接复用，并发读合并成一个请求 —— 工具循环每隔一秒就发一次模型调用，否则每一步都要多花一个往返去重问同一个问题。`exhausted`（套餐池与购买池都已用完）会**完全不调用 `next()`** 就拒绝，所以这次拒绝不消耗任何上游 token。gate 答不上来时，默认的 `failMode: 'closed'` 用同样的方式拒绝；`failMode: 'open'` 放行，并且每 `degradedLogIntervalMs` 最多报告一次这次故障。扣费成功会让缓存的余额失效，因为过期的答案会放行租户已经付不起的调用。

**透传。** 每一个下游 chunk 原样透传，并记住最后一个 `usage` chunk。适配器在一次调用内部重试过时，报告的是消费者真正看到的那次尝试，所以取最后一个而不是第一个。

**扣费。** 用量按下文计价，`POST /gate/api/credit/charge` 以一个每次调用现铸的 UUID 记账。gate 的幂等键就是这个 `requestId`，所以 `duplicate: true` 是扣费成功而不是失败。这个 POST 从不被流等待：gate 拒绝或不可达时，payload 转入 spool，由后台重试循环排空。

## 计价

全程 `BigInt` 整数运算 —— 账本是整数微美元，浮点中间值会让同样的两次调用在不同机器上算出末位不同的结果。

| 用量字段 | 按什么价 | 为什么 |
|---|---|---|
| `inputTokens` | `missMicros` | 未命中缓存的输入。`TokenUsage` 各计数互不重叠，缓存读取已经从这个数里扣掉了（`packages/llm/llm-deepseek/src/translate.ts::mapUsage`）。 |
| `cacheReadTokens` | `hitMicros` | 缓存命中走便宜的输入价 —— 这正是把计数拆开的全部意义。 |
| `cacheWriteTokens` | `missMicros` | DeepSeek 把缓存写入按普通未命中输入收费。 |
| `outputTokens` | `outMicros` | 补全 token。 |
| `reasoningTokens` | **不计价** | 已经包含在 `outputTokens` 里：`mapUsage` 把 `completion_tokens` 直接映射成 `outputTokens`，并把 `completion_tokens_details.reasoning_tokens` 并列报出而**不做减法**，这是适配器遵循的 OpenAI 兼容口径。再算一次等于把每个 reasoning token 收两遍。它仍然记进扣费体与会话事件，因为账本行应该说明模型的输出花在了哪里。 |

每个分量都是 `round_half_up(tokens × micros ÷ 1_000_000)`，四项求和，把峰谷乘子作用在这个和上做一次四舍五入（半数进位），再把该行的使用倍率作用在这个结果上做一次。每分量一次、每个乘子一次的舍入，让金额可以只凭账本行复算；先乘价格则会让舍入误差按分量累积。

**峰谷**按请求的**开始**时间取 UTC 判定：周一至周五 01:00–04:00 与 06:00–10:00 为峰值，按标价；其余时段（含周末）为 `offPeakMultiplierX1000`（500，即半价）。窗口起点含、终点不含，所以 `01:00:00` 是第一个峰值秒，`10:00:00` 是第一个谷值秒。gate 供了 `peak` 对象时以它为准；价目表若把窗口声明在 UTC 以外的时钟上，会被**拒收**而不是当作 UTC 读，因为把 UTC 窗口套到别的时区的窗口上会无声地算错每一笔。

**使用倍率** `ratioX1000` 是唯一表示平台在供应商标价之上加收多少的字段：`1000` 即按成本转售，`1500` 即收 1.5 倍。它最后作用在峰谷调整后的总额上，并且刻意不与峰谷乘子合并成一个 —— 两步分开，官方价与加价才能从同一条账本行分别复核，而且每一步各自做半数进位。gate 供的行若没有这个字段，按 `1000` 读，因为按官方价转售是对它沉默的唯一安全解读。

**价目表里没有的模型**按表里最贵的一行计价，并在扣费体与会话记录上都标记 `unknownModel`。比较顺序是输出价、未命中输入价、命中输入价、模型 id，所以选择与表的顺序无关；而且每个价都在**乘过该行的使用倍率之后**再比 —— 那个乘积才是这一行上的调用真正会被收的钱，只比标价会在标价低但倍率高时选错成便宜的一行。往贵的方向错是安全的方向：另一种做法是低于成本提供一个没定价的模型，直到有人发现账本不对。

## 配置

`vmToken` 必填且没有默认值 —— 它指明每一笔扣费落进**谁的**账本，猜错就会记到别的租户头上。空值会让加载失败。没有 gate 的部署应当删掉这一行，而不是把 token 留空。

`pricing` 取 `gate`（默认：启动时拉 `GET /gate/api/credit/pricing`，每 `pricingRefreshMs` 刷新一次，第一次拉到之前用内置的 2026-08 官方价表）或一份显式的行列表 —— 后者只按配置计价、从不问 gate，并盖上 `priceVersion: 0`，这样账本行能说清价格来自哪里。空的行列表会让加载失败。

`spoolPath` 默认 `$DSH_HOME/.sci/credit-spool.jsonl`。随包发布的 `sci` profile 把它改到 `$DSH_HOME/sci/credit-spool.jsonl`，与该 profile 的会话索引放在一起，让一个部署的状态集中在一个目录里。`creditUrl`（默认 `/gate/credit`）是拒绝文案把用户导向的页面。`requestTimeoutMs`、`spoolRetryBaseMs`、`spoolRetryMaxMs` 约束单次 gate 调用与倍增的排空退避。完整字段见[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-sci-credit)。

## spool

一笔扣费是上游已经花掉的钱，所以丢掉一笔比晚送到更糟。被 gate 拒绝的扣费会追加到一个 JSONL 文件（`0700` 目录下的 `0600` 文件），并以从 `spoolRetryBaseMs` 倍增到 `spoolRetryMaxMs` 的延迟重试。一轮排空在第一次被拒时就停下 —— 拒了一笔的 gate 这一轮也会拒掉其余的，继续下去等于给每个排队的 payload 白花一个失败请求 —— 剩下的保持文件顺序，所以最老的那笔永远是下一个被试的。被杀掉的进程留下的截断尾行会被丢弃，而不是留着堵住后面每一行；队列空了文件就被删除。重复投递是安全的，因为 gate 以 `requestId` 为幂等键。

## 事件

`sci/credit-charged{ requestId, model, usage, usdMicros, priceVersion, peak, ratioX1000, spooled, unknownModel }` 记录一次已计价的调用，带信封的 `ignorable` 标记追加：模型永远读不到它，日志中它之后的内容不会因为它的存在被解释成别的样子，它存在是为了让审计投影能把一个会话与租户账本对上 —— `requestId` 就是账本 `ref` 去掉 `req:` 前缀后的部分。`spooled` 为真恰好表示 gate 没有接受这笔扣费、payload 正在本地等待。即使扣费既没到 gate 也没进 spool，这条记录也会写下，`spooled: false` 并记一条 error 日志，因为丢掉的扣费正是最需要在日志里看得见的那种情况。

`./invariant` 伴生插件断言：同一个会话里没有两条 `sci/credit-charged` 共用一个 `requestId`。gate 账本的 `ref` 是 UNIQUE 的，所以重复意味着两次计量调用塌缩成了一笔扣费 —— 租户只为其中一次付了钱，价格不同时付的还是错的那次。反方向（每个带 usage 的响应都有一笔扣费）故意不断言，因为活的事件流判定不了：记录是在响应之后追加的，以 error finish 结束的调用会报告用量却根本不产生 `assistant/message`，而未投递的扣费本来就会跨进程重启在 spool 里等着。那个方向属于日志与账本之间的对账，不属于对一条正在生长的日志的断言。

## Model Experience

None, as the metering registers no prompt, tool, or context of its own, and its refusal reaches the user rather than the model: an error finish is raised out of the agent loop as an `LlmError` (`packages/core/agent-loop/src/agent.ts`) and never enters a model request.

#### KV Cache effect

放行的调用没有影响：chunk 原样透传、没有任何请求字段被改写，所以下一轮复用的上游前缀与 loop 组装出来的那份逐字节相同。被拒绝的调用根本没有发出去，既不产生前缀也不作废任何前缀。

## Known Limitations and Deferred Work

- **既没到 gate 又没进 spool 的扣费会丢失。** 两个失败同时发生时，payload 只存在于内存里；它会以 error 级别连同请求 id 与金额被报出，会话记录也标 `spooled: false`，但没有任何东西会去收它。要堵住这个口子需要一个自带上限的内存暂存队列，等到真有部署遇上再说。
- **spool 扛不住 home 目录丢失，也不在进程之间共享。** 共用一个 `$DSH_HOME` 的两个 harness 进程会各自排空同一个文件；**单个**进程的追加与排空是串行化的，但没有取跨进程锁。gate 的幂等只是让重复排空无害，不是让它不发生。
- **余额按进程读，不按会话读。** 一个 `vmToken` 对应一个租户，所以一台 VM 服务该租户的多个用户时，池子用完会一起被拒。
- **拦截只发生在模型边界。** 已经派发的工具调用会跑完，沙箱的 CPU、存储与出网完全不计量 —— 只计模型 token。
- **一次适配器调用内部的重试只收一次费。** 取最后一个 `usage` chunk，所以适配器丢弃的那次尝试花掉的 token 不计费。loop 层的重试是独立的 `llm/stream` 调用，会分别计费，这与上游自己的口径一致。
- **价目表按定时器刷新，不按价格变动刷新。** gate 改价之后到下一次刷新之间发出的扣费，按旧版本计价并盖旧版本号。盖版本号正是让它可审计而不只是算错了的原因。
- **只应用 UTC 的峰谷表。** gate 把窗口发布在别的时钟上时，整张价目表被拒收，从而保留上一张表而不是算错价；支持第二个时区需要在本包里引入真正的时区数据库。
