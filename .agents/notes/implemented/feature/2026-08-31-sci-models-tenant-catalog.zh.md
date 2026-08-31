# Agent Note: `dsh-sci-models` makes the institution's model selection reach the request

Status: implemented

[English](2026-08-31-sci-models-tenant-catalog.md) | 中文

## Problem

`sci` 这套部署卖的不止 harness 自己注册的三个 DeepSeek 模型，买席位的机构希望能说清它的成员可以在哪些模型上花钱。这个决定现在归 gate 所有 —— 一个带官方价的平台模型池，加上按机构勾选的子集 —— 而 harness 里没有任何东西读它。一台 VM 服务的恰好就是它自己的 composition 注册了什么，端点也是那个插件被配到哪里；机构在后台关掉一个模型，对成员能调用什么毫无影响。

过滤模型选择器堵不住这个口子。`ctx.llm` 的目录只是参考：它填的是选择器，并不拦请求，所以直接点名模型的客户端无论选择器显示什么都能到达供应商。读目录的那个东西，必须同时坐在调用上。

## Decision

`@deepseek-ai/dsh-sci-models` 在一个挂载上下文里拥有三项贡献。

它在启动时、以及此后每 `refreshMs`（默认 5 分钟）带 VM bearer token 读一次 `GET /gate/api/credit/models`。每行带 `model`、`displayName`、`providerLabel` 与 `route`，其中 `route` 是 `deepseek-official` 或 `camel-api` —— 与 `ctx.llm` 的供应商路由用同一批字符串，于是 gate 的路由决定与 harness 的适配器选择是同一套词汇，而不是两套要靠人手对齐的。读取失败保留上一份目录，因为清空它等于在 gate 抖动的一瞬间收回机构开放的全部模型；第一次读成功之前目录是 `undefined`，这与空目录是两个不同的答案。

`camel-api` 路由上的行由 `CamelApiAdapter` 承接，它就是只覆写了一处的 `DeepSeekAdapter`。CaMeL Hub 说的是同一套 OpenAI 兼容 chat-completions 协议，连 SSE 分帧与 `dsh-sci-credit` 计价所读的 usage 字段都一样；而端点、凭据、目录与请求上限本来就都是该适配器按操作读取的输入，经本包提供的 `options()` thunk 解析。只有 `providerInfo` 必须改：基类写死了它当初面向的供应商，若在机构认作 CaMeL Hub 的路由上显示 "DeepSeek"，会把这条路由上的每个模型都归错供应商。端点与密钥来自 `apiBaseEnv`、`apiKeyEnv` 指名的环境变量；密钥按请求经 `ctx.credentials` 解析、回落到启动环境，端点与 gate token 在加载时读取、缺失即加载失败。目录里有该路由的模型时路由才注册，没有了就摘掉，于是不会有一个点开却是空的选择器条目；又因为适配器按操作重读目录，在已注册的路由上增删模型不需要重新注册。

鉴权是一个 `llm/stream` waterfall 监听器。目录没有开放的 `(provider, model)` 在 `next()` 之前就被拒绝，给出点名该模型的双语 `MODEL_NOT_ALLOWED` 错误 finish，因此这次拒绝不花任何供应商 token。比较里包含路由而不只是模型名：在 `camel-api` 上开放的模型不等于在 `deepseek-official` 上也开放，因为那是价格不同的两个端点。DeepSeek 内建模型同受此规则 —— 机构取消勾选某个模型，就是决定了成员不得在它上面花钱，而这条路由恰好由 harness 自己注册并不改变这一点。任何目录都还没读到时发生的调用，在默认 `failMode: 'open'` 下放行，在 `closed` 下以专用的 `MODEL_CATALOG_UNAVAILABLE` 拒绝。

价格随同一个 gate 答案返回，这里刻意不读。`dsh-sci-credit` 从 `GET /gate/api/credit/pricing` 取自己的价目表，浏览器的价签直接读目录端点：一个模型多少钱有一个权威，租户能不能调用它有另一个。

## Alternatives considered

**在本包里写一个最小的 OpenAI 兼容适配器。** 读过 `DeepSeekAdapter` 的构造之后否决：它的连接事实来自按操作调用的注入 `options()` thunk，密钥来自注入的解析器，目录来自同一份事实，所以它身上除了 `providerInfo` 里的供应商名之外没有任何东西绑定 DeepSeek，而那个名字用子类三行就能覆写。再写一个适配器等于重新实现 SSE 解析、`dsh-sci-credit` 计价所依赖的 usage 映射、请求图片卸载与重试策略 —— 而且这四样都会逐渐漂移。

**靠过滤 `ctx.llm` 供出的模型目录来鉴权。** 否决，因为那份目录不拦任何东西。它是给选择器读的，点名模型的请求不查它就能到达适配器，所以过滤只会做出一个"界面藏起来、API 调用照样花钱"的假象。

**把白名单折进 `dsh-sci-credit` 已有的 `llm/stream` 监听器。** 否决：那个监听器判断租户付不付得起，这个判断租户有没有资格，两个答案来自 gate 的不同端点、走不同的刷新节奏。有的部署要计费但没有目录（没有机构后台），有的要目录但不计费（包年席位）；合并会让两者都无法单独成立。

**`camel-api` 路由注册一次，目录没有模型时就让它空着。** 否决：`registerAdapter` 确实接受空路由集，但一个没有模型的已注册路由，就是用户点开却什么也没有的选择器条目。摘掉注册就摘掉了条目，而代价只是在一个以人的节奏发生的变更上多走一次注册表事务。

**像 `sci-credit` 那样把 gate token 当字面配置值收。** 对本包否决：这个值决定服务的是谁的目录，该和 CaMeL Hub 密钥一起放进容器的 Env，而后者是密钥、根本不可能写成配置字面量。两者都用环境变量名，这一行才有统一的规矩。与 `sci-credit` 的 `vmToken` 不对称是已知的，留给以后收拾那个包时一并处理。

## Consequences

机构的模型勾选现在落到了请求上：它关掉的模型会在模型边界被拒，句子里点名该模型与两条能解开它的动作；它在 CaMeL Hub 上开放的模型，会在一个刷新周期内变成一个背后有可用路由的选择器条目。挂载本包的部署必须在 VM 环境里提供 `CAMEL_API_BASE_URL` 与 `CAMEL_API_KEY`，否则插件加载失败；这是刻意的，因为一份调不动的目录比一个拒绝启动的容器更糟。

取消勾选 DeepSeek 内建模型不会把它藏起来。`dsh-llm-deepseek` 注册自己的三个模型，本包不去改别的插件的注册，所以被关掉的内建模型仍会出现在选择器里、选中后才失败。README 记下了这个缺口与另外三条边界：目录改动在 `refreshMs` 之内而非立刻到达运行中的 VM；一个 bearer token 意味着一个租户的所有 VM 看到同一份目录；以及若某个 gate 供了目录却没供价目表，这里不会察觉。

## Testing

包内测试在注入的 transport 上固定目录读取 —— URL 与 bearer 头、容忍的结尾斜杠、一行可以省略的两个标签、每一种被跳过而不连累整份答案的畸形行、空勾选与读不出来的区别，以及每一种读不出来的答案，含非 2xx 状态与不可达的 gate —— 并用假调度器固定这份会刷新的副本：第一次成功之前没有目录、后续读取失败时保留上一份、以及每次尝试之后都重新上定时器，使一次故障不会终止刷新。路由固定了"有第一个模型才注册""最后一个模型没了就摘掉"与拆除；凭据解析固定了"存储优先于环境""回落到环境"与 `MISSING_CREDENTIAL`。白名单通过 `ctx.llm.stream()` 背后真实的 `llm/stream` waterfall 与一个 mock 适配器驱动，断言被拒的调用根本不触及适配器，以及 DeepSeek 内建模型与 hub 模型被同样拒绝。另有一个 Loader 组合套件：对着一个真实的 loopback gate 与一个真实的 OpenAI 兼容端点（`@deepseek-ai/dsh-llm-mock-server`）引导 `cordis.yml`，不注入 transport 也不注入调度器，断言 gate 看到的 bearer、composition 发布出来的 `CaMeL Hub` 供应商、一次带着环境里的密钥与目录中模型抵达端点的真实调用，以及一次根本没到端点的拒绝。逐文件覆盖率 100%。
