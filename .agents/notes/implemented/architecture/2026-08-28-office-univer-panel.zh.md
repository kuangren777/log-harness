# Agent Note: Office 文档面板——vendor dsh-univer-office 并放到同源反代之后

Status: implemented

[English](2026-08-28-office-univer-panel.md) | 中文

## 问题

模型此前触达 office 文档的唯一路径是 `docx`/`pptx`/`xlsx` 三个 skill：只做文本级创作，没有应用内渲染。详情列此前无论如何都只显示一样东西——`ui-conversation` 的工具调用检查器——因此一份生成好的表格或幻灯片交付给用户后就再无踪迹，谁也无法在会话内看到或编辑它。同一类文档存在两条创作路径，也意味着即便建更丰富的展示面，模型依然可以绕过它去选另一条路径——不受保护的那些 skill 仍然在那里可用。

## 决策

`packages/office/univer/` 以 fork commit `97e348cf44b1eb57d5025dbf7155c8148d72683d` 全保真 vendor [`dsh-univer-office`](../../../../docs/office-univer-upstream.zh.md)，作为 `@deepseek-ai/dsh-office-univer`：`src/host`、`src/client`、`src/shared` 与 `skills/` 是按本树编译的源码拷贝；Gateway 可执行文件、Viewer、渲染机与内容 worker 则是预构建产物，从锁定的 `dsh-univer-office@0.2.10` npm 发布版拉取、按记录的 sha512 校验后解出为 git 忽略的 `artifacts/`（约 143 MB），在构建时执行。本包自身依赖的九个 Univer insider 包，经仓库根 `.npmrc` 里的三条 scoped registry 从 `insider-npm-registry.univer.work` 解析。

harness 源上的浏览器无法直接触达 Gateway 自己的 loopback 端口，因此 `gateway-proxy.ts` 把它放到 `/univer-gw`（剥前缀，转发 Viewer 文档及其分片）与 `/uf`（原样转发，文件内容路由及其 WebSocket 升级，socket 对 socket 桥接）之后。每条路由都跑与 `/api` 相同的浏览器信任检查——`ctx.connection.isTrustedRequest`——被拒绝时回 403。转发到 Gateway 的一跳会剔除 `cookie`、`authorization`、`proxy-authorization`、`forwarded` 以及所有 `x-forwarded-*` 请求头，因为 Gateway 是一个未鉴权的 loopback 服务；回程则丢弃 `set-cookie`，避免它在 harness 源上设置 cookie。上游目标只从已解析的 pathname 构造，绝不取原始请求目标的切片，因此一个在归一化后逃出前缀、或携带编码过的穿越段的路径会被 400 拒绝。若干可配置超时约束每一跳：`gatewayStartupTimeoutMs` 管冷启动，`gatewayRequestTimeoutMs`/`gatewayMutationTimeoutMs` 管 Gateway 的 HTTP 调用，`proxyTimeoutMs` 管一次被代理的浏览器请求或握手。

`sci-profile` 沿用它已经写定的平面划分：宿主行 `office-univer` 跑 Gateway、发布 `univer` 服务，配置 `tools: false, skills: false`；两个 preset 各自挂 `@deepseek-ai/dsh-office-univer/tools`，在同一个共享服务之上，并各自写 `disabledTools: [univer_screenshot, univer_lint]`，因为 dsh 镜像不带 headless Chromium。本包随包交付的 `univer_*` skills 不对外发布；由 skill vault 经 `sci-skills` 作为受保护的内置层供给，原来的 `docx`/`pptx`/`xlsx` 三个 skill 移到 `skills-retired/`，office 文档因此只剩一条创作路径。

详情列变成了一个模式环——`conversation.details.mode`，一个 `list` slot，由 `ui-conversation` 渲染成标签条；`ILayout.showDetailsMode`/`registerDetailsModeSelector` 让任何插件都能把这一列切到自己的模式，而无需导入 `ui-conversation`——`ui-sci-files` 在两条新的、按会话 cwd 围栏的 RPC（`workspace.readFile`、`workspace.listDirectory`）之上注册了 `files` 配置项。它的 `OfficeFrame` 向 `/univer-api/state` 询问文档的 Viewer 目标与 Gateway 存活状态，然后以 `mode=embedded&scope=trunk&editable=<gatewayRunning>` 组帧——只有 Gateway 应答时才授予编辑，因为一次编辑就是一次协同写入，Gateway 不在场就没有落点。这个 `viewerUrl` 会变成 `<iframe src>`，因此按其本来面目——一条 wire 边界——加以校验：`trustedViewerUrl` 与 `embeddedViewerUrl` 各自只接受 `/univer-gw/` 之下的同源相对路径，帧本身带 `sandbox="allow-scripts allow-same-origin allow-forms"`——只给 Viewer 所需的能力，不多给。

为了让面板与模型的 `univer_*` 工具看到同一份字节，`sci-gate` 在 `createVmContainer` 之前先调用 Dormice 的 `POST /acquireSandbox` 取到该租户的沙箱 id，再把 `/var/lib/dormice/mnt/<id>:/home/user:rw` 挂进 VM；一个曾被使用过的 slug 会通过墓碑表保住它的 Dormice 沙箱名，因此删除并重建租户不会导致沙箱挂载失联或冲突。

本包自身的 `license` 字段保持 `Apache-2.0`；它依赖的九个未声明许可的 Univer insider 包被记录在 `gen-third-party-notices.ts` 的 `UNIVER_PRERELEASE_PACKAGES` 中，作为一项仅限内测的、经所有者授权的分发决定——notices 仍然如实把它们的条款记为「未声明许可」，正式发布前必须先确认 Univer 的条款，才能重新分发 `artifacts/` 或这些包。

## 曾考虑的替代方案

- **跨源 iframe 上游 Viewer。** 否决：Viewer 的协同客户端需要该会话 cookie 范围内的鉴权，一个不透明的跨源 frame 会丢掉它；浏览器 CSP 也需要放行一个外部源，而协同 WebSocket 无法从跨源 frame 触达同源反代。
- **`docx`/`pptx`/`xlsx` 三个 skill 与 `univer_*` 工具并存。** 否决：同一类文档存在两条创作路径，模型可以挑面板追踪不到的那条，面板投入的展示能力对另一条路径产出的文档不生效。三个 skill 已退役到 `skills-retired/`。
- **在宿主行注册 `univer_*`。** 按本 profile 已写定的平面划分规则否决：宿主行发布跨 agent 共享的服务与注册表，而模型侧工具是 preset 自身的组合——禁用工具集按部署需要而非按共享服务而定；一个由两个 preset 都挂载的行发布出的服务，会在第二个 preset 挂载的瞬间冲突。
- **对工作区树用轮询代替显式失效信号来保证新鲜度。** 按 `ui-sci-files` 的「已知限制」否决：wire 上没有文件系统变更事件可订阅，轮询会让面板为每个已展开目录、在其整个生命周期内持续付出请求开销；一层只读一次，只在详情列重新打开时刷新。

## 后果

构建本包需要出站网络访问：既要访问 insider registry 解析九个 Univer 依赖，也要访问 npm 拉取约 143 MB 的产物；跳过 `pnpm run fetch-artifacts` 的检出没有 Gateway 可启动。`disabledTools` 在当前每个部署里都撤下了 `univer_screenshot` 与 `univer_lint`，因此在某个宿主配好 Chromium 并从配置中去掉这两个名字之前，没有任何部署提供渲染页截图或版面 lint 检查。未声明许可包的决定范围限定在内测；公开发布前的门禁必须先确认 Univer 的条款，才能更广泛地分发 `artifacts/` 或这九个 insider 包。VM 侧的 Dormice 挂载是必需项而非附带项：一个在此项接线之前建出的 VM 没有 `/home/user` 挂载，设计文档的错误处理为这个缺口命了名（`WORKSPACE_NOT_MOUNTED`），修法是 gate 侧 retag，而不是让面板或工具自行绕过。
