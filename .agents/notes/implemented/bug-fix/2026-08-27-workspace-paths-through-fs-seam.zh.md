# Agent Note: 在工具实际执行的文件系统里规范化 workspace 路径

Status: implemented

[English](2026-08-27-workspace-paths-through-fs-seam.md) | 中文

## Problem

`dsh-workspace` 过去在 Host 进程文件系统上规范化并检查每一个路径：用 `realpath` 得到唯一性规范值，用 `stat` 得到目录事实，`create`、`resolveByPath`、启动时的头部索引、attach 校验和 `status` 全都如此。只有当 harness 进程同时也运行会话的工具时，那才是正确的文件系统。组合了沙箱文件系统后端的部署会把工具跑在沙箱里——sci 部署在 Dormice 沙箱上挂载 `@deepseek-ai/dsh-fs-e2b`，其 `ctx.e2b.cwd` 为 `/home/user/sci`——而进程本身在另一个容器里，且[沙箱化的工作区选择器](../feature/2026-08-27-directory-picker-e2b.zh.md)交给客户端的正是这样一个路径。于是选择器自己的流程走不通：对刚选出的目录调用 `workspace.create` 会失败并报 `workspace-invalid-path: cannot create a workspace at "/home/user/sci/projects/qa-ws-28d01e": ENOENT: no such file or directory, realpath '/home/user/sci/projects/qa-ws-28d01e'`，这正是[通过 seam 确保会话项目目录](2026-08-27-session-cwd-ensured-through-fs-seam.zh.md)中暂缓的那一半。

## Decision

`pathWorld(ctx)`（`packages/workspace/workspace/src/paths.ts:82`）指明一个 workspace 路径属于哪个文件系统，包内所有规范化都经过它。它唯一的方法 `canonicalize(path)` 同时返回规范路径和该路径当前是否为目录，路径在那个世界里不存在时拒绝——正是每个调用点本来就需要的两个事实，只花一次往返。

组合了文件系统服务时，世界属于该后端（`packages/workspace/workspace/src/paths.ts:64`）：`resolve(path)` 给出稳定 target，`stat(target)` 判定存在性与类型，`processPath(target)` 就是被记录下来的规范绝对路径。seam 没有 `realpath`，而且 `resolve` 对尚不存在的路径也会成功，因此由 `stat` 把「目标不存在」变成这个世界的 `ENOENT`：`the filesystem backend has no such path '<path>'`。没有该服务时，Host 进程文件系统就是那个世界，原来的 `realpath` 加 `stat` 照旧执行（`packages/workspace/workspace/src/paths.ts:51`）。

该服务每次调用都重新读取、绝不缓存，因此 composition 挂载或释放文件系统后，下一次检查即可观察到。`WorkspaceRegistry` 在 `create`、`resolveByPath` 和头部索引处直接读取；`WorkspaceEntity` 则通过 `WorkspaceEntityHost.paths()` 拿到它（`packages/workspace/workspace/src/entity.ts:69`，由 `packages/workspace/workspace/src/index.ts:108` 提供），用于 attach 校验和 `status`，于是实体依旧只看见注册表拥有的 host，而不会看见 `Context`。

把这个世界同时应用到重建和 attach（而不只是 `create`），才能让记录保持可用：create 时盖章的路径、启动时规范化的会话头 `cwd`、以及 attach 时重新检查的同一个 `cwd`，全都经过同一套规范化，成员判定因此仍是规范路径的字符串相等。相应地，`WorkspaceRecord.path` 指的是工具实际执行所在文件系统里的规范路径——挂载了 seam 时是 seam 的规范值，否则是 Host `realpath`（`packages/workspace/workspace/src/types.ts:36`、`packages/workspace/workspace/src/spec.ts:24`）——记录也只在为它盖章的那个世界里才通过校验。把部署改挂到另一个后端后，已存储的路径在那里无法解析，`status()` 会如实报告 `missing-dir` 且不改动任何记录；README 的「已知限制」持有这条缺口。

错误码和消息形态保持不变。非目录仍然以 `cannot create a workspace at '<canonical>': path is not a directory` 被拒绝，不存在的路径仍然以所在世界自己的错误被拒绝，网关的 `workspace.create` 仍把两者映射为携带 `cannot create a workspace at "<path>": <cause>` 的 `workspace-invalid-path`。

## Alternatives considered

**保留 Host `realpath` 规范化，并在 dsh 容器里预先创建镜像目录。** 生产环境目前就是这样热修的。不采用，因为选择器是按需在沙箱里创建目录的：用户通过选择器新建的每一个目录，都要在同一时刻再创建一个空的 Host 目录，`workspace.create` 才能工作；而这个镜像随后又会让 `status()` 为 agent 根本到不了的目录报告成功。

**给 `FileSystem` Service Definition 增加 `realpath`。** 不采用，因为它是冗余的：`resolve` 已经返回规范身份，`processPath` 已经给出它在后端世界里的绝对路径，正好就是本包需要的规范值。新增抽象方法要由 `dsh-fs-local`、`dsh-fs-sandbox`、`dsh-fs-e2b` 各自实现，却拿不到任何它们尚未暴露的事实。

**在记录里一并存下世界标识，以便跨后端校验或迁移记录。** 不采用，因为缺少当前的 Consumer：没有哪个部署会在注册表运行期间切换文件系统后端，持久格式却要为此多出一个所有读取方都必须解释的字段；真出现这种情况时，`status()` 已经给出诚实的答案（`missing-dir`）。

**把 `fs` 作为 `WorkspaceRegistry` 的必需依赖注入。** 不采用，因为那会卡死所有仅 Host 的组合：注册表会一直待处理，直到出现某个文件系统服务为止，而 Host 文件系统是一个正当的执行世界，不是缺失的依赖。`ctx.get('fs')` 让该服务保持可选，与网关的会话 cwd 检查一致。

**给 `WorkspaceEntity` 自己的 `Context`，而不是通过 host 方法。** 不采用，因为实体存在于 `WorkspaceEntityHost` 之后，正是为了让注册表独占表访问、会话路径索引和头部读取；为了藏起一次查找而把叶子实体扩宽到 `Context`，等于让它够得到 composition 里的每一个服务。

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` 新增一个结构化的文件系统假实现——`resolve`、`stat`、`processPath` 就是本包调用的全部三个方法——它的世界是一个按规范路径为键的 `Map`，外加一张代表符号链接和 `..` 段的别名表，并作为可选的 `fs` 服务提供给既有 harness。走 seam 的用例在 `/home/user/sci/projects/qa-ws` 创建 workspace，断言记录存下该路径、且 Host 文件系统上什么都没被创建，并让别名解析回同一个 workspace；拒绝用例覆盖后端没有的路径、后端没有但 Host 上确实存在的目录、文件，以及另一种类型的非目录。成员用例 attach 头部 `cwd` 为后端目录的会话，并拒绝不匹配、无法解析的 `cwd`、以及后端报告为文件的 `cwd`；`status` 跟随一个后端目录先变成文件再消失，启动引导则把 `cwd` 写法不同但解析到同一后端规范值的两个头部归为一组。同一文件里的 Host 文件系统用例未作改动，仍然覆盖没有服务的世界。

## Consequences

沙箱选择器的流程可以端到端走完：在沙箱里创建的目录可以成为 workspace 并承载会话，而仅 Host 的部署保持一直以来的 `realpath` 行为。`dsh-workspace` 为 `FileSystem` 类型和 `ctx.get('fs')` 的声明合并新增了对 `@deepseek-ai/dsh-fs` 的 type-only 依赖（peer 加 dev，并补上对应的项目引用）；该服务仍是可选的，没有任何文件系统的组合照样原样运行注册表。包的公开面把仅适用于 Host 的 `realpathNormalize` 导出换成了 `pathWorld` 及其 `PathWorld` / `CanonicalPath` 类型，这也是调用方真正想要的东西的诚实名字。
