# Agent Note: the directory picker browses the sandbox the tools run in

Status: implemented

[English](2026-08-27-directory-picker-e2b.md) | 中文

## Problem

sci 部署把 dsh 跑在容器里，而每个工具都在 Dormice 沙箱内执行，两者的文件系统是分开的：沙箱里 `ctx.e2b.cwd` 是 `/home/user/sci`，而容器自己的 `HOME` 是 `/home/node`。`directory-picker-auto` 挂载的工作区目录选择器是 `dsh-host-directory-picker-browse`，它列出的是**宿主进程**文件系统——`homedir()` 加上 `node:fs` 的 `opendir`。于是操作者浏览的是容器，选中了 `/home/node`，会话 cwd 也就成了沙箱中并不存在的路径。

该会话里的每次 Bash 调用随后都以 `subprocess-e2b: remote command exited before publishing its process-group id` 失败，因为 E2B 对不存在的工作目录唯一的表现就是 wrapper 自己立刻退出。这条消息既没有点出工作目录，也没有说明原因，因此该失败看起来像沙箱传输故障，而不是一个不存在的目录。

## Decision

`@deepseek-ai/dsh-host-directory-picker-e2b`（`packages/e2b/directory-picker-e2b`）针对沙箱而非宿主提供能力缝已有的 `browse` 能力：`home` 就是 `ctx.e2b.cwd`，列目录是每层一次 `files.list`，创建目录是 `files.makeDir`，其前置的父目录探测在 E2B 的递归原语之上保住了能力缝的非递归约定。能力 kind 不变，因此 `dsh-client-ui-directory-picker-browse`、apiproxy 消费方以及线协议词汇都无需改动——唯一的差别是被列出的是哪个环境。本包放在 `e2b` 分组，因为它 inject `e2b`，同时保留选择器家族的 npm 名字。

与宿主后端的三处差异都源于：无论宿主是什么平台，远程环境都是 Linux。因此路径限定只按 POSIX 判断（Windows 形态的路径在沙箱里只是一个相对名字）；创建名字中允许 `\`，因为在那里只有 `/` 和 NUL 属于分隔符；符号链接的解析是把每一跳的目标相对链接自身的父目录展开，最多 8 跳，因为 envd 报告的是链接自己的元数据，而不是目标的。`maxEntries` 上界（默认 1000）约束的是送往客户端的内容；层级本身是从文件 API 一次性完整返回的，因此只有窗口内的候选才需要付出一次链接探测。

`subprocess-e2b` 现在会在 wrapper 未发布进程组 id 就退出时点出工作目录，并且只在失败路径上探测该目录：`FileNotFoundError` 产出 `subprocess-e2b: cwd does not exist in the sandbox: <path>`；无法给出结论的探测把疑问留在消息里（`… (cwd <path>; does it exist in the sandbox?)`）；沙箱确认存在的目录则让 wrapper 的提前退出成为全部结论（`… (cwd <path>)`）。探测放在失败路径而不是每次 spawn 之前，是因为逐次 spawn 的元数据请求会为了诊断一个在第一次就会失败的配置错误，向 sci 工作负载的数百次 spawn 收税。

## Alternatives considered

**在沙箱镜像里为 `/home/node` 建符号链接。** 这正是今天在生产上采用的热修复，但作为设计要被否决：它靠镜像的巧合让一个宿主路径可用，其余任何宿主路径（真正的 `/Users/...` 或 `C:\...` 选择）依旧不可用，并且把修复放进了镜像层——仓库里没有任何东西陈述或测试它。列错文件系统的选择器仍然会提供沙箱中不存在的目录。

**把浏览后端的 home 变成可配置项。** 否决，因为缺陷不在 `homedir()`。该后端仍会枚举宿主进程文件系统，因此浏览器仍会展示宿主目录，操作者也仍能从任何配置出来的 home 走出去；改变的只是初始落地的层级。

**每次导航都通过远程 `realpath` 做规范化。** 目前否决：它会让每次导航付出一次沙箱进程创建，而 `fs-e2b` 的四槽位命令上限存在的目的正是限制这一点。通过文件 API 列目录让导航不产生进程创建，代价是报告客户端发来的路径而不是其规范化目标。

## Consequences

沙箱部署用本后端取代 `-auto` 行，并与 browse 客户端界面配对；此后选择器只提供沙箱能够进入的目录，选中的工作区就是可用的会话 cwd。`sci` profile 已随带这一替换（`packages/sci/sci-profile/cordis.patch.yml`）；其他 profile 不受影响——`-auto` 仍在原生后端与宿主浏览后端之间解析。

pgid 失败现在会带上它的工作目录，因此同一配置错误无论经由哪条路径出现（手工改过的会话 cwd、根路径已过期的 preset），报告的都是那个目录，而不是一条传输形态的消息。该探测为一次已经失败的 spawn 增加一次元数据请求。

列目录的层级会在宿主侧被完整实体化，因此 `maxEntries` 约束的是线协议上的行数，而不是裁剪期间持有的响应；服务端窗口需要该 SDK 尚未暴露的 envd 列表上界。

## Testing

本包的测试套件针对一个 fake E2B 远端运行，达到该分组按文件 100% 的覆盖率：home 解析为 `ctx.e2b.cwd`；仅目录的列表及其 hidden 标记与名称排序；绝对／相对／多跳／指向文件／损坏的链接；在跳数上界处停止的链接环；恰好等于、低于和超过上界的截断窗口；仅按 POSIX 判断的路径限定拒绝相对路径与 Windows 形态路径；层级不存在、权限被拒和沙箱不可达的错误映射；链接探测之前与之中的中止；在真实父目录与符号链接父目录下的创建；`directory-exists`；非路径段名字；父目录缺失与父目录非目录；以及资源释放移除能力缝注册。`subprocess-e2b` 的测试套件钉住了三条发布失败消息。
