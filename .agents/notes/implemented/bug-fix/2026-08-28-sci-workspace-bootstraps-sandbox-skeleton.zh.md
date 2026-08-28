# Agent Note: 由 dsh-sci-workspace 铺开沙箱家目录骨架

Status: implemented

[English](2026-08-28-sci-workspace-bootstraps-sandbox-skeleton.md) | 中文

## Problem

sci 沙箱镜像自带 `/usr/local/bin/sci-init`，一个幂等脚本，从保存在家目录之外的骨架副本铺开 `/home/user/sci/{projects,memory,references,skills,.sci/spool/{pending,done,failed}}`。它之所以存在，是因为镜像烘不出这棵目录树：沙箱守护进程把 `/home/user` 挂成持久卷，卷一挂上就遮蔽镜像放在该路径下的一切。而 harness 里从来没有任何地方调用过它——`grep -rn sci-init packages/` 找不到调用方——于是在新 VM 上，这棵树只有等人手工跑一次脚本之后才存在。在那之前，落在它下面的每个调用都以路径缺失失败：`workspace.create` 和选择器的 `createDirectory` 报 `FileNotFoundError: [not_found] no such file: /home/user/sci/projects`，缺陷就是这样在生产暴露的。

## Decision

由 `@deepseek-ai/dsh-sci-workspace` 来跑。这个包本来就拥有 `projectRoot`，因此也该负责让这条路径存在；`src/bootstrap.ts` 承载这次执行：`parseBootstrapArgv` 把配置的 `bootstrapCommand` 变成 argv，`runSkeletonBootstrap` 通过 subprocess seam 启动它并汇报结果。

seam 用 `ctx.inject(['subprocess'], …)` 读取，而不是加进插件自己的 `inject`。没有 subprocess 提供方，这张路径表也是完整的，因此仅 Host 的组合必须保留门禁、跳过引导；反应式地读取 seam 同时也覆盖了沙箱提供方在本插件之后才挂载的组合。一个模块作用域的标记把它限制为每次插件挂载只跑一次，所以提供方卸载后再回来，不会重复本 fiber 已经做过的引导。

`apply` 不等待这次执行。反正命令跑完之前骨架都是缺的，而慢的或连不上的沙箱不该拖住 profile 的启动。退出码 0 把命令 stdout 的最后一行非空内容记到 info（`sci-init: /home/user/sci ready (…)`）；非零退出、被信号杀死、spawn 抛错、`done` 被拒绝、以及截止时间到点，各自变成一条 `ctx.logger.warn`，点名 `projectRoot` 并带上 stderr 尾巴。截止时间是 `runSkeletonBootstrap` 自己挂在 spawn spec 上的 `AbortController`，因此由 seam 去终止进程树，而不是让这次尝试挂在沙箱上。

两个配置字段承载它：`bootstrapCommand`（默认 `sci-init`，留空即关闭）与 `bootstrapTimeoutMs`（默认 30000）。两个默认值描述的就是随镜像发布的形态，因此 `packages/sci/sci-profile/cordis.patch.yml` 不需要新增行。命令以 `/` 为工作目录运行：它要创建的目录树不能是它自己的工作目录，而 `sci-init` 从沙箱环境读取自己的目标路径。

## Alternatives considered

**在沙箱守护进程 acquire 时创建骨架。** 层次不对，不采用。守护进程为所有 profile 管理沙箱，对科研家目录一无所知；布局是本包的配置，把它烘进守护进程等于把某一个 profile 的目录约定变成平台特性。

**把骨架烘进沙箱镜像。** 做不到，这正是 `sci-init` 存在的原因：`/home/user` 是挂载卷，镜像写在它下面的任何东西，在卷出现的瞬间就被遮蔽。

**继续让运维手工跑。** 这就是缺陷描述的现状。不采用，因为沙箱是按租户按需创建的，「部署后跑一次」不是任何人能完成的步骤——下周新建的沙箱同样需要它，而它留下的失败是租户第一个动作上的 `not found`。

**改走 shell seam 跑。** 不采用，因为那等于为一条命令另选一个执行世界：`ctx.subprocess` 就是本包另一个跨世界动词已经在用的 seam，而 shell seam 会引入 argv 启动根本不需要的命令行引号处理。

**引导失败就让加载失败。** 不采用，因为那把一个可恢复、而且已经看得见的状况变成一个死掉的 profile。骨架铺不下去的沙箱照样能服务读取、memory 与额度门禁；对用户可见的信号仍然是选择器的报错。

## Testing

`packages/sci/sci-workspace/tests/bootstrap.spec.ts` 把插件挂在一个可编排的 `SubprocessRuntime` 假实现之上，并透过它断言：退出码为 0 时的 spawn spec（argv、cwd `/`、collect 模式 stdio、grace、未触发的 signal）与那条 info 日志；执行只在 seam 出现之后开始，且挂载它的那次加载并不等待它；带参数的命令按空白切分出的 argv；命令为空时不 spawn、不记日志；没有组合 seam 时不 spawn、不记日志；提供方卸载再挂载后仍然只有一次 spawn；以及各一条警告——带 stderr 尾巴的非零退出、被信号杀死、没有任何 collect 输出的退出、spawn 抛错、`done` 被拒绝、以及活过 `bootstrapTimeoutMs` 的命令（其 handle 被终止）。`pnpm exec vitest run packages/sci/sci-workspace --coverage` 保持本包逐文件 100%。

## Consequences

新的 sci VM 在插件加载时自己铺开家目录骨架，因此第一次 `workspace.create` 就能找到 `/home/user/sci/projects`。`dsh-sci-workspace` 为 `ctx.inject(['subprocess'], …)` 的声明合并新增了对 `@deepseek-ai/dsh-subprocess` 的 type-only peer 依赖；该服务仍是可选的，没有它的组合照样拥有完整路径表。家目录由别处准备的部署设 `bootstrapCommand: ''`。引导不替代镜像自身的幂等性：它每次挂载都跑，而 `sci-init` 不动已有目录，才是这件事安全的前提。
