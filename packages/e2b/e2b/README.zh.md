# @deepseek-ai/dsh-e2b

[English](README.md) | 中文

E2B 沙箱能力缝的 Service Definition（服务定义）。文件系统与进程管理适配器注入 `ctx.e2b` 并等待其唯一的 SDK 句柄，因此无论沙箱由哪个 provider（提供方）供给，它们都处于同一个远程 Linux 工作树与进程环境中。本包固定使用 `e2b@2.29.1`，并重新导出适配器所需的 SDK 接口；provider 列表与可选组合见[包族索引](../README.zh.md)。

本包自身不可加载——它只声明能力缝。请挂载一个 provider：[`dsh-e2b-cloud`](../e2b-cloud/README.zh.md) 对应托管的 E2B Cloud 沙箱，[`dsh-dormice`](../dormice/README.zh.md) 对应自托管的 Dormice 沙箱池。

## 能力缝拥有什么

`E2BRuntime` 是注册在 `e2b` 键上的抽象 Cordis 服务。其构造函数接收共享的绝对工作目录，拒绝非绝对的 Linux 路径，并派生出每个适配器都会读取的两个路径：

- `cwd`——共享的远程工作目录。
- `runtimeRoot`——即 `cwd/.dsh-e2b`，预留给适配器自有的进程与终端状态。该相对名称是固定的（`E2B_RUNTIME_DIRECTORY`），因此某个 provider 的沙箱写入的状态正好位于适配器查找的位置。

Provider 实现唯一的方法 `getSandbox()`：它在上述两个目录都存在之后返回共享的活动 SDK 句柄。重复调用会等待同一次获取并返回同一个句柄；获取失败会传达给每一个调用方；资源释放会首先拒绝新的获取，而是否同时删除沙箱则属于 provider 的生命周期策略。

本包导出两个 helper（辅助函数），因为两个适配器都要用它们应对 SDK 固定的 `/bin/bash -l -c` 层：

- `quoteE2BShellArg(value)`——把一个不透明参数变成单个 shell 词，不做任何插值。
- `e2bControlEnvs(overrides)`——为每个适配器内部命令提供位于根目录下、全新随机生成的 `HOME`，使登录 shell 无法在控制命令之前解析可变用户主目录中的配置文件。

## 配置

无。所有随部署变化的值（凭据、沙箱生命周期、工作目录、获取策略）都是 provider 的 `Config` 字段。

## 模型体验

无。本 Service Definition 不注册模型可见上下文；provider、适配器及其消费方拥有所有渲染效果。

#### KV Cache 影响

不会直接失效；本包不会贡献请求 token。

## 已知限制与延后工作

- **这不是完整的 harness 运行时**：Cordis 服务、agent（智能体）／会话状态、会话日志、LLM（大语言模型）请求、skill（技能）和 SDK 侧缓冲仍留在宿主进程中。
- **`cwd` 是解析约定，而不是包含边界**：适配器和命令可以访问沙箱中的其他路径，网络访问也继续采用沙箱镜像的策略。
- **能力缝固定了单一 SDK 版本**：provider 通过本包的重新导出访问 E2B SDK，因此若不把这里的固定版本一并移动，provider 无法运行在不同的 `e2b` 发行版上。
