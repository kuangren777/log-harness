# Agent Note: the filesystem seam gains an unguarded raw-byte write

Status: proposed

[English](2026-08-30-fs-write-bytes.md) | 中文

## Problem

`ctx.fs` 能读原始字节（`readBytes`），却只能写文本。该 seam 上的每个变更操作——`writeText`、`editText`——都会解码 UTF-8、按 NUL 采样拒绝二进制、并规范化行尾，因此持有二进制载荷的宿主插件没有任何办法把它放进执行世界，让模型的工具和 shell 看到。

`dsh-sci-deliver` 已经在为这个缺口付出代价：`packages/sci/sci-deliver/src/fs.ts` 之所以在 seam 之外自建一层按路径的适配器，理由写的就是「`FileSystem` …… 不提供二进制写入」；它的快照路径把二进制内容以 base64 文本存成 `.base64` 后缀的文件。这个绕法产生的文件，沙箱里其他任何工具都打不开，而且体积是所载载荷的 4/3。

知识库这项工作把这个缺口从「烦人」变成了「卡住」。`dsh-sci-library` 要下载开放获取的 PDF、接收浏览器上传的文件（PDF、CSV、Parquet、xlsx、zip），然后必须把它们落到会话沙箱的知识库根目录下，好让文件面板、`read` 工具和模型的 PDF 技能都能取到。对一个用户马上要打开的文件来说，base64 文本不是选项；而在 seam 之外另开一条写入路径，又会绕过 `dsh-fs-sandbox` 施加于其他每个变更操作的沙箱围栏。

## Proposal

`FileSystem` 新增第十三个原语：

```ts ignore-check
abstract writeBytes(target: FsTarget, data: Uint8Array, signal: AbortSignal | undefined): Promise<void>
```

参数风格跟随它的读取对应物 `readBytes`：`signal` 是必填的位置参数，而不是文本变更操作使用的可选尾参 `signal?`，因为它前面没有 `expected` 防护，可选 signal 反而读不清楚。

每个后端对调用方的约定：

- 与 `writeText` 完全一样，创建缺失的父目录。
- 只要后端具备原子替换能力，发布就是原子的：读取方看到的要么是旧文件，要么是完整的新文件，绝不会是写了一半的文件。
- 写入是无条件的。没有 `FsWriteIntent`、没有版本防护，因此也没有任何 `fs/write-intent` 决策——`fs/*` 事件门禁维持今天的定位：面向模型的工具层针对 `writeText`/`editText` 的政策。
- 载荷超过后端配置的 `maxWriteBytes` 时，在任何内容离开宿主之前就以既有的 `FS_TOO_LARGE` 码拒绝，因此超限缓冲绝不会到达远程传输或磁盘。不需要新增 `FsErrorCode`：该分类法已经为 `readBytes` 命名了这种失败。
- 已存在的非普通文件目标以 `FS_NOT_REGULAR_FILE` 拒绝；会约束变更的后端按调用会话解析出的沙箱策略加围栏（`FS_SANDBOX_DENIED`）。

与 `writeText`/`editText` 不同，这里没有按调用传入的 `sandboxPolicy` 参数。那个参数的存在，是为了让工具层把一次已批准的提权盖在模型请求的一次调用上；`writeBytes` 没有面向模型的工具，因此没有提权路径，它的调用方拿到的就是会话解析出的策略，不会更宽。

### 各 provider

`dsh-fs-local` 复用 `src/fsio.ts` 的 `writeFileAtomic`，其 `content` 参数从 `string` 放宽为 `string | Uint8Array`——暂存目录、排他 `0o600` 临时文件、fsync、mode 保留、Windows DACL 处理和 rename 对字节而言本来就是对的，再抄一份那套机制才是真正的风险。该写入取用与 `writeText` 相同的按目标锁，因此同一路径上的字节写入与文本写入不会交错。

`dsh-fs-sandbox` 覆写 `writeBytes`：先跑 `checkedTarget()`——同一套「先规范化再判包含」的围栏，作用在重新解析出的新目标上——再委托给继承来的实现。

`dsh-fs-e2b` 把载荷作为二进制体经 envd 的文件 API 上传（`sandbox.files.write` 接受 `ArrayBuffer`），复用既有的暂存目录发布流程。这正是 SDK 级字节写入的意义所在：不需要 base64 shell 往返，内容也不占用任何 `commands.run` 槽位，因此[命令并发 Agent Note](2026-08-27-fs-e2b-command-concurrency-cap.zh.md) 所要保护的四槽 spawn 上限不受载荷大小影响。只有周边的 `chmod` 步骤会占用槽位，与今天的 `writeText` 完全相同。载荷会被复制进一个大小精确的 `ArrayBuffer`，而不是直接交出 `data.buffer`，因为 `Uint8Array` 可能只是更大缓冲池上的一个视图——Node 的每个 `Buffer` 都是。

`maxWriteBytes` 是两个具体 provider 上经过校验的 `Config` 字段，默认 64 MiB，上限为运行时的 `buffer.constants.MAX_LENGTH`。它是部署选择，而不是稳定性不变量：上传上限取决于某个部署希望它的用户能存多大，而 `dsh-sci-library` 在这个 seam 之上另设了自己的 50 MiB 限制。`dsh-fs-sandbox` 原样继承本地后端的配置。

## Alternatives considered

**像 `sci-deliver` 那样，继续用 `writeText` 写 base64 文本。** 作为主力路径被否决：存出来的文件，沙箱里其他每个消费方——`read` 工具、文件面板的预览、PDF 技能、任何 shell 命令——都打不开，而这恰恰是一个面向用户的文档库最需要的能力。它还让每份载荷膨胀三分之一，并在两端各烧掉一次完整的 UTF-8 编解码。`sci-deliver` 既有的 `.base64` 快照维持原样；迁移它们是另一件事，有它自己的兼容性问题。

**给 `writeBytes` 配上 `FsWriteIntent` 和 `sandboxPolicy`，与 `writeText` 对称。** 因缺少消费方而否决：这两个参数的存在都是为了服务面向模型的工具层——强制「覆盖前先读」的观察政策，以及单次调用的提权授权。`writeBytes` 没有工具。现在加上它们，意味着三个 provider 里多出一条没被测过的防护路径，以及一个没有任何监听器准备为二进制载荷作答的 `fs/write-intent` waterfall。该 seam 的 pre-release 立场是等到有消费方需要时再加，缺失的防护则作为已知限制记在 `dsh-fs` 上。

**像 `writeText` 那样返回 `FsWriteOutcome`。** 否决：`before`/`after` 是给消费方算上下文 diff 用的、经 LF 规范化的**文本**，而 `operation`/`version` 服务的是本方法并不具备的带防护写入流程。返回一个没有调用方能用的 version，只会诱使调用方去搭一套 provider 并未实现的字节级 compare-and-set。

**单独开一个二进制文件系统 seam，或者做 `writeStream`。** 作为过早设计被否决。另开一个 seam，会为了一个方法就把沙箱围栏、按目标锁和目标词汇拆到两个服务里。对于不该整体缓冲的载荷，流式写入才是真正的答案，但当前没有任何消费方产出流——知识库路由本来就要缓冲 multipart 请求体——因此当前消费方需要的就是这个有界的单缓冲写入，而 `maxWriteBytes` 让这块缓冲的代价变得显式。

**把上限放在调用方而不是 provider。** 否决：这个界必须对该 seam 的每一个调用方都成立，而 provider 是唯一知道自己传输层能承载多少的地方。`dsh-sci-library` 自己更小的限制是叠在上面的产品政策，而不是替代品。

## Acceptance criteria

- `FileSystem` 声明 `writeBytes`，且 `dsh-fs-local`、`dsh-fs-sandbox`、`dsh-fs-e2b` 都实现它；`pnpm exec tsc -b tsconfig.host.json` 退出码为 0，仓库内每个 `FileSystem` 子类都是具体类。
- 每个具体 provider 都能把 1 MiB 随机字节经 `readBytes` 原样往返、创建缺失的父目录、保留现有文件的 POSIX mode、在载荷超出 `maxWriteBytes` 一个字节时以 `FS_TOO_LARGE` 拒绝且保持原文件不变，并以 `FS_NOT_REGULAR_FILE` 拒绝目录目标。
- 同一目标上的 `writeBytes` 与带版本防护的 `writeText` 竞争时，由 provider 的按目标锁串行化：字节写入提交，排在它后面的文本写入报告 `FS_STALE_VERSION`。
- `dsh-fs-sandbox` 在 `read-only` 下拒绝 `writeBytes`，在 `workspace-write` 下对可写根之外的目标（包括经由指向外部的符号链接目录）拒绝，且磁盘上不留下文件；在 `danger-full-access` 下直接放行。
- `dsh-fs-e2b` 经 `sandbox.files.write` 发送 `ArrayBuffer` 体，且不为载荷发出任何 `base64 -d` 命令。
- `packages/fs` 与 `packages/e2b` 保持每文件 100% 覆盖率。

## Risks

- **该 seam 多出一个没有防护的方法。** 未来若要做面向模型的二进制写入工具，就需要把 intent 参数加到三个 provider 上，并教会观察政策为它作答。这条限制记在 `dsh-fs` 的 README 里，好让人在基于这个无防护方法搭工具之前先看见这个缺口。
- **`writeFileAtomic` 现在服务两种内容类型。** 它的 `handle.writeFile` 调用对两者都传 `encoding: 'utf8'`，而 Node 对 `Uint8Array` 会忽略该参数。万一哪天这个参数不再被忽略，字节写入就会静默损坏；`fs-local` 的往返测试会抓到。
- **64 MiB 默认值是判断，不是实测。** 它限制的是每个在途写入在宿主侧的一块缓冲，因此同时扇出多个大写入的部署仍可能压迫宿主内存。该 seam 没有流式写入可回退，这正是本 Note 明知而接受的延期项。
- **`dsh-fs-e2b` 有了它的第一个 `Config`。** 它的 README 此前写的是「没有配置」；如今若某个部署以不可用的 `maxWriteBytes` 挂载它，会在加载时就大声失败，而不是等到第一次大写入——方向是对的，但这是启动阶段一个新的失败点。
