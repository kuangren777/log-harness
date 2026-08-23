# Agent Note: Per-skill invocation policy from the user settings document

Status: implemented

[English](2026-08-22-skill-policy-overrides.md) | 中文

## Problem

一个 skill 的两个调用接口过去完全由其作者决定：`disable-model-invocation` 与 `user-invocable` frontmatter，或运行时贡献传给 `register()` 的策略。用户若想把某个随包发布或共享的 skill 移出模型目录——或把某个吵闹的 skill 移出自己的 `/` 菜单——就必须去改一个未必归自己所有的文件，而随包发布的 skill 根目录根本无法编辑。[分层发现](2026-08-22-layered-skill-discovery.zh.md)扩大了一次会话能看到的根目录集合，这让缺口更明显，而不是更小。

## Decision

`SkillRegistry` 拥有 `skills` 这一用户设置命名空间：一个以 skill 名称为键的字典，条目携带可选布尔字段 `model` 与 `user`。出现的字段替换对应接口，缺省的字段沿用作者声明的值，`applyPolicyOverride(authored, override)` 是唯一的解析器。设置优先于 frontmatter。

命名空间归注册表所有，因为每个消费方读取的策略决定由它做出。注册走 `ctx.inject(['settings'], …)`，即可选设置的规范接线方式：从未挂载设置服务就意味着作者声明的策略成立，且不会有任何失败。`validate` 钩子会拒绝不是合法 skill 名称的键——schema 无法表达这套语法，而拼错的键否则会被存成一条永远匹配不到任何 skill 的覆盖。

键只用 skill 名称，是因为层合并已经为每个名称裁决出恰好一个胜出者，因此一条条目就能指向观察者实际看到的那个贡献。于是覆盖在 `collectFresh` 末尾应用于合并后的胜出者，并在 `get()` 加载定义时再次应用，使得在定义上执行接口检查的消费方看到的正是目录所宣告的内容。`IndexedCandidate` 在提供方自有的候选对象旁携带生效策略，而不是改写它：提供方契约承诺 `get()` 收到的正是 `list()` 返回的那个候选项。

每次提交变更都会使 collect 缓存失效并发出 `skills/change`；不携带任何覆盖的挂载或卸载不改变任何东西，因此保持静默。`dsh-tool-skill` 无需改动代码：它的下一次 pre-step 会重算快照，digest 不同，于是追加一条完整的替换目录。

`SkillRegistry.inventory()` 按来源分组报告全部已发现候选项——层、source、rank、根目录——最近的层在前，并包含目录隐藏的被遮蔽落选项，每一项都携带作者声明的策略、生效策略、覆盖以及 `shadowed` 标记。它之所以存在，是因为编辑调用策略的用户需要看到有哪些 skill 存在、某个条目为何没有胜出，而只含胜出者的目录回答不了这个问题。

## Behavior matrix

| 已存储的覆盖 | 模型目录与 `skill` 工具 | 用户命令菜单与 `/name` 手势 |
|---|---|---|
| `{ model: false }` | 隐藏；对该名称的调用被拒绝 | 列出并注入 |
| `{ user: false }` | 列出且可加载 | 不出现；`/name` 保持为普通文本 |
| `{ model: false, user: false }` | 隐藏 | 隐藏 |

## Wire surface

浏览器通过一条 unary RPC `skill.inventory({ sessionId })` 读取 inventory（清单），其应答走的是与 `skill.list` 相同的「会话 → cwd／scope」解析（`packages/host/apiproxy/src/api-proxy.ts` 中的 `skillViewFor`）：会话头里的项目根目录，加上存活 agent 的 scope，否则退到已记录 preset 的常驻键；全程不创建也不恢复任何 Agent。`packages/host/apiproxy/src/api/skills.ts` 中的 wire 类型逐字段重述注册表的报告，而不是转发导出它——因为 `api/` 可被浏览器导入，不得把一个 Host 服务包拖进 Client 程序；其中 `source` 放宽为 `string`，因为宿主的来源词汇是开放的，客户端遇到不认识的分组应当照常渲染，而不是对它做分支。

`skill.list` 未做改动：它仍是 composer `/` 菜单所读的、带缓存且按用户可调用过滤的来源。这一拆分对应两个问题——一个回答「什么可以被调用」，另一个回答「存在什么、以及它为何没有胜出」。

`skill.inventory` 加入 `packages/client/connection/src/index.ts` 的特权方法集合。它投射已存的 `skills` 设置分节，以及各 skill 被发现时的绝对路径，因此它应当与 `settings.describe` 并列：它读取的正是后者所辖 namespace 的一个切片，而写入这个开关的 `settings.mutate` 也在同一集合内。`skill.list` 保持不钉：它既不含路径也不含覆盖，而 composer 的菜单不是配置面。

`skills/change` 加入 `API_REMOTE_FORWARDED_EVENTS`，这正是让一次开关无需刷新即可可见的原因——也是该事件迄今的第一个消费方。由于它既不点名会话也不点名 skill，`dsh-client-ui-skill` 在收到它时丢弃全部缓存目录，下一次 `/` 重新拉取。转发它要求 `@deepseek-ai/dsh-skill` 提供一个 client-safe 的 `./types` face：`$on` 的键集是**消费方**编译面里的 `keyof Events`，而该声明此前住在仅限 Host 的 `index.ts` 中。

## Browser Skills section

`@deepseek-ai/dsh-client-ui-settings-skills` 注册自己的 `settings.section` 条目，id 为 `skills`，order 为 12——夹在 order 10 的 Models 与 order 15 的 Plugins 之间。它刻意不做成 Plugins 里的一个标签页：那个分区投射的是 Cordis Loader 清单，报告的是部署挂载了什么，而这里编辑的是会话所在项目发现了什么的策略。两份列表互不包含，而且用户要找一个 skill，也不会想到去「插件」标题下面翻。

本页由当前会话寻址，因为发现是从该会话的工作目录解析出来的，而设置是一个根级界面，自身没有会话。没有当前会话时无从寻址，因此本页停在一个有说明的空视图上，而不是列出一份陈旧的项目清单。分组严格按 `inventory()` 返回的顺序由近及远渲染——本分区不添加自己的排序——每个来源的标题取自一张以宿主分组值为键的封闭表，取不到时回落为原始字符串；这正是 wire 面把 `source` 放宽为 `string` 那个决定在客户端的另一半。

一行被标为「已覆盖」的判据是它的条目带有 `override`，而不是生效策略与作者声明的策略不同。「存在即覆盖」正是设置界面其余部分已经在读的规则（`SettingsScopeSnapshot.user` 记录的是原始用户层，其中标记一个字段被覆盖的是它的存在，而非它的取值），而且只有这种读法才能让「恢复默认」保持可达：取值恰好等于作者声明值的覆盖，仍然是一条已存储的条目，按取值比较会把它困在文档里且没有任何入口能清除。「恢复默认」就是 `scope.unset(name)`；一次开关则是 `scope.set(name, { ...storedOverride, [surface]: next })`，之所以展开已存条目，是因为一条条目同时携带两个调用面，局部补丁会静默丢弃用户没有碰过的那个决定。

本页不做乐观渲染。写入落定后它重读 `skill.inventory`，因此行上显示的始终是 Host 解析出的结果，而不是这次点击想要的结果。它同样在转发的 `skills/change` 与 `connection/reset` 上重读，两者都设有「已加载」守卫：用户从未打开过的页面停在 `idle`，后台失效不会花掉任何一次 RPC。会话列表源也被监听，但只有当前会话真的发生变化时才触发重取——该源同时还会发布最近使用与后台任务的变动，这些不该各自花掉一次 wire 调用。被遮蔽的行渲染为只读，因为对落选者设置覆盖，寻址的是一个已被更近定义占用的名字。

## Alternatives considered

**让设置段改写 frontmatter 文件。** 已否决：随包发布的只读根目录无法编辑，而会改动共享源文件的用户覆盖，会毁掉它本要覆盖的那个作者声明值。

**按 source、根目录或绝对路径作为覆盖的键。** 在没有当前消费方的情况下否决：用户实际操作的界面——目录、`/` 菜单、`skill` 工具——都以名称寻址 skill，而合并保证每个名称只有一个胜出者。路径键还会在更近的层接管该名称的那一刻失效。

**让每个接口的覆盖有三态（`allow`／`deny`／`inherit`），而不是可选布尔。** 已否决：键缺省本身就表示继承，而存储一个 `inherit` 标记只是第二种「什么都不说」的写法。

**在每个消费方而不是注册表中应用覆盖。** 已否决：`dsh-tool-skill`、命令菜单以及未来任何消费方都得各自读取该配置段并以完全相同的方式组合，一旦某个消费方遗漏，就会静默暴露用户已禁用的 skill。裁决应当落在解析该策略的那个操作里。

**在注册表中缓存已解析的配置段。** 已否决：`scope.get()` 本身就是已解析值，第二份副本还需要自己的失效机制才能保持诚实。

## Testing

`packages/skill/skill/tests/skill.spec.ts` 覆盖了：没有设置服务时的作者声明策略、两个单接口覆盖在 `list()` 与 `get()` 上的表现、提交变更时的通知与重解析、键拒绝、服务释放后的恢复、不携带覆盖的静默挂载与卸载，以及带 `shadowed` 与覆盖回显的 inventory 分组。`packages/skill/tool-skill/tests/tool-skill.spec.ts` 覆盖了追加的替换目录、被拒绝的工具调用，以及仍然生效的 `/name` 注入。无密钥的 `skill-policy-override` ACP 快照钉住了组装后的 transcript（文本记录）：模型的 `skill` 调用返回 `Error: skill "snapshot-skill" is not available for model invocation`，没有任何 `<available_skills>` 块宣告该 skill，而下一轮的 `/snapshot-skill` 手势注入了它的正文。在 wire 面，`packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts` 覆盖 `skill.inventory` 的会话解析、原样分组、缺省可选字段的省略、preset 挂载的注册表，以及被拒绝的发现；`rpc-schemas.spec.ts` 与 `fetch-carrier.spec.ts` 钉住请求／值 schema 与往返；`packages/client/connection/tests/node-half.host.spec.ts` 钉住它与 `skill.list` 的特权分野；`packages/client/ui-skill/tests/browser-plugin.client.spec.ts` 证明转发的 `skills/change` 会清空全部缓存目录。

在浏览器面，`packages/client/ui-settings-skills/tests/` 覆盖了注册（id、order、跟随语言的标签 thunk、注入的 face，以及释放两个失效监听的 teardown）、控制器（按会话寻址的读取、被更新读取取代的成功与失败都不回写、覆盖合并、写入后重读、由 scope 快照决定的可写性，以及当前会话变化时的重取），以及分区本体（分组与根目录、不认识的来源按原样渲染、两个开关对生效策略的反映、覆盖标记及其重置、被禁用的遮蔽行、发现不完整的提示、只读姿态，以及无会话与空清单两种视图）。`apps/web/tests/skills-settings.e2e.ts` 是组装后的完整历程：真实宿主发现预置的项目根与用户根，被遮蔽的落选者渲染为禁用，一次 Model 开关落到 `$DSH_HOME/settings.yaml`，而另一个调用面保持作者声明的值，随后「恢复默认」移除该条目。加入它需要在 `apps/web/tests/scaffold.ts` 里钉住 `DSH_CLAUDE_HOME`——该测试道已经钉住了 `DSH_HOME`、`DSH_AGENTS_HOME` 与 `DSH_BUNDLED_SKILL_DIR`，于是开发者真实的 `~/.claude/skills` 是最后一个仍能进入每条历程的发现根，而一份整对话框的 golden 会把它记录下来。

## Consequences

用户可以在一个文档里重新调校任意已发现 skill 的两个接口，包括位于自己无写权限根目录中的 skill。目录保持诚实的代价是每次开关翻转追加一条替换消息；而且一次翻转会使全部已缓存目录失效，而不是只失效受影响的那个名称——因为携带策略的正是合并后的目录。覆盖会静默累积：指向已不存在 skill 的条目会留在文档中，合法但无效，直到 `inventory()` 或用户注意到它。
