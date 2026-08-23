# Agent Note: 组权限的强制 —— 每个 domain 在何处裁定，以及无规则的组保留什么

Status: implemented

[English](2026-08-23-group-permission-enforcement.md) | 中文

## Problem

auth seam 交付了一套规则词汇 —— `skill`、`tool`、`model`、`settings-section`，在 principal 所属组规则的并集上按 deny > allow > 默认拒绝求值 —— 却没有任何地方去读它。部署可以写下规则，然后眼看着每一条都毫无作用：编辑器仍然列出全部技能，模型的目录里仍然是全部技能，每个 agent 仍然解析出全部工具，每条路由都可选，配置平面仍然回答每个命名空间。`notifyAddedToGroup` 模板没有调用方也是同一个原因：没有任何界面会改动组成员。

在规则能够治理任何东西之前，必须先回答两个问题。第一，每个 domain 在**哪里**裁定：当直接或替代调用方能抵达执行器时，列表投影里的一次过滤不算强制。第二，一个没有任何规则的组意味着什么，因为 `evaluate` 的默认拒绝回答"什么都没有"，而新建的组恰恰不带规则。

## Decision

**没有任何规则涉及的 domain 属于未治理，其中的一切放行。** `permits` —— 每个 Consumer 调用的入口 —— 现在在 `evaluate` 之前先跑 `governs(rules, domain)`，当 principal 的整个规则集合中没有规则提到该 domain 时直接放行。`evaluate` 的默认拒绝代数原封不动，因此已被治理的 domain 仍是精确白名单，而想要未经旁路答案的管理界面（例如预览某个组授予了什么）依然直接调用 `evaluate`。

另一种读法"没有规则的组什么都拿不到"，会让这个特性在管理员唯一可行的操作顺序上无法使用：创建组是第一步，而它会立刻把每个技能、工具、模型路由与设置分区从成员手中拿走。它还让每一次授予的范围变得无界 —— `allow skill:onboarding` 将不得不附带枚举该组仍然需要的每个工具、模型与命名空间。按 domain 显式开启，使一次授予始终只是对它所指名的那个 domain 的收窄，而这正是管理员写下它时的本意。

**每个 domain 在做出该决策的操作中强制。**

- `skill`，请求侧 —— `api-proxy.ts` 中的 `skill.list` 与 `skill.inventory` handler，在注册表结果被投影到线格式之前过滤它。`inventory` 对被拒条目**省略**而非标记，因为该视图是产品中对技能披露最丰富的地方（描述、来源、绝对路径），标记出的行等于把除正文以外的一切交给被拒账号。来源分组在条目被清空后仍然保留，因为项目发现了什么并不取决于谁在问。
- `skill`，模型侧 —— `dsh-tool-skill`，在目录条目构建**之前**过滤 `ctx.skills.snapshot()`，并在 `skill` 工具的 `execute` 与 `/name` 手势监听器中各自复查。三处而非一处，因为目录是 prompt 内容而不是关卡：模型可能从更早的一轮、一个 fork 出的会话或凭猜测说出某个名字而直达执行器，用户键入 `/name` 也直达注入路径。
- `tool` —— `dsh-auth-gate` 中一次带作用域的 `tools.restrict({ allow })`，它既把工具移出 prompt，也拒绝其执行。更弱的做法都不合格：只过滤 prompt 会留下可达的执行器。
- `model` —— `dsh-auth-gate` 中的 `agent/request` waterfall 监听器，在 `next()` **之后**读取 config，从而看到会话选型实际产生的那条路由。`session.selectModel` 与 `llm.models` / `session.models` 目录也一并收窄，但只作为可用性支撑：选择器可被绕过，目录本就是建议性的，因此本轮请求本身才是决策点。
- `settings-section` —— `settings.describe` 过滤，`update` / `replace` / `mutate` 在触碰 seam 之前拒绝，使被拒命名空间无法被探测其存在性或校验行为。`openDocument` 要求**全部**已注册命名空间，因为该文档就是它们合在一个可编辑文件里，这次移交无法收窄到子集。

**目录过滤发生在发布之前，因此"模型可见 ⟺ 已记录"成立且无需格式变更。** 持久的 `skill-catalog` 消息记录它发布的条目；若改为过滤渲染后的 `<available_skills>` 正文，会话日志就会声称一份从未发送过的目录。因为过滤移动的是源列表，这条消息仍是忠实记录，既不需要新的 `SessionEventMap` 成员，也不需要 `SESSION_FORMAT_VERSION` 变更 —— 目录一向是按会话视图的投影，这里只是收窄了该视图。

**运行中的 agent 没有 principal，因此 `checkForSessionOwner` 是两个 agent 平面 Consumer 共享的那一次解析。** 它返回一个 `PermissionCheck` 闭包：没有记录 owner 的会话得到 `PERMITS_EVERYTHING`，提供方已无法解析的 owner（被删除或被停用）得到 `PERMITS_NOTHING`，其余情形得到该 owner 的真实判定。它需要 `AuthService.principalOf(userId)`，因为管理员旁路读取 `Principal.admin`，而由 Consumer 从组列表自行重建这一位，就等于允许它算错。

**三条路径与今天的行为完全一致。** 未挂载 auth 提供方：每个 Consumer 都以可选方式读取 `ctx.get('auth')` 并放行一切。没有记录 owner 的会话：它创建于认证挂载之前，剥夺其能力会破坏一段没人选择去限制的对话。管理员：`permits` 跳过求值，因此 `skill.inventory` 与 `settings.describe` 依然向管理员展示受限用户看不到的一切，而这正是管理界面可用的前提。

**管理平面是九条 `admin` RPC 行。** `auth.admin.users.list/create/disable`、`groups.list/create/delete/rename`、`members.set`、`rules.set`，每条同时进入 `RpcMethodMap`、`UNARY_ROUTES` 与 `METHOD_POLICY`。它们不提供 `owner`：它们决定其他所有行放行什么，因此能触及其中之一的调用方就能给自己授予其余。`members.set` 以其写入**之前**的成员关系计算新增账号，并在写入落盘**之后**为这些账号调用网关的 `notifyAddedToGroup`，同时写一条审计行。这个顺序就是全部契约：成员关系是提交点，通知只是礼节，因此邮件失败只记日志而保存依然成立。

## Consequences

`permits` 在未治理 domain 上的含义变了，`packages/auth/auth/tests/rbac.spec.ts` 也随之改变：`permits(member, [], 'tool', 'bash')` 现在为 `true`。`evaluate` 未变，仍是取用原始代数时应调用的函数。

seam 新增三个成员 —— `listUsers`、`setUserDisabled`、`principalOf` —— 在 `dsh-auth-sqlite` 中基于既有表实现，无 schema 变更。`setUserDisabled` 接受布尔值而非单向操作，使一次误封不至于变成数据库修复；它不吊销活跃会话，那仍是 `revokeAllSessions` 这个独立决定。

`RequestGate` 新增 `notifyAddedToGroup`，因为网关现在是调用方，而模板仍留在拥有该部署其他所有消息的那个网关处。`ToolRegistry.restrictableNames(scope)` 出于同样的理由加入：由策略推导白名单需要的正是这个集合，而 `schemas()` 已应用掩码，并携带作用域本地名字与保留传输名，这些都是 `restrict` 拒绝接受的。

工具限制自 `agent/session-start` 起安装，而这是一个 loop 并不等待的 `emit`。一个前置的 `agent/pre-step` 监听器等待同一个被记忆化的 promise，因此在任何 step 把工具可见性变成 prompt 之前掩码已经生效，解析失败也会抛给正被它阻塞的那一轮，而不是变成未处理的 rejection。解析按 agent 且只发生一次：规则变更只有在下一个 agent 创建时才对其生效。

有两个界面今天被 `METHOD_POLICY` 挡在 `admin` 上 —— `skill.inventory` 与整个 `settings.*` 平面 —— 因此它们的规则检查只会对进程内抵达 `ApiProxy` 的非管理员 principal，或在部署放宽这些行之后，才真正移除内容。它们仍然被实现并被测试，因为另一种选择是把过滤只留在策略表里，而它会在该行改变的那一刻悄然消失。

`session.create` **不**做模型域校验。它的 payload 不指名任何 provider 或 model，会话采用部署默认值，而拒绝创建会让账号无法打开那个本可用来挑选合规路由的会话。第一轮的 `agent/request` 才是拒绝不被允许的默认值之处，并且会指名该路由。

## Alternatives considered

- **对无规则的组在所有 domain 上默认拒绝** —— 作为代数正确，作为产品不可用：创建组会撤销成员的一切，而每一次授予都必须枚举整个产品才安全。
- **内置一个按 domain 带 `allow *` 的 "everyone" 组** —— 把同一个决定挪进 bootstrap 状态，而操作者可以删掉它并悄悄把部署锁死。必须成立的行为写在函数里比写在一行数据里更好。
- **过滤渲染后的目录正文而不是快照** —— 会让持久的 `skill-catalog` 条目描述一份模型从未收到的目录，破坏使会话日志可重放的那条不变量。
- **在 `skill.inventory` 中标记被拒条目而非省略** —— 会保留被规则拒绝技能的名称、描述与 host 路径；inventory 是披露界面，不是菜单。
- **只在 `session.selectModel` 强制模型域** —— 选择器只是可用性支撑。已记录选型早于规则的会话，或一个只调用自己喜欢的方法的客户端，都会路由到被拒模型而无人拦阻。
- **为过滤后的目录新增一个会话事件** —— 一旦过滤先于发布就没有必要，而且会为既有消息已记录的事实付出一次 `SESSION_FORMAT_VERSION` 变更。
- **只在 `agent/session-start` 同步安装工具限制** —— 该事件是 `emit`，没有人等待监听器，第一个 step 可能在掩码存在之前就组装出 prompt。
