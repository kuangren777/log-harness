# Agent Note: fs-e2b 将沙箱命令并发限制为四路在飞

Status: proposed

[English](2026-08-27-fs-e2b-command-concurrency-cap.md) | 中文

## Problem

`sci` profile 首次在 Dormice（gVisor）沙箱上生产部署时陷入重启崩溃循环。`dsh-sci-skills` 在启动时重新同步技能树；对已有内容的沙箱，这次遍历会 resolve 每一个文件，而 `fs-e2b` 在没有扩展属性的后端上，每个 `resolve()` 要跑一次 `realpath` 进程、每个条目再跑一次 `stat` 进程。223 个文件在一个 `Promise.all` 下达到每秒 209 次 `process.Process/Start`，gVisor sentry 崩溃：所有在飞操作以 `containerManager.WaitPID: EOF` 失败，容器退出，harness 的 fail-loud 启动把它变成重启循环，进而把守护进程锤到 HTTP 响应损坏（`ERR_HTTP_HEADERS_SENT`）。

首次部署没有触发是因为全新沙箱走纯写入路径（envd 文件 API，每条目零进程）；遍历对比路径只在树已存在时运行。诊断证据：守护进程日志 40 分钟内记录 4666 次 `process.Process/Start`，峰值 209/s；崩溃特征为容器退出码 2、`OOMKilled=false`、内核侧无痕迹；全新沙箱、回滚 profile patch、重启守护进程都仍崩溃，而不带文件流量的裸 `acquireSandbox` 保持稳定。

## Proposal

`E2BFileSystem` 将每次 `sandbox.commands.run` 路由过一个私有的四槽信号量（`withCommandSlot`）。文件读写走 envd 的文件 API 而非进程派生，不受限流。

上限放在 provider 而不是调用方，因为任何调用方都可以合法地扇出（`sci-skills` 同步是一个，并行工具循环是另一个），而崩溃是后端运行时的属性。它是常量而不是配置：进程并发容忍度是 provider 所面向的 gVisor 运行时的稳定性不变量，在能承受更多并发的后端上，这个上限只在派生进程的操作（resolve、inode stat、原子写路径的 chmod/ln）上付出延迟。

## Acceptance criteria

- 30 个 `resolve()` 的 `Promise.all` 打在命令会停留在飞的 mock 上，观察到的命令并发峰值至多为四，且每个路径都成功解析（`tests/filesystem.spec.ts`）。
- 部署的 `sci` profile 对已有内容的沙箱启动时不再出现 sentry 崩溃：harness 达到 HTTP 200，沙箱容器在技能树同步全程保持运行。

## Risks

- 派生进程的操作在四个槽后串行化，病态扇出会变慢而不是失败；槽只在进程派生期间持有，每操作增加的延迟为一次命令往返。
- 常量编码的是实测的 gVisor 容忍度而非文档化上限；若未来某个后端在四路并发以下就崩溃，上限必须调整，事实记录在本 Note 与 `withCommandSlot` 的 JSDoc。

## Alternatives considered

- 把逐条目的 inode `stat` 合并为每目录一次进程：太窄——`canonicalPath`（每个 `resolve()` 一次进程）仍不受限，而 200 宽的 resolve 扇出本身就能复现崩溃。
- 在 `sci-skills` 的同步里限流：所有者错了——其它扇出调用方（并行工具循环、未来消费者）都需要同样的修复，而崩溃是 provider 所面向后端的属性。
- 把上限做成配置字段：在没有需要它的部署前拒绝引入可调项；该值是目标运行时的稳定性不变量，不是按部署的选择。
