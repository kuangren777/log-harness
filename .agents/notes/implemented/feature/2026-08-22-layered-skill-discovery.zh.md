# Agent Note：项目 skill 发现改为遍历 cwd 的祖先目录

Status: implemented

[English](2026-08-22-layered-skill-discovery.md) | 中文

## 问题

`dsh-skill-filesystem` 只扫描两个项目目录，且都位于最近的 `.git` 祖先目录下。monorepo 中的子包、嵌套 worktree，以及任何组织在仓库根目录之下的工作区，都无法携带自己的 skill；用户为整个 home 目录准备的 skill 也不可见。从 Claude Code 迁移过来的用户还期望在项目级与用户级都能读取 `.claude/skills`。

## 决定

项目发现改为遍历。查找 cwd 及其直到遍历锚点的每一级祖先目录，都会贡献所配置的 `projectSkillDirs`（`.dsh/skills`、`.agents/skills`、`.claude/skills`），同名 skill 由更近的目录胜出。当 cwd 位于操作系统 home 目录内时，锚点是 home 目录；否则是最近的 `.git` 祖先目录；两者都没有时只覆盖 cwd 自身。`walkAncestors: false` 可恢复单目录扫描。

rank 保持在既有的项目区间内：某个根的 rank 为 `100 + depth * projectSkillDirs.length + index`，因此优先级由位置决定，而不是由目录名决定。该区间的上界是 `custom` 的 rank 300；一旦遍历会触及该值，本次查找就以 `RangeError` 失败并在消息中说明这次遍历，注册表将其记录为被跳过的提供方并报告目录不完整。压缩 rank 的方案被否决：rank 是该提供方与注册表之间的优先级契约，缩放会悄悄改变 `custom`、用户根与 bundled 根之间的顺序。

若某个被遍历目录的 skill 根同时也是三个用户根之一，则将其从项目区间中剔除；因此当 home 目录是祖先目录时，`~/.dsh/skills` 仍保持 rank 400 及其 `.system` 跳过行为。新增的 `user-claude` 根（`<claudeHome>/skills`，取自 `$DSH_CLAUDE_HOME` 或 `~/.claude`）rank 为 550，位于 `user-agents` 与 bundled skill 之间。`SkillCandidate` 新增 `root` 字段表示候选项被发现的目录，`SkillSource` 新增 `project-claude` 与 `user-claude`。

同一 cwd 的所有被遍历根在 watch 管理器中共用 owner key `project:<anchor>`，因此 `watchMaxProjects` 限制的仍是不同的 cwd 而非目录数量，驱逐其中一个会释放它的全部根。代价是每个 cwd 需要 `(depth + 1) × projectSkillDirs` 个监视句柄。

## 测试隔离

`~/.claude/skills` 在许多开发者机器上真实存在，因此每个挂载该提供方的测试套件都必须固定其用户根。`dsh-acp-snapshot` 与 `dsh-loader-smoke` 现在会在 `DSH_HOME`、`DSH_AGENTS_HOME` 之外一并固定 `DSH_CLAUDE_HOME`；ACP 测试工装还会把 `HOME`／`USERPROFILE` 固定到生成的 cwd，否则把工作区放在真实 home 之下的场景会一路遍历到该 home 的 skill 根。

## 备选方案

**保留单一项目根，只在另外两个目录旁边加上 `.claude/skills`。** 否决：这只会读取新目录，却没有解决需求的来源——位于仓库根目录之下的工作区仍然无法拥有自己的 skill，而这正是 Claude Code 用户依赖的分层能力。

**按目录名全局固定 rank（`.dsh` 恒为 100，`.agents` 恒为 200）。** 否决：在遍历场景下，按名称固定 rank 会让远处祖先的 `.dsh/skills` 盖过 cwd 的 `.agents/skills`，与分层要提供的「就近胜出」规则相反。

**遍历过深时缩放 rank 以塞进区间。** 否决：rank 会与别处拥有的 `custom`、用户根和 bundled 根比较，压缩会改变这些无关来源的顺序。直接失败可以让区间语义保持固定，并指出两个配置层面的退路。

**让被去重的 home 级目录保留项目 rank，而不是用户 rank。** 否决：`~/.dsh/skills` 带有 `.system` 跳过行为，为同一个目录保留两个条目要么会重复其 skill，要么会让该跳过行为取决于哪个条目胜出。

## 影响

位于 home 目录深处的 cwd 现在最多会打开 `(depth + 1) × 3` 个根，因此发现阶段的目录读取更多、持有的监视句柄也更多；`walkAncestors: false` 是文档化的退出方式。放在中间层目录的 skill 无需 `.git` 标记即可生效，而 home 级的 `.claude/skills` 可覆盖每一个会话。无密钥的 `skill-load` 快照固定了目录中的 Claude 根条目，以及一个被同名 skill 遮蔽的条目。
