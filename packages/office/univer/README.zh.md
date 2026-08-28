# @deepseek-ai/dsh-office-univer

[English](README.md) | 中文

在 harness 中处理 Univer 办公文档（`.univer` 文件：表格、文档、幻灯片、白板）。一个插件组合四种角色：架在进程外 Univer Gateway 之上的 **Service Provider**（`ctx.univer`）、注册十三个 `univer_*` 工具的 **tool Consumer**、一份 **skill** 贡献，以及把 Gateway 的浏览器 Viewer 经反向代理挂到 harness 源上的 **Web Consumer**。

从 [`dsh-univer-office`](https://github.com/dream-num/dsh-univer-office) vendor 而来。fork 点、锁定的运行时发行版，以及每一处本地修改都记录在 [docs/office-univer-upstream.md](../../../docs/office-univer-upstream.zh.md)。

## 架构

Gateway 是一个独立进程而非库：它持有协作存储（libsql）、文档运行时与 Viewer 资源，并监听自己的 loopback 源（`http://127.0.0.1:<gatewayPort>`，端口被占用时逐一递增）。`GatewaySupervisor` 负责启动与回收；一次性的内容操作则改在 `unit-content-worker` 子进程中执行。

Gateway 可执行文件与 Viewer 都是**预构建的字节产物**，不由本仓库编译。`pnpm run fetch-artifacts` 会下载锁定的 `dsh-univer-office` npm 发行版，校验其 tarball 的 sha512，并解出 `artifacts/{gateway.cjs,unit-content-worker.mjs,render-machine/,viewer/}`（约 143 MB）。`artifacts/` 不纳入 git；`src/host/artifacts/paths.ts` 把每个 artifact 都锚定在包根目录上，因此同一批常量在测试中从 `src` 解析、在部署中从 `lib/index.js` 解析都指向同一处。

## 反向代理

由 harness 提供的浏览器页面无法访问 Gateway 的 loopback 源，而预构建的 Viewer 又用从 `location.origin` 推出的绝对路径访问自己的后端。因此 `src/host/webServer/gateway-proxy.ts` 在 [`dsh-host-webserver`](../../host/webserver/README.zh.md) 上注册两条前缀 route 与一条前缀 upgrade route：

| Route | 是否剥离前缀 | 用途 |
|---|---|---|
| `/univer-gw` | 是 | Viewer 文档及其 chunk。`/univer-gw/?file=KEY` 到达 Gateway 时为 `/?file=KEY`。 |
| `/uf` | 否 | Viewer 在运行时以 `/uf/<fileKey>` 请求的文件内容；原样转发。 |
| `/uf`（upgrade） | 否 | 协作 WebSocket，以 socket 对 socket 的方式桥接。 |

HTML 与 CSS 响应中的绝对 `/assets/` 引用会在送达浏览器前被改写为 `/univer-gw/assets/`，因为 harness web app 已经在提供 `/assets/*`，两者会相撞。`/assets` 上不注册任何东西。其他内容类型的响应体原样流式透传。

每一条路由都有防线。`/univer-api`、`/univer-gw` 与 `/uf` 的 upgrade 都会先跑该部署的浏览器信任检查——`ctx.connection.isTrustedRequest`，与 RPC 通道对 `/api` 所用的判断完全一致——被拒则回 403。这条防线正是 `connection` 必须注入而非可选的原因：`trustedHosts` 归它所有，在这里再复制一份策略就可能与 `/api` 判断不一致。发往 Gateway 的这一跳从本代理自己掌控的请求头集合出发：`cookie`、`authorization`、`proxy-authorization`、`forwarded` 以及全部 `x-forwarded-*` 都会被扣下，因为 Gateway 是一个无鉴权的 loopback 服务，否则就会拿到操作者的环境凭据和一个由客户端选定的来源地址。回程上 `set-cookie` 会被丢弃，使 Gateway 无法在 harness 源上种 cookie。上游目标一律由**解析后的** pathname 构建，绝不对原始 target 做切片；请求在规范化后离开了前缀，或带有编码后的穿越段，一律以 400 拒绝。

host 发出的每个 Viewer 目标（`viewerUrl`，以及各 worktree 的 `openUrl` / `worktreeUrl` / `mergeUrl`）都是同源路径，而不是 Gateway 源。没有 Gateway 在运行时，若设置了 `autoStartGateway` 则由代理启动一个，否则回应 `503 {"error":"gateway-unavailable"}`；Gateway 在响应中途死亡时，代理会重置连接，而不是把被截断的响应体当作完整响应上报。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `gatewayPort` | `9080` | 内置 Gateway 首选的 loopback 端口；被占用时逐一递增。 |
| `autoStartGateway` | `true` | 首次需要文件状态或代理请求时启动 Gateway。 |
| `gatewayStartupTimeoutMs` | `10_000` | 等待 Gateway 变为健康的时间上限。 |
| `gatewayRequestTimeoutMs` | `3_000` | Gateway 状态读取的 HTTP 超时。 |
| `gatewayMutationTimeoutMs` | `60_000` | Gateway 变更操作的 HTTP 超时。 |
| `proxyTimeoutMs` | `30_000` | 单次代理浏览器请求或 WebSocket 握手的**空闲**截止时间——每收到一个字节即重新计时，因此只有真正停摆的 Gateway 才会触发并回 504。对单次响应不设总时长上限。 |
| `unitContentOperationTimeoutMs` | `120_000` | 单个内容 worker 进程的最长存活时间。 |
| `screenshotOperationTimeoutMs` | `120_000` | 单次浏览器截图操作的最长存活时间。 |
| `screenshotMaxPages` | `30` | 单次截图调用最多捕获的页数。 |
| `screenshotMaxPixels` | `16_777_216` | 每张渲染图像的最大像素数。 |
| `resourceCacheRoot` | `$DSH_HOME/cache/dsh-univer-office/resources` | 已下载资源库 SVG 的持久缓存目录；必须是绝对路径。 |
| `resourceDownloadTimeoutMs` | `15_000` | 单次资源库下载的超时。 |
| `resourceOperationTimeoutMs` | `120_000` | 单次资源库工具调用的最长存活时间。 |
| `unitContentCommitTimeoutMs` | `5_000` | 在改用拉取确认之前，等待协作提交确认的时间。 |
| `stateCacheTtlMs` | `1_000` | 文件状态读取的新鲜度窗口。 |
| `unitCacheTtlMs` | `5_000` | 变更 Unit 读取的新鲜度窗口。 |
| `tools` | `true` | 注册面向模型的 `univer_*` 工具。 |
| `skills` | `true` | 注册随包提供的 Univer skills。 |
| `disabledTools` | `[]` | 不予注册的工具名。每一项都必须命中真实工具；未知名称在加载时抛错，而不是让部署继续对外提供一个它以为已经移除的工具。 |

`disabledTools` 是为无法满足工具前置条件的宿主准备的——没有 Chromium 就用不了 `univer_screenshot` 与 `univer_lint`，没有出网就用不了 `univer_resources`。可注册工具集合以 `UNIVER_TOOL_NAMES` 导出。

## 单独挂载工具

agent preset 会自行组合它的工具面，因此工具 Consumer 也是一行独立配置：`@deepseek-ai/dsh-office-univer/tools`。挂载它可以让某个 agent scope 在共享的宿主面 Provider 之上获得 `univer_*` 工具，而不会多出第二个 Provider 或第二个 Gateway。

```yaml
- id: tool-univer
  name: '@deepseek-ai/dsh-office-univer/tools'
  config:
    disabledTools: [univer_screenshot, univer_lint]
```

`disabledTools` 是这一行唯一拥有的配置键。所有超时、上限与路径都取自 Provider 发布的 `ctx.univer.config`，因此这一行不会与它所调用的 Provider 漂移。部署只能二选一：在包入口仍为 `tools: true` 时挂载这一行，会把每个工具名注册两次，工具注册表会拒绝。

## Model Experience

### 工具 schema

#### What the model sees

[十三个生成的 `univer_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-office-univer)，每个都作用于一个受工作区约束的 `.univer` 文件。`univer_new` 创建空容器；`univer_status` 报告 Gateway 与该文件的 worktree；`univer_worktree` 创建、合并或丢弃 worktree；`univer_unit` 增加、重命名或移除 Unit。内容经 `univer_import`、`univer_inspect`、`univer_execute`、`univer_export` 流转；`univer_lint` 与 `univer_compile_svg` 检查并构建版式；`univer_screenshot` 捕获渲染页面；`univer_api` 检索版本匹配的 Facade 参考；`univer_resources` 读取随包的 SVG 注册表。被 `disabledTools` 撤下的名字完全不出现在请求里；只有在挂载了附件存储时才会出现 `univer_screenshot`，因为它的结果必须持久引用图像字节。

#### Token effect

每次请求都有固定的 schema 开销，与该部署实际保留注册的工具数量成正比。`univer_api` 与 `univer_resources` 的描述最长。

#### KV Cache 影响

前缀稳定：定义在同一组合内是静态的，`disabledTools` 只在加载时改变一次前缀。挂载或销毁工具行会使 schema 块之后的复用失效。

### 工具结果与失败

#### What the model sees

操作类返回 `{ ok: true, operation, file, result }`，参考读取类返回 `{ ok: true, operation: 'api', result }`。`UniverError` 以 `Error [CODE]: message` 的形式到达模型——一个诸如 `GATEWAY_UNAVAILABLE`、`WORKTREE_NOT_FOUND` 或 `FILE_PERMISSION_DENIED` 的领域错误码，绝不含 Gateway URL、端口或子进程细节。工具调用卡片以 `generic` 渲染。

#### Token effect

结果体积随文档而定：对大范围 Sheet 的一次 inspect 或一次完整的 worktree 列举是主要开销，而生命周期类操作只返回少量字段。截图结果会在 JSON 之外再加上图像附件。

#### KV Cache 影响

只追加；每个结果都跟在可复用的请求前缀之后，不会使既有条目失效。

### 审批提示

#### What the model sees

`univer_worktree` 在 `action: merge` 或 `action: discard` 时经 `tools/pre-execute` 走审批 `ask`，因为两者会发布或销毁成果。模型看到的只是通常的允许或拒绝结果；理由文本（`Merging publishes the selected Univer worktree into trunk.`、`Discarding permanently removes the selected Univer worktree changes.`）送达的是审批的人，而不是请求。

#### Token effect

对请求没有影响。拒绝以标准的错误结果形式到达。

#### KV Cache 影响

无；该闸门不增加任何 prompt 内容。

## Known Limitations and Deferred Work

- **Univer 运行时是预构建的，不在此处构建。** `artifacts/` 来自经 sha512 校验的锁定 npm 发行版；Gateway、Viewer、render machine 与内容 worker 对本仓库而言都是不透明字节。升级它们意味着同时提升 `scripts/fetch-artifacts.mjs` 中的 `VERSION` 与 `INTEGRITY` 以及 vendor 进来的源码——CI 中没有任何环节会重建它们，未执行 `pnpm run fetch-artifacts` 的检出也就没有可启动的 Gateway。
- **Univer 包来自本项目无法掌控的 insider registry。** `@univer-cli/*`、`@univerjs/*` 与 `@univerjs-pro/*` 都是由 `insider-npm-registry.univer.work` 提供的预发布构建；锁定的版本不在公共 npm registry 上，而 `@univerjs-pro` 的原生绑定正是 Gateway 与内容 worker 在运行时加载的东西。
- **随包的开发许可证绑定 `localhost`，并于 2026-11-15 到期。** `src/workers/unit-content/license.ts` 原样保留了上游的许可证。该日期之后渲染与内容路径将停止接受作业，而以任何其他主机名对外可达的部署都落在该许可证的域名列表之外。
- **渲染需要 harness 并不随附的浏览器。** `univer_screenshot`、`univer_lint` 与 `univer_compile_svg` 经 `puppeteer-core` 驱动 render machine，而它需要宿主上已经存在的 Chromium。没有 Chromium 的部署应当把这些工具名写进 `disabledTools`，以免向模型提供一个跑不起来的工具。
- **vendor 进来的源码大部分不受逐文件覆盖率闸门约束。** 豁免清单写在 `vitest.config.ts` 里。有十四个由 harness 编写或修改的文件仍被 100% 闸门约束：`src/index.ts`、`src/invariant.ts`、`src/tools.ts`、`src/client/viewer-url.ts`、`src/client/viewer-locale.ts`、`src/host/config.ts`、`src/host/index.ts`、`src/host/artifacts/paths.ts`、`src/host/provider/plugin.ts`、`src/host/service/univer-service.ts`、`src/host/tools/names.ts`、`src/host/tools/plugin.ts`、`src/host/webServer/gateway-proxy.ts` 与 `src/host/webServer/plugin.ts`。其余部分——Gateway HTTP 与 worker 适配器、进程监管、文档操作、工具定义以及浏览器组件——都是锁定的上游副本，由上游自己的 smoke 套件覆盖。其中两个被豁免的文件带有本地改动，但被间接覆盖：`src/client/components/review-panel.tsx` 调用受闸门约束的 `editViewerUrl`，`src/host/provider/gateway-univer-service.ts` 产出受闸门约束的 `GATEWAY_PROXY_PREFIX`。
- **Gateway 本身没有鉴权，本代理是它唯一的防线。** 宿主进程内的任何东西都能直接访问 `http://127.0.0.1:<gatewayPort>`，不经浏览器信任检查、不做请求头剥离、也不做路径校验——上文描述的防护都在路由里，不在 Gateway 里。绑定策略属于 webserver（`host`），而这条防线不是鉴权层：它关闭的是浏览器可被利用的 DNS 重绑定与跨站路径，仅此而已。
- **带 `content-encoding` 的响应体一律不改写。** `/assets/` 重定根需要文本，而改写压缩字节会得到一个浏览器无法解码、编码头却仍声称可以解码的响应体。因此，一旦 Gateway 开始压缩 Viewer 文档，它就会送出由 harness web app 应答的 `/assets/*` 引用；没有任何机制会自动发现这一点。
- **锁定的 Univer 包没有声明许可证，因此 `gen-third-party-notices` 拒绝运行。** `@univer-cli/*` 的 insider 构建与 `@univerjs-pro/*` 的原生绑定都没有发布 `license` 字段，也没有 LICENSE 文件。`scripts/gen-third-party-notices.ts` 把它们记为 `All rights reserved (no license declared)`，而它自己的运行时许可证检查随即拒绝这一结果——这是刻意的，因为分发它们是本仓库无法推断的决定。在任何会再分发 `artifacts/` 或这些包的发布之前，先向 Univer 确认条款并记录该决定。
