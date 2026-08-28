# sci-skills —— `sci` 档案的内置 skill 树、沙箱同步与生命周期策展

[English](README.md) | 中文

替代被研究平台的 skill 下发与列表机制（`ClawsGO-System/01-Skills/README.md`，改进项 S1–S6 见 `ClawsGO-System/09-Target-Architecture/07-skills-plan.md`）：那里用一个手工维护的 `.clawsgo-rev` 字符串，它一变就整目录重推；列表把十五个 skill 永久注入且没有退役路径；还有三个 skill 的 frontmatter description 被静默截断成了裸名字。这里目录的身份是 Merkle 摘要，因此一轮同步只写内容真正变化的文件；列表由会话日志投影出的生命周期状态过滤；description 为空则在插件加载时按名字报错。

十五个 skill bundle 位于 `skills/`。它们必须放在本包目录内：tsdown 的 workspace glob `packages/*/*` 会把 `packages/sci/` 下的散目录当成一个包，导致整个 `typecheck` 失败。

## 对外面

| 面 | 位置 | Config |
|---|---|---|
| skill 列表 provider | `ctx.skills.registerProvider()`，provider 名 `sci` | `providerName`（默认 `sci`） |
| 树在沙箱中的副本 | `ctx.fs`，位于 `sandboxRoot` 下 | `skillRoot`、`sandboxRoot`、`syncOnStart` |
| 摘要清单 | `<sandboxRoot>/.sci/skills.json` | — |
| `sci_skill_usage` 投影 | `ctx.storageDomain`，domain `sci_skills` | `skillToolName`（默认 `skill`） |
| `sci_skill_lifecycle` 投影 | `ctx.storageDomain`，domain `sci_skills` | `staleAfterDays`（默认 `90`）、`pinned` |
| 会话事件 `sci/skills-synced` | 追加到同步之后打开的每个会话 | — |

`sandboxRoot` 为必填且无默认值：每个沙箱镜像的 home 布局不同，猜一个默认值会把 skill 发布到模型打不开的位置。

## 同步

`computeSkillHash(dir)` 按相对路径排序把每个文件的 sha256 折叠成一个目录摘要；`planSync(local, remote, published)` 比较两份摘要清单，返回需要写入与需要撤回的 `<skill>/<相对路径>` 条目。一轮同步读取 `<sandboxRoot>/.sci/skills.json`，通过 `ctx.fs` 写入变化的文件，撤回已消失的文件，再写回清单。skill 正文里的 `$SCI_SKILL_ROOT` 在写入时展开为 `sandboxRoot`，因此同一份 SKILL.md 在本仓库与沙箱里都是对的。

清单是沙箱对自身的声明，不是观测结果，所以摘要相同不足以跳过一个文件：`planSync` 会对两份清单一致的每个条目探测沙箱是否仍存在，并重新发布已消失的那些。模型自己在 shell 里删掉一个已发布文件，代价是一轮同步，而不是丢掉这个 skill。

这个文件同样可被模型写入，而它携带的每个键都会变成本轮写入的路径，或撤回用 `rm` 的一个参数。`parseManifest` 会丢弃任何为空、绝对、带盘符或含 `..` 段的 skill 键与文件键（skill 键不允许含任何路径分隔符），每丢弃一个键记一条警告；随后 `createSyncFileSystem` 用 `FileSystem.contains` 对每个已解析的撤回目标重新核对 `sandboxRoot`，不通过就在 `rm` 进程存在之前抛错。第二道检查才是承重的那一道：任何 `ctx.fs` 策略都观测不到子进程。

`ctx.fs` 没有 unlink 方法，因此撤回经 `FileSystem.processPath()` 跨到 `ctx.subprocess` —— 这是把路径交给同一执行世界中另一个 OS 能力的既定通道。没有挂载 subprocess provider 时不撤回任何文件；这些文件保留其清单条目，等下一轮挂载了 provider 再重试，并且不会出现在事件的 `removed` 列表里。

## 策展

用量来自会话日志：`tool/call` 事件的 `name` 与 `skillToolName` 匹配时，从记录下来的 `arguments` JSON 中解析出 skill 名。不存在 `skill/invoked` 事件。随后 `curateLifecycle` 用传入的时钟给整棵树计龄：超过 `staleAfterDays` 未使用的 skill 变为 `stale`，列表中只显示其第一句；已离开树的 skill 变为 `archived`，完全不列出；`pinned` 的 skill 恒为 `active`。从未被使用的 skill 从它首次出现在树中的时间开始计龄。`./invariant` 在 `domain/changed` 流上断言 pin 豁免。

`sci` preset **只**挂载本 provider。若在同一批目录上再挂 `@deepseek-ai/dsh-skill-filesystem`，它会把本包刚刚策展掉的那些 skill 重新列出来。

## 模型体验（Model Experience）

### skill 目录

#### 模型看到什么

每个被列出的 skill 一条目录条目，渲染形式与任何 `ctx.skills` provider 的条目完全相同。`active` 的 skill 带完整 frontmatter description，`stale` 的缩短为第一句，`archived` 的不出现在目录里。`sci` preset 只挂载本 provider，因此没有别的东西会把本包策展掉的 skill 重新列出来。

#### token 影响

每次请求为每个被列出的 skill 付一条 description。skill 老化为 `stale` 后该 description 只剩一句，归档后条目消失，因此常驻目录开销随树老化而下降，而不是随之增长。

#### KV Cache 影响

策展状态变化会重写目录块，那次 assembly 为它付一次 KV-cache miss。`curateLifecycle` 只在记录到一次加载、或跨过 `staleAfterDays` 时移动一个 skill，不会每轮移动。

### skill 正文与资源

#### 模型看到什么

加载一个 skill 返回它的 `<skill_content>`，其中 `$SCI_SKILL_ROOT` 已展开为 `sandboxRoot`，`resourceBase` 指向沙箱副本，因此模型从正文里读到的每个路径都是它能打开的路径。一轮同步的 `sci/skills-synced` 记录只进日志，不进模型历史。

#### token 影响

正文只在模型加载它的那一轮计费。一轮同步无论写入还是撤回了什么都不消耗 token；被拒绝的清单键所产生的警告进宿主日志，不进模型。

#### KV Cache 影响

被加载的正文追加到历史，不扰动任何更早的前缀。同步记录带信封的 `ignorable: true`，因此完全不进入模型上下文；未挂载本插件的构建会跳过它，而不是拒绝重建日志。

## Known Limitations and Deferred Work

- **不同步二进制 skill 资源。** `ctx.fs` 只提供 `writeText`，因此携带图片或压缩包的 skill bundle 无法发布。目前所有内置 bundle 都是文本（Markdown、Python、XSD、XML、HTML、纯文本）；`__pycache__` 与 `.git` 在哈希与发布两侧都被排除。
- **自研 skill 正文仍在描述被研究平台的机制。** 目前只应用了机械修正（S3–S5：description、`$SCI_SKILL_ROOT` 路径、`deliver_files` 与章名引用）。07-skills-plan 为每个 skill 规定的行为重写 —— `sci-recall` 改读 dsh session store 而非 Claude Code 的 JSONL、`sci-plot --dry-run`、`sci canvas lint`、`sci paper archive` —— 属于后续阶段，第十六个 bundle `sci-references` 亦然。
- **用量是实时投影，不是重建。** 监听器在 `session/event` 到达时折叠它；从冷日志重建两张表是 `sci-audit` 的 `rebuild` 路径（规格 P9）。
