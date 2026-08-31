# Agent Note: `dsh-sci-credit` 按 gate 的 USD 账本计量模型调用

Status: implemented

[English](2026-08-27-sci-credit-metering.md) | 中文

## Problem

多租户 `sci` 部署现在在 gate 侧已经有了账本、价目表和三条支付通道（`ClawsGO-System/13-Billing`，B1 与 B3），而 harness 侧没有任何东西去花它。套餐池与购买池都为空的租户可以无限继续发模型调用，已付费的租户也无法从自己的会话日志里看出一轮对话花了多少钱。

两个看起来顺手的位置都不对。让 gate 去读会话 JSONL 算钱，无法在调用发生之前拦截，需要跨 VM 访问目录，而且是在一个不承诺兼容性的日志格式上重新推导金钱。在 relay 里扣费被部署要求排除：本产品与 CaMeL-api 不共享任何东西。

## Decision

`@deepseek-ai/dsh-sci-credit` 只拥有一个 `llm/stream` waterfall 监听器 —— 每次模型调用唯一必经的缝（`packages/llm/llm/src/index.ts`）—— 并围绕它做三件事。

调 `next()` 之前，用 VM bearer token 读 `GET /gate/api/credit/balance`，比 `balanceTtlMs`（默认 2 秒）新的答案直接复用，并把并发读合并成一个请求：工具循环每隔一秒就发一次模型调用，否则每一步都要多花一个往返去重问同一个问题。`exhausted` 的租户会被拒绝 —— 产出一个终止的 `{kind:'error'}` finish，code 为 `CREDIT_EXHAUSTED`，消息是一句含 `creditUrl` 的双语文案 —— 并且**完全不调用 `next()`**，所以这次拒绝不消耗任何上游 token。gate 答不上来时，默认的 `failMode: 'closed'` 用同样的形状拒绝，code 为 `CREDIT_GATE_UNAVAILABLE`；文案故意不同，因为告诉一个有钱的租户"额度已用完"会把它导向一个解决不了问题的页面。

调用期间每个 chunk 原样透传，并记住最后一个 `usage` chunk。可迭代对象结束之后 —— 正常 finish、抛错、以及消费者中途丢弃迭代器，三种情况都经过同一个 `finally` —— 用量被计价，`POST /gate/api/credit/charge` 以一个每次调用现铸的 UUID 记账。这个 POST 从不被流等待；gate 拒绝时 payload 转入 `$DSH_HOME/.sci/credit-spool.jsonl`，由倍增退避稍后排空。`duplicate: true` 视为扣费成功，这正是让重复排空安全的原因。

计价全程是 `BigInt` 整数运算，因为账本是整数微美元，浮点中间值会让同样的调用在不同机器上末位不一致。`inputTokens` 与 `cacheWriteTokens` 按未命中输入价、`cacheReadTokens` 按命中价、`outputTokens` 按输出价，各自四舍五入（半数进位）后求和，乘峰谷乘子做一次同样的舍入，再乘该行的 `ratioX1000` 使用倍率做一次。**`reasoningTokens` 不计价。** `packages/llm/llm-deepseek/src/translate.ts::mapUsage` 把 `completion_tokens` 直接映射成 `outputTokens`，并把 `completion_tokens_details.reasoning_tokens` 并列报出而**不做减法** —— 这是 OpenAI 兼容口径，reasoning 输出已经包含在补全计数里 —— 所以再算一次等于把每个 reasoning token 收两遍。峰谷按请求的**开始**时间取 UTC，依 gate 发布的表，起点含、终点不含；价目表若把窗口声明在别的时钟上会被拒收而不是当作 UTC 读，从而保留上一张表，而不是无声地算错每一笔。价目表里没有的模型按最贵的一行计价并标记 `unknownModel`；这里的最贵是在乘过该行的使用倍率之后比的，因为那个乘积才是这一行上的调用真正会被收的钱，只比标价会在标价低但倍率高时选错成便宜的一行。`ratioX1000` 表示平台在供应商标价之上加收多少 —— `1000` 即按成本转售 —— gate 供的行若没有这个字段就按 `1000` 读，因为按官方价转售是对它沉默的唯一安全解读。

每次计价追加一条带信封 `ignorable` 标记的 `sci/credit-charged`。它只是投影源 —— 模型读不到它，日志中它之后的内容不会因为它的存在被解释成别的样子 —— 存在的意义是让审计能把会话与账本对上，账本的 `ref` 就是 `req:<requestId>`。`./invariant` 伴生插件断言同一会话里没有两条记录共用一个 `requestId`，因为账本 UNIQUE 的 `ref` 会把两次计量调用塌缩成一笔扣费。

## Alternatives considered

**断言反方向 —— 每个带 usage 的 `assistant/message` 恰好对应一条 `sci/credit-charged`。** 否决，因为活的事件流判定不了：记录是在它计价的那个响应之后追加的，以 error finish 结束的调用会报告用量却根本不产生 `assistant/message`，未投递的扣费本来就会跨进程重启在 spool 里等着。这样断言会在正确行为上误报；这个检查的诚实形态是日志与账本之间的对账，gate 自己的 `ref` 索引已经支持。

**在产出终止 finish 之前等待扣费完成。** 否决，因为那会把一个网络往返和可能的重试链放在每一轮最后一个 chunk 之前，gate 一出故障就会卡住会话而不只是延后记账。spool 的存在就是为了让记账可以迟到而会话不变慢。

**把使用倍率折进存储价，或折进峰谷乘子。** 两条都否决。存加价后的价格会毁掉核对一笔争议扣费唯一的依据 —— 供应商的官方标价 —— 也就再没有东西能反推出加价。折进峰谷乘子省下一次舍入，却算出一个既不是标价也不是扣费的数：峰谷乘子 0.5、使用倍率 1.5 时，折成一个 0.75 会收 1 微美元，而分两步会收 2，且账本行说不清差额出自哪个因子。两个具名乘子按顺序作用、各自半数进位，才能让标价与加价从同一行分别复核。

**先乘价格、只舍入一次。** 否决：每分量舍入一次让求和的每一行都能只凭账本行复算，这才是让一笔有争议的扣费可以手算核对的前提。先乘会让舍入误差按分量累积，算出一个没人能复现的数。

**默认 fail-open。** 否决。fail-open 计量会在 gate 宕机期间给未付费租户无限量的算力，这才是真正花钱的故障；被拒绝的请求只花一次重试。`failMode: 'open'` 留给已经做出相反决定的部署，并且每 `degradedLogIntervalMs` 最多报告一次降级状态，避免一次故障被"每次模型调用一行"埋掉。

## Consequences

`sci` VM 在租户两个池都空了之后会拒绝模型调用，而每一次放行的调用都会留下一条按官方标价计的账本行和一条会话记录。拒绝文案点明充值页面，所以这个失败是可行动的而不是不透明的。`vmToken` 必填且无默认值：VM 编排把 `SCI_GATE_VM_TOKEN` 烧进容器的 Env，没有 gate 的部署应当从自己的 patch 层里删掉 `sci-credit` 这一行，而不是把 token 留空 —— 留空会以硬错误的形式加载失败，而不是悄悄什么都不扣。

既没到 gate 又没进 spool 的扣费会丢失。它会以 error 级别连同请求 id 与金额被报出，会话记录也标 `spooled: false`，但没有任何东西会去收它；README 列出了这一条与其余边界。spool 不取跨进程锁，所以共用一个 `$DSH_HOME` 的两个 harness 进程会各自排空它 —— 因为 gate 以 `requestId` 为幂等键所以无害，但并没有被阻止。

## Testing

包内测试逐秒覆盖峰谷边界（周一 00:59:59 对 01:00:00、周五 09:59:59 对 10:00:00、两个窗口之间的间隙、周六与周日落在窗口内）、分量与两个乘子各处的半数进位、使用倍率作用在峰谷之后而非与之合并、未列出模型的兜底行与全部比较分支（含被使用倍率改变了名次的那几支）、以及 reasoning token 口径 —— 用"与不带 reasoning 的同一次调用相等"来断言。gate 客户端在注入的 transport 上被固定：余额缓存时长、并发合并、失效、每一种畸形答案、以及非 UTC 价目表的拒收；spool 在真实文件系统上被固定：仅属主的权限位、并发追加、保持文件顺序的部分排空、截断尾行、以及不是"文件不存在"的读失败。监听器通过真实的 `llm/stream` waterfall（`ctx.llm.stream()` 背后一个 mock 适配器与真实的会话存储）被驱动：额度耗尽时不触及适配器的拒绝、两种 fail 模式、被节流的降级日志、chunk 透传、流中途抛错后仍然扣费、duplicate 应答、由驱动的退避投递出去的 spool 扣费、价目表启动拉取与其兜底、以及拉取中途拆除。gate 客户端还固定了：从供出的行里读 `ratioX1000`，以及行里缺这个字段时取默认值。另有一个 Loader 组合套件：对着一个真实的 loopback HTTP gate 引导 `cordis.yml`，不注入 transport、时钟、id 生成器或定时器，断言现铸的 UUID、按所供价目表 1.5 倍使用倍率算出的扣费，以及两条加载期拒绝。逐文件覆盖率 100%。
