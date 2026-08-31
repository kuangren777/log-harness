# @deepseek-ai/dsh-client-ui-sci-conversation

[English](README.md) | 中文

CaMeL Science 对对话流的读法：每次工具调用一张统一的卡片、委派类调用的展开体是实时的智能体星系、每轮产出一行文件芯片、会话头一个打开它们的按钮，以及一层只用 token 的换肤。所有画出来的贡献都落在 [ui-conversation](../ui-conversation/README.zh.md) 已经拥有的槽位里，唯一不画东西的那项——模型菜单的价格行——是一次登记，由它的持有者在 dispose 时交还，因此把本包从 cordis.yml 里撤下就原样恢复出厂的对话流。契约见[槽位系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

工具卡占用 [ui-tool](../ui-tool/README.zh.md) 的 `tool.call.frame`——包住整次调用的那个单占位座位。这个座位之所以存在，是因为另一条路走不通：遮蔽 `tool-call` Chat Node 条目会连它的 `children` 声明一起遮蔽，而一个子槽位只允许一个声明者，于是遮蔽方永远无法重新声明 `tool.call.toolview`，所有专属视图都会停止渲染。占用外框则把那次分发留在 ui-tool 内，由它把已经渲染好的专属视图作为 `body` 交给这张卡片——工作台因此重做了每一次调用的外观，而没有顶掉其中任何一个。

芯片行以 `priority: -10` 注册进 `conversation.chat.turnTail` 这条 chain，低于 [ui-deliverables](../ui-deliverables/README.zh.md) 的默认 `0`，因此先被试；chain 只会选出一个胜者，这正是芯片替换掉那个包的产出文件行而不是与它并列的原因。它的认领是两份 Turn 作用域读数的并集而非二选一：Deliverables 知道这一轮落地的每一次改写（按渲染意图而非工具名判定），本包自己的 `sci-artifacts` Turn 数据知道那些不经改写卡片的交付与 Office 导出。研究者说「产出」时指的是两者，所以任一非空即认领，并按「改写在前」的顺序全部列出。

第二份读数来自本包在此注册的一个 Turn 作用域 `ConversationNodeDefinition`，发布用的 key 是 `sci-artifacts`——装配器要求一个 Definition 的 Location key 必须等于它自己的 kind，所以两者是同一个常量。它折叠一轮里已结束的 `deliver_files` 与 `univer_export` 调用——把每个 `tool/result` 配回那次给出文件名的 `tool/call`，因为结果事件只带结局、从不带参数——并把结果作为 Turn 数据发布。它自身不渲染任何节点。

卡片头刻意保持统一——图标、名称、参数摘要、耗时、状态——因为研究流是被扫读的。名称取自 [ui-sci-files](../ui-sci-files/README.zh.md) 的 `toolDisplayName`，所以卡片与详情面板对同一次调用的读法天然一致，本包只额外提供图标。摘要取调用参数里的第一个字符串字段并压成一行，本仓库的每个工具都把主语放在那里。耗时取已结束调用自己的两个时间戳，运行中则是逐秒推进的活秒表——秒表只在该调用仍在途时存在，因此已归档的会话不挂任何定时器。

星系取代 `subagent` / `workflow` 卡片的展开体，它的成员来自 Chat Location 索引而不是扫描：已结束的 `tool-result` 节点自身不带轮次，`chat.locations.getTurn(turn)` 是这一轮兄弟委派唯一存在的地方，而寻址所需的轮次号由外框 owner 提供。每一行的名称读自调用参数（`subagent` 的 `description`，`workflow` 的 `meta` 身份块），读不到时退回工具自己的名词。表头给出该轮的耗时与输出 token 合计；每个智能体的 token 列只在至少有一个结果真的报了用量时出现——一整列破折号等于宣称面板知道它并不知道的事。

换肤是一个与插件同生命周期的 `<style>` 元素，手法与 [ui-brand-sci](../ui-brand-sci/README.zh.md) 的动效基座相同。每条规则都选择出厂对话流有意写出的稳定 `data-*` 属性，然后重定义那个界面本来就在读的 token；不针对任何 CSS Module 类名，也不出现任何字面色。它依赖的属性列在「Known Limitations」里。

第六项贡献不占任何座位。composer 的模型菜单属于 [ui-model-selection](../ui-model-selection/README.zh.md)，它为自己的模型行接受一个 hint 来源，本包注册的就是给这些行标价的那一个：对页面同源发起、带 cookie 的 `GET /gate/api/models`，也就是当前浏览器登录的那个机构在 sci-gate 上的模型目录。每一条有价格的行会变成它所指模型上的一到两行——按每百万 token 的美元、保留四位小数给出的输入价、输出价与缓存命中价；只有当机构的转售倍率不是 1.000 时，才追加那个倍率以及它实际收取的价格。行里的 gate `route` 直接当作客户端的提供方 id 使用，那正是 `dsh-sci-models` 注册同一批模型时用的字符串，因此不存在需要人工同步的映射表。这条注册待在它自己的 `ctx.inject` 分叉里，而不进本插件的依赖声明：没有模型菜单的组合只是少了价格行，别的照旧；而 gate 不可达、会话不被认可、答案不是一份目录，这三件事到达菜单时是同一个结果——没有价格。

`/client` 的导出只有插件体（`apply`/`inject`）——组件与推导都留在槽位注册之后的包内。

## Model Experience

None，本包是纯浏览器侧的呈现层，Node 半边只是一个惰性 loader 座位：不注册任何工具、提示词段落或会话事件，它画出来的一切都在渲染期从浏览器本就持有的会话快照推导而来。

#### KV Cache effect

None；本包既不组装也不发送任何模型请求。

## Known Limitations and Deferred Work

- **已结束的委派，其星系会自行停表。** 活时钟属于自身调用仍在运行的那张卡片，因此一张已经结束、而兄弟委派仍在跑的 `subagent` 卡片，只会在会话发布下一次快照时刷新。轮次运行期间快照是连续的，所以可见影响仅限于收尾的空闲阶段。
- **位置未解析的委派调用，其展开体仍是普通工具视图。** 星系需要轮次号才能寻址兄弟委派，而引擎无法解析位置的 Chat Node 报不出轮次；这类调用渲染它自己的工具视图，而不是一块空看板。
- **换肤依赖出厂对话流的九个属性。** `[data-phase]`（对话根节点，也是 `--dsh-chat-content-width` 的声明处）、`[data-phase='hero']`、`[data-chat-flow-kind='user']` 与 `[data-chat-flow-kind='steering']`（节点座位）、`[data-chat-flow-kind='assistant-step']`、`[data-chat-flow-kind='tool-call']`（连续的该座位围绕本包自己的 `[data-sci-tool-card]` 融合为一张视觉卡）、`[data-turn-tail]`、`[data-composer-card]`（输入卡片）。其中任何一个被改名或去掉，读它的那条规则就会静默失效；CSS 没有任何机制让这件事报错。输入框那条规则把 `--dsw-alias-button-info-fill` 与 `--dsw-alias-button-info-hover` 限定在卡片内重定义，因此卡片内其他读这两个 token 的元素也会一并变成渐变。
- **价格行是标价，且每次模型菜单挂载只读一次。** 同一份 gate 答案里发布的峰谷时段表是对这些数字的、随时钟变化的折扣，本包有意不引用它——随小时变化的价格会被读成模型的价格；当前这一分钟真正的计费口径在 credit 流水里。这里没有任何轮询，因此机构改的费率要等菜单下一次挂载才会到达已经打开的页面。
- **`subagent` 结果里的 token 数是乐观读取的。** 面板会在已结束的委派上找 `meta.usage.outputTokens`，因为子运行的用量如果存在就该在那里；wire 契约并不强制它，所以在不上报用量的部署上整列 token 会直接消失，而不是显示为零。
