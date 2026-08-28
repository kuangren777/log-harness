# Agent Note: Path open and ripgrep respect where the deployment actually runs

Status: implemented

[English](2026-08-28-sandbox-aware-path-open-and-grep.md) | 中文

## 问题

sci 部署把 `dsh` 跑在没有桌面的容器里，每次工具调用都经 subprocess seam 在独立的 Dormice 沙箱中执行。有两个交互面仍然假设自己当初被写就时的单机部署形态，而一次生产会话同时踩中了这两处。

会话中的路径点击返回 `path open failed: spawn xdg-open ENOENT`。`packages/client/ui-conversation/src/client/apply.ts` 无条件把解析后的路径交给 `workspaces.openPath`，因此在没有桌面的地方，该点击唯一可能的结果就是一次注定失败的 RPC。`host.describe` 早已发布 `canOpenPath`，connection 也早已知道页面来源是否为 loopback；`ui-deliverables/src/client/ProducedFiles.tsx` 为它的"在文件夹中显示"控件读取了这两项，但所有路径点击都汇聚经过的那个打开器两项都没读。

`grep` 工具以 `grep search failed (exit 127): /usr/bin/env: '/opt/dsh/node_modules/@vscode/ripgrep/bin/rg' …` 失败。`search-core.ts` 从 harness 一侧的 `@vscode/ripgrep` 包解析 argv 首元素，并把该绝对路径交给 subprocess seam，而后者在沙箱内执行它——那个路径在沙箱里并不存在。打包二进制恰好正确的场景，是 `ctx.subprocess` 在本进程自身文件系统中执行命令；而此前没有任何途径让部署方说明并非如此。该模块甚至把 exit 127 记为不可能发生，理由是工具不插入 shell 层；远程提供方的 exec wrapper 正是该理由漏掉的情形。

[用系统应用打开文件的决策](../feature/2026-07-28-tool-call-file-open-in-os.zh.md) 拥有链接手势与 Host 交接，[工具行文件打开失败的决策](2026-08-18-tool-row-file-open-failure.zh.md) 拥有拒绝对话框。本 Agent Note 只拥有位于两者之前的能力门禁，以及 ripgrep 命令。

## 决策

**路径打开以"是否存在本机打开器"这一对事实为门禁。** chat 视图注入的 `openFile` 仅在 Host 发布了 `canOpenPath` 且 `connection.isLoopback` 成立时才调用 `workspaces.openPath`——与 `ProducedFiles` 为其文件夹控件所用的是同一对事实，因为在远程页面上，"打开"作用于运维者的桌面而非读者的桌面。其余情形下，解析后的路径经 `writeClipboard` 写入剪贴板，并由一条 composer 通知说明这一点，该通知经 `inputHub.shell(sessionId).notify()` 路由到被点击的那个会话。该分支中 promise 正常兑现：此时并不存在需要 chat 视图提供重试的 Host 失败，因此拒绝对话框仍然只留给"尝试过并拒绝"的 Host。

门禁落在这一个 inject 上，而不是每个可点击的交互面上。`apply.ts:402` 是任何 client 包中 `workspaces.openPath` 的唯一调用者——工具行路径点击、产物文件标签和收尾消息中的提及都经它抵达 Host（`packages/client/ui-tool/tests/toolview-slot.client.spec.tsx` 固定了这条路线）——因此在此处设门即可一处覆盖全部路径点击，也把能力判断挡在展示组件之外。

**ripgrep 命令成为一个受校验的配置字段。** `tool-fs-search` 新增 `rgPath`，原样用作 argv 首元素；省略时行为不变，仍按原方式解析打包二进制。该字段透传且不在宿主侧做存在性探测，因为需要它的部署恰恰是本进程无法 stat 其 ripgrep 的那一种。两个 sci preset 均设 `rgPath: rg`，sci 沙箱镜像安装 Ubuntu 的 `ripgrep`，于是 seam 在沙箱 PATH 上解析它。

`runRipgrep` 尾部的四个标量合并为一个 `RipgrepRunLimits` 对象，两个工具的 `*ToolCaps` 继承它，于是一个上限抵达 spawn 是凭它本身就是上限，而不是凭被抄进某个位置参数。

现在每一种启动失败都会给出所用命令与修复方式：spawn 创建期抛出、`handle.done` 被拒、打包二进制无法解析，以及 exit 127。四者的 code 一律保持 `SEARCH_FAILED`——该失败作为一类即可被机器路由，只有消息需要区分它们。

## 备选方案

- **在无法打开的地方把路径渲染为纯文本。** 这是隐藏一项真实能力而非降级它，而且每个可点击交互面都要拿到能力事实才能决定怎么渲染。复制既保住了读者的手势价值，也把判断留在一个 inject 里。
- **让 `openPath` 失败，交给已有的拒绝对话框。** 该对话框适合"尝试过并拒绝"的 Host；而没有桌面的部署在构造上会拒绝每一次路径点击，于是对话框会变成一个常驻弹窗，反复报告一个无法修复的状况。
- **在加载期探测 `rgPath`，或把它绝对化。** 两者都假设 harness 能看见该文件。在沙箱部署中它看不见，探测反而会拒掉唯一正确的配置。因此加载期校验只检查该字段非空白，不做更多。
- **自动识别沙箱 seam 并切换 argv 首元素。** 那要求工具知道挂载了哪个 subprocess 提供方、以及其对侧装了什么。`rgPath` 把该事实写在部署方本来就在陈述其他随部署而变的选择的地方。
- **只在沙箱镜像里装 `rg`，不加配置字段。** argv 首元素仍然是 harness 路径。镜像改动与配置字段两者都必需，镜像注释也这么写了。

## 影响

没有桌面打开器的部署不再产生死点击；远程页面上的读者得到路径，而不是一次会落到错误机器上的打开。带真实打开器的 loopback 部署行为不变。

两条 `SEARCH_FAILED` 启动失败消息多了一句修复提示，因此沙箱部署里的 `grep` 失败会说明该配置什么，而不是抛出一个在实际执行搜索的机器上并不存在的路径。

`runRipgrep` 的签名变了。鉴于处于预发布阶段，两个调用点和两个直接单测调用方随之迁移，而不是新增重载。

`rgPath: rg` 要能解析，sci 沙箱镜像必须重建；preset 行与镜像安装是同一处改动，而对着没有 ripgrep 的镜像设置 `rgPath` 会得到点名 `rg` 的 exit-127 消息。

## 测试

`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` 从两侧覆盖门禁：`canOpenPath: true` 加 loopback 仍然发出 `openPath` RPC，也仍然在 Host 拒绝时 reject；而三种不可打开的姿态（Host 未发布打开器、description 尚未到达、页面非 loopback）都不发出 RPC，把解析后的路径写入被打桩的 `navigator.clipboard`，并留下一条携带该路径的 composer 通知——剪贴板写入被拒时为 `level: 'error'`。

两个挂载真实 conversation apply 以断言点击路线的 `packages/client/ui-tool` spec（`toolview-slot.client.spec.tsx`、`chat-code-subcalls.client.spec.tsx`）现在打桩为可打开的 Host 姿态，因为它们断言的那次 RPC 正是门禁所准许的；其中 bash 摘要用例仍然证明那类点击不打开任何东西。

`packages/fs/tool-fs-search/tests/tools.spec.ts` 固定：两个工具都以配置的 `rgPath` 作为 argv[0]（裸命令与绝对路径），字段缺席时以打包二进制作为 argv[0]，空白值在加载期被拒，以及 exit 127（有/无配置命令两种）与 spawn 被拒时的消息内容。`packages/fs/tool-fs-search/tests/rg-path.spec.ts` 补上打包解析失败的消息，并证明一旦配置了命令，`resolveRgCommand` 绝不触碰 `@vscode/ripgrep`。
