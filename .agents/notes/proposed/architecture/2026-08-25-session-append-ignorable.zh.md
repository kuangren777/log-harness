# Agent Note: ignorable 信封标记的写入方接口

Status: proposed

[English](2026-08-25-session-append-ignorable.md) | 中文

## 问题

[会话日志版本机制](../../implemented/architecture/2026-08-10-session-log-version-mechanism.zh.md)在 v0 里交付了 `SessionEvent.ignorable` 的读取侧：种子校验、两个持久化后端、BFF 协议格式（wire format）schema，以及 `PersistenceCoordinator` 里「只有信封携带该标记时才跳过无法识别事件」的未知类型拒绝逻辑。没有写入方能设置它——`Session.append` 没有对应参数——因此该标记只能靠测试里手写的信封触达。那篇 Agent Note 把写入方接口推迟到它的第一个生产方出现时再做。

`packages/sci/sci-skills` 就是那个生产方。`sci/skills-synced` 是每次同步一条的仅日志记录，携带写入和移除的沙箱相对路径；它的存在不会让日志里后面的任何内容被解读得不同。没有这个标记，任何不挂载该插件的构建都会拒绝重建包含它的日志——这正是「默认值理应让过度拒绝变得罕见而非常态」这条原则要避免的情况。

## 提议

`Session.append` 为非 surface 类型新增第三个参数：`append(type, data, { ignorable: true })`，其类型是 `packages/core/session/src/types.ts` 里新增的 `AppendOptions` 接口。省略它不会写入任何信封字段，因此所有既有调用点和既有日志都保持逐字节一致。

该选项只向非 `SurfaceEventType` 事件开放。三种 surface 类型是每个构建都知道的封闭集合，只能靠 `SESSION_FORMAT_VERSION` 提升来改变，因此在其中一个上打标记永远不会生效，反而会给出「可以丢弃模型可见内容」的错觉；编译器在那里继续要求 `SurfaceIntent`。`sci-skills` 在它唯一的 `session.append('sci/skills-synced', …)` 调用点传入 `{ ignorable: true }`，其 README 也删掉了记录这一缺失接口的限制条目。

`SESSION_FORMAT_VERSION` 保持为 `0`。版本提升规则针对的是「写入方发出了旧读取方无法正确处理的内容」；而这个标记已经被每个 v0 读取方读取，旧读取方遇到一个自己认识的类型带上该标记，行为和以前完全一样。新增普通事件类型正是这个标记存在的目的所要吸收的那种词汇量增长。

## 考虑过的替代方案

**把 `ignorable` 放进 `SurfaceIntent`，让所有类型都能接受它。** 更对称，也少一个接口。但这会在「丢失即掏空会话」的那三种类型上开放一个毫无意义的选项，换来的只是读取方永远观察不到的一致性。

**为核心允许列表之外的事件默认设 `ignorable: true`。** 上游已经否决过，这里依然是错的：忘记打标记会静默地把一个已被掏空的会话恢复起来，而不是对一个本可恢复的会话大声地过度拒绝。

**改为把 `sci/skills-synced` 注册成已知类型。** 它本来就是——生成的 `KNOWN_SESSION_EVENT_TYPES` 覆盖了仓库内每一处 `SessionEventMap` 合并——所以这对「组合中不带该插件的构建」毫无帮助，而这正是会拒绝的那种情况。

## 验收标准

`session.append(type, data, { ignorable: true })` 产生的信封其 `ignorable` 为 `true`，并且该值能在 memory、sqlite、jsonl 三个后端上经受 live 会话的落盘与重载（在共享的 coordinator 约定里断言一次，因此每个后端都会跑到）。默认的 append 不带 `ignorable` 自有属性，序列化结果与以前完全一致。一个已知类型集合里没有该事件类型的读取方，带标记时仍会跳过、不带标记时仍会拒绝——这一行为已经由 coordinator 约定覆盖。`sci-skills` 在它真实的同步事件上记录了该标记。

## 风险

这个选项很容易被滥用：任何生产方都能把自己的事件标记为可跳过，而一个用错的标记会在重建时把一条必需事件变成静默的数据丢失——这正是「默认必需」规则本来要避免的失败模式。编译器无法判断一个 payload 是否只是提供信息，因此对新增 `ignorable: true` 调用点的评审是唯一的把关手段。仓库外插件的事件除非自己设置该标记，否则无论这次改动与否都仍会被拒绝；为它们的类型开放一个注册接口仍被推迟。
