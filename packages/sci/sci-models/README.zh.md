# dsh-sci-models

[English](README.md) | 中文

**机构决定它的成员可以调用哪些模型，本插件让这个决定落到每一次请求上。** 目录归 gate 所有 —— 平台级模型池、按机构勾选的子集、以及每一行的官方价（`12-Multi-Tenant/artifacts/sci-gate/`，不在本仓库内）。本包读取本租户的那一份，注册它点名的 CaMeL Hub 供应商路由，并拒绝目录没有开放的每一次模型调用。

## 目录

带 VM bearer token 的 `GET /gate/api/credit/models`，启动时读一次，之后每 `refreshMs`（默认 5 分钟）再读。每一行带 `model`、`displayName`、`providerLabel` 与 `route` —— `deepseek-official` 或 `camel-api`，它们同时就是 `ctx.llm` 的供应商路由名，于是 gate 的路由决定与 harness 的适配器选择是同一个字符串，而不是两套要靠人手对齐的词汇。缺 id 或路由不可达的行会被跳过；一行畸形不会连累其余。

读取失败**保留上一份目录**，因为清空它等于在 gate 抖动的一瞬间收回机构开放的全部模型。第一次读成功之前目录是 `undefined`，这与空目录是两个不同的答案：前者表示租户的勾选未知，后者表示确实为空；这段窗口里发生的调用由 `failMode` 决定（默认 `open`，因为付不起的调用 gate 本来就会拒）。

价格随同一个答案返回，这里刻意不读。浏览器的价签直接向 gate 取，`@deepseek-ai/dsh-sci-credit` 从 `GET /gate/api/credit/pricing` 取自己的价目表：一个模型多少钱有一个权威，租户能不能调用它有另一个。

## `camel-api` 路由

`camel-api` 路由上的行由 `CamelApiAdapter` 承接 —— 即挂着 `CaMeL Hub` 选择器名的 `DeepSeekAdapter`。之所以复用而不是重写，是因为 CaMeL Hub 说的是同一套 OpenAI 兼容 chat-completions 协议，连 SSE 分帧与计费所读的 usage 字段都一样；不同的只有端点、凭据、目录与展示名，而这四样本来就是该适配器按操作读取的输入。`providerInfo` 是唯一的覆写：基类写死了它当初面向的供应商，若在机构认作 CaMeL Hub 的路由上显示 "DeepSeek"，会把这条路由上的每个模型都归错供应商。

端点取自 `apiBaseEnv` 指名的环境变量（默认 `CAMEL_API_BASE_URL`），密钥取自 `apiKeyEnv`（默认 `CAMEL_API_KEY`），按请求经 `ctx.credentials` 解析、回落到启动环境。gate token 与端点都在加载时读取，**缺失即加载失败**，因为后面没有任何一步能补上它们。

目录里有该路由的模型时路由才注册，没有了就摘掉，于是选择器不会出现一个点开却是空的条目。适配器按操作重读目录，所以在已注册的路由上增删模型不需要重新注册。

## 白名单

一个 `llm/stream` waterfall 监听器在 `next()` 之前就拒绝目录没有开放的 `(provider, model)`，给出双语的 `MODEL_NOT_ALLOWED` 错误 finish 并点名该模型。`ctx.llm` 自己的模型目录只是参考 —— 它填的是选择器，并不拦请求 —— 所以直接点名模型的客户端本来可以绕过选择器显示的一切。

DeepSeek 内建模型与 CaMeL Hub 的模型同等受约束：机构取消勾选某个模型，就是决定了成员不得在它上面花钱，而这条路由恰好由 harness 自己注册并不改变这个决定。比较的是路由加模型名而非只有模型名：在 `camel-api` 上开放的模型不等于在 `deepseek-official` 上也开放，因为那是价格不同的两个端点。

任何目录都还没读到时发生的调用，在默认 `failMode: 'open'` 下放行，在 `closed` 下以 `MODEL_CATALOG_UNAVAILABLE` 拒绝。第二个 code 刻意不是 `MODEL_NOT_ALLOWED`：那个模型很可能是开放的，让用户去找管理员开通，等于把他推给一个已经开通过它的人。

## 配置

`gateUrl`（默认 `http://127.0.0.1:3079`）是发布目录的 gate。`vmTokenEnv`、`apiBaseEnv`、`apiKeyEnv` 指的是环境变量名而不是值本身：token 决定服务的是谁的目录，key 是密钥，两者都该和其他凭据一起放在容器的 Env 里。`refreshMs`（最小 1 秒）在"被收回的模型还能调用多久"与"每 VM 每周期一个请求"之间取舍；`requestTimeoutMs` 限定一次目录读取。完整字段表：[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-sci-models)。

## Model Experience

None, as the plugin registers no prompt, tool, or context of its own: the catalog reaches the user's model selector, and its refusal is an error finish raised out of the agent loop as an `LlmError` (`packages/core/agent-loop/src/agent.ts`) rather than a model-visible input.

#### KV Cache effect

放行的调用没有影响：不读也不改写任何请求字段，下一轮复用的供应商前缀与 loop 组装出来的逐字节一致。被拒的调用根本没有发出，所以既不产生前缀，也不作废任何前缀。

## Known Limitations and Deferred Work

- **取消勾选 DeepSeek 内建模型不会把它藏起来，只会拦住调用。** `@deepseek-ai/dsh-llm-deepseek` 注册自己的三个模型，本包不去改别的插件的注册，所以机构关掉的模型仍会出现在选择器里、选中后才失败。要藏起来需要 `ctx.llm` 提供一个它现在没有的供应商目录过滤接缝。
- **目录改动在 `refreshMs` 之内、而不是立刻到达运行中的 VM。** 机构后台新增或收回的模型，最迟一个刷新周期后才可调用或被拒；gate 不推送变更通知，缩短这个窗口的代价是每 VM 每周期多一个请求。
- **一个租户的所有 VM 看到同一份目录。** bearer token 标识的是租户而不是成员，按人分配模型需要在这次读取上换一种凭据。
- **价格由别的消费者读取，不在这里。** 若某个 gate 供了目录却没供价目表，鉴权仍然正确，价格则由 `dsh-sci-credit` 用内建官方价兜底；本包不会察觉这两者不一致。
