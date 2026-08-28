# e2b/ — E2B 远程运行时家族

[English](README.md) | 中文

这是一个实验性提供方组合 POC，把一个文件系统／进程执行环境放进 E2B Linux 沙箱。E2B 提供沙箱生命周期、两个基础 OS 适配器，以及基于同一沙箱的 GUI 宿主目录选择；提供方无关的消费方在其上构建更高层能力。每个 context 恰好挂载一个沙箱 provider（提供方）。

| 包（package） | ctx 键 | 职责 |
|---|---|---|
| [`e2b`](e2b/README.zh.md)（`@deepseek-ai/dsh-e2b`） | `ctx.e2b` | 定义沙箱能力缝：共享的工作目录与运行时目录、唯一被等待的 SDK 句柄，以及 SDK 登录 shell 相关 helper |
| [`e2b-cloud`](e2b-cloud/README.zh.md)（`@deepseek-ai/dsh-e2b-cloud`） | `ctx.e2b` | 由托管的 E2B Cloud 提供沙箱：创建一个沙箱，准备其目录，并在超时或资源释放时将其删除 |
| [`dormice`](dormice/README.zh.md)（`@deepseek-ai/dsh-dormice`） | `ctx.e2b` | 由自托管 Dormice daemon 提供沙箱：按用户 key 取用，跨会话保留，且从不删除 |
| [`fs-e2b`](fs-e2b/README.zh.md)（`@deepseek-ai/dsh-fs-e2b`） | `ctx.fs` | 通过 E2B Filesystem API 实现文件系统 seam |
| [`subprocess-e2b`](subprocess-e2b/README.zh.md)（`@deepseek-ai/dsh-subprocess-e2b`） | `ctx.subprocess` | 通过 E2B Commands 与 PTY API 实现可执行文件查找、受管进程组与 stdio、远程 spill 文件及终端会话 |
| [`directory-picker-e2b`](directory-picker-e2b/README.zh.md)（`@deepseek-ai/dsh-host-directory-picker-e2b`） | `ctx.directoryPicker` | 在沙箱内实现 GUI 宿主的 `browse` 目录选择，使操作者所选的工作区目录是沙箱能够进入的目录 |

现有的 [`dsh-bash-local`](../shell/bash-local/README.zh.md)、[`dsh-terminal-bash`](../terminal/terminal-bash/README.zh.md) 和 [`dsh-lsp-stdio`](../lsp/lsp-stdio/README.zh.md) 无需 E2B 专用 fork。它们把执行环境中的所有操作委托给 `ctx.fs` 和 `ctx.subprocess`，因此挂载这两个 E2B 适配器后，它们所有涉及可变状态的工作都发生在同一个沙箱内。

该边界不会迁移 harness 进程、Cordis 对象、模型调用、agent（智能体）／会话状态、会话持久化、skill（技能）、更高层协议状态或 E2B SDK 缓冲。[可移植执行世界决策](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.zh.md)同时界定通用组合和此 POC 边界。
