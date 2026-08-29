# @deepseek-ai/dsh-client-ui-sci-search

[English](README.md) | 中文

CaMeL Science 的文献检索面：全屏「检索」视图、指向它的图标轨按钮，以及 `literature_search` 调用在研究流里画出的那一行。三条注册全部落在本包并不拥有的三个座位上——ui-layout 的 keyed `view`、[sci 外壳](../ui-sci-shell/README.zh.md)的 `rail.item`、[ui-tool](../ui-tool/README.zh.md) 的 keyed `tool.call.toolview`——因此把本包从 cordis.yml 撤下时，视图、按钮与卡片一起消失，其他任何界面都保持原样。契约见[槽位系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

与线路打交道的只有 `src/client/index.ts` 一处，而且命名空间的整个生命周期都归它。`apply` 自己挂载宿主生成的 Remote 契约——`ctx.remote.$mount(literatureRemote)`，在任何注册之前 await——因为 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.zh.md) 是每个 profile 都要启动的基础组装，只属于科研侧的命名空间不该进那个包。挂载的 disposer 挂在本 fiber 的一个 effect 上，所以把这一行从 cordis.yml 撤下时命名空间随之消失。同理，`inject` 里有 `remote` 却**没有** `remote.sci.literature`：一个 fiber 注入它自己 apply 提供的服务就永远不会激活——线上正是这样坏过一次（`pending (waiting for service: remote.sci.literature)`）。因此命名空间用 `ctx.get('remote.sci.literature')` 读取，而不是 `ctx.remote['sci.literature']`：可追踪服务代理会把那次属性读取转发到同名的 context 属性，而 context 属性只对注入过它的 fiber 解析得出。

注入面把这些信封转成 `src/client/contract.ts` 声明的纯记录与完备结局，所以任何组件都见不到 RPC 错误。四个源全部失败会作为一个错误码抵达，读不出的历史会作为空芯片条抵达，万一命名空间没挂上则作为 `LITERATURE_REMOTE_UNAVAILABLE` 抵达——三者都渲染为陈述出来的事实，而不是事件处理里的一次抛出。

屏幕上的每个数字都读自宿主返回的结果：命中条数、耗时秒数、被引次数、来源错误。hero 只写它真正检索的四个源，不宣称任何库容。没有年份、期刊、被引、摘要或开放获取 PDF 的记录，就少画那一行，而不是显示占位——对话流里的那一行同样如此，并且会逐字段校验宿主算出的 `result.meta`，形状不符时留空座位，交回通用工具卡。

store 只保存整个视图必须一致的四件事：检索词、这次检索的状态、settled 的结果、宿主记住的历史查询——所以从研究流绕一圈回来看到的仍是同一批结果，而不是空 hero。只有单张卡片知道的事（摘要是否展开、上一次复制是否成功）留在那张卡片自己的状态里。「复制引用」写入 `src/client/bibtex.ts` 渲染的 BibTeX 条目，cite key 为 `<第一作者姓><年份>`，TeX 的分组花括号一律转义，并明确告知剪贴板是否接受。「在研究流中深入」会连接当前会话所属的 Workspace（没有则用最近的那个），把点名该文献的提示词预填进那个会话的输入框，然后把框架切到对话视图——只预填，不发送。

样式一律走 token，写在 CSS Modules 里；唯一的装饰动效带 `data-sci-motion`，让 ui-brand-sci 的减弱动效规则只停掉它，不波及页面上其他动画。`SciLogo` 是本包从 [ui-brand-sci](../ui-brand-sci/README.zh.md) 引入的唯一符号，`CONVERSATION_VIEW` 是从 ui-layout 引入的唯一符号，两行都以 `dsh.client.external` 声明为模块图请求。`/client` 的导出只有插件体（`apply`/`inject`）。

## Model Experience

None，本包是纯浏览器侧的检索面，Node 半边只是一个惰性 loader 座位：不注册任何工具、提示词段落或会话事件，它画出的每个事实都由 `sci-literature` 宿主包算出——`literature_search` 工具及其 Model Experience 归那个包所有。

#### KV Cache effect

None；本包既不组装也不发送任何模型请求。

## Known Limitations and Deferred Work

- **记录类型仍是镜像的，不是 import 来的。** `src/client/contract.ts` 复述了规格 §2.1 的 `LiteratureRecord`/`LiteratureSearchResult` 词汇，`src/client/index.ts` 复述了其上的三个端点签名；因此宿主侧改名会以「卡片看起来不对」的形式抵达本包，而不是类型错误。挂载已经把生成的契约作为值 import 进来，其声明也随之进入本次编译，所以把两处镜像换成 `@deepseek-ai/dsh-sci-literature/types` 只是一次机械跟进，而非被卡住的事。
- **生成的契约连同 zod 一起被打进包里。** `lib/client.js` 内联了挂载所需的编解码器（约 180 kB，与基础的 `dsh-api-remotes` 客户端产物同一形状、同一量级——那个包也内联了自己的一份）。组合这一行的 profile 要多付一份该运行时的拷贝；要共享就得把线路编解码器做成模块表的一行，那是超出本包的决定。
- **检索框只发送查询词。** 宿主接受 `yearFrom`、`yearTo`、`limit`，本视图一个都不发，因此每次检索都用宿主的默认窗口。年份筛选是另一个控件，带着它自己的空态与校验问题；本次发布只交付设计稿画出的那一个输入框。
- **全军覆没时只报一个错误码，而不是四条原因。** 单源失败只在 settled 的检索里抵达视图，列在结果头之下；四个源全部失败时宿主只抛一个错误，错误框就只陈述这件事与那个码，四条各自的原因留在宿主日志里。
- **最近查询属于宿主，不是会话投影。** 浏览器里的检索没有会话，所以这份历史是宿主上的本机状态而非日志投影：它不会重放，换一台宿主就是另一条芯片条。
- **剪贴板是浏览器的。** 非安全源没有 `navigator.clipboard`，此时卡片会说复制失败，而不是悄无声息；手动选取条目仍是兜底方案——本包不提供引用弹窗。
