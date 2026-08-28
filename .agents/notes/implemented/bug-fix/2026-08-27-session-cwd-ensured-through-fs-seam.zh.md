# Agent Note: 通过文件系统 seam 确保会话的项目目录

Status: implemented

[English](2026-08-27-session-cwd-ensured-through-fs-seam.md) | 中文

## Problem

`sessions.create` 过去用 `node:fs` 的 `mkdir(cwd, { recursive: true })` 在 Host 进程文件系统上创建请求的项目目录。只有当 Host 进程同时就是工具的执行世界时，那才是会话工具真正使用的目录。组合了沙箱文件系统后端的部署会把每个工具都跑在沙箱里，`/home/user/sci` 是沙箱路径而不是 Host 路径，而[沙箱化的工作区选择器](../feature/2026-08-27-directory-picker-e2b.zh.md)恰好把这样一个路径交回客户端。此时在 Host 上创建目录只有两种失败、没有成功：Host `mkdir` 被拒绝（`EACCES: permission denied, mkdir '/home/user'`，缺陷就是这样暴露的），或者创建成功却留下一个沙箱里任何工具都到不了的 Host 目录，而会话真正的 cwd 依然不存在。

## Decision

`packages/host/apiproxy/src/api-proxy.ts` 里的 `ensureProjectDirectory` 用 `ctx.get('fs')` 读取可选的文件系统服务，并按它指明的执行世界分支。

组合了文件系统服务时，检查走 seam：先 `resolve(cwd)`，再 `stat(target)`。已存在的目录是成功情形；目标不存在，或目标是其他任何类型，都失败。seam 没有创建目录的方法，因此有服务的组合只做校验、不做创建——在那个世界里创建目录是交出 cwd 的一方的责任（选择器的 `createDirectory`，或沙箱提供方自己的引导，例如 `dsh-dormice` 创建 `ctx.e2b.cwd`）。`resolve` 会跟随符号链接，所以符号链接指向的项目目录无需第二次探测就报告为目录。

没有文件系统服务时，Host 文件系统就是那个世界，原来的递归 `mkdir` 照旧执行。

两条分支共用同一条失败消息 `failed to ensure project directory "<cwd>": <cause>`，并包裹原因；`sessions.create` 仍把它映射为 `internal` RPC 错误。恢复路径未受影响：已存储的会话先比较记录的 cwd，在任何目录检查之前就回答 `SessionCwdConflict`。

## Alternatives considered

**给 `FileSystem` Service Definition 增加 `mkdir`/`ensureDir`。** 本次改动不采用：那是 seam 上的新抽象方法，`dsh-fs-local`、`dsh-fs-sandbox`、`dsh-fs-e2b` 都要给出实现，还要由沙箱策略回答递归创建允许延伸到哪里。目前没有任何 Consumer 需要通过 seam 创建目录——选择器用自己的能力创建——所以在出现这样的 Consumer 之前，seam 保持原样。

**用 `lstat(cwd)` 而不是 `resolve` + `stat` 探测。** 不采用，因为 `lstat` 刻意不跟随最后一段路径，符号链接指向的项目目录还需要第二次面向 target 的探测和它自己的失败分支，在这里没有收益。

**保留 Host `mkdir`，由部署预先创建沙箱路径。** 生产环境目前就是这样热修的。不作为落地行为，因为它让每个沙箱 cwd 都变成必须存在两份的 Host 容器路径，而且会为 agent 用不了的目录静默报告成功。

**改用 shell 或 subprocess seam 创建目录。** 不采用，因为那等于在网关处另选一个执行世界：文件系统服务已经指明了会话文件工具所用的世界，而一个组合可能只有其中一个 seam。

## Testing

`packages/host/apiproxy/tests/api-proxy-session-cwd.spec.ts` 分别在有和没有结构化文件系统假实现的情况下组合网关。走 seam 的用例断言被探测的路径、只有假实现拥有该目录时创建成功、以及事后该路径在 Host 文件系统上不存在；目标缺失与非目录用例断言拒绝及其消息。Host 回退用例断言在临时根目录下递归创建，以及 Host `mkdir` 失败时消息形态不变。

## Related

`dsh-workspace` 过去以同样的方式在 Host 文件系统上做规范化和检查，因此仅存在于沙箱的路径也会因同一原因让 `workspace.create` 失败。正如本 Note 当时所暂缓的，那一半已单独落地：[通过文件系统 seam 规范化 workspace 路径](2026-08-27-workspace-paths-through-fs-seam.zh.md)把该包的规范化放到 `ctx.get('fs')` 上，并把 `WorkspaceRecord.path` 重新定义为工具实际执行所在世界里的规范路径。

## Consequences

沙箱部署可以在选中的沙箱目录里创建会话，仅 Host 的部署保持一直以来的按需创建行为。cwd 在沙箱中不存在的会话现在会被拒绝，消息中点明该目录，而不是在 agent 看不到的 Host 目录上继续服务。`dsh-host-apiproxy` 为 `ctx.get('fs')` 的声明合并新增了对 `@deepseek-ai/dsh-fs` 的 type-only 依赖；该服务仍是可选的，没有任何文件系统的组合照样服务全部 RPC。
