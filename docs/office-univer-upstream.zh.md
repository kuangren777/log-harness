# Vendor 的上游：dsh-univer-office

[English](office-univer-upstream.md) | 中文

[`@deepseek-ai/dsh-office-univer`](../packages/office/univer/README.zh.md) 是 [dream-num/dsh-univer-office](https://github.com/dream-num/dsh-univer-office) 的一份锁定源码副本，针对本仓库编译，并附带取自该项目 npm 发行版的预构建 Univer 运行时。本页记录复制了什么、改动了什么，以及如何迁移到更新的上游。

## 锁定信息

| 项 | 值 |
|---|---|
| Fork commit | `97e348cf44b1eb57d5025dbf7155c8148d72683d` |
| Artifact 发行版 | `dsh-univer-office@0.2.10` |
| Artifact 完整性校验 | `sha512-drpBS6irjbyUq8MKyr/ya/G1pSLVnVTyExtaeJI0yOsP0NVJkubZyPaPxAAFF2k18s41yEIrYjcl4j/PXjDMsg==` |
| Univer 包 | `1.0.0-insiders.20260822-0c0c0dd`（`@univerjs-pro/engine-formula-rust-binding`：`1.0.0-insiders.20260819-8209aa8`；`@univerjs-pro/cli-assets` 与 `@univerjs-pro/exchange-node-binding`：`0.1.0`） |

发行版版本及其完整性哈希只在 `packages/office/univer/scripts/fetch-artifacts.mjs` 中声明一次；上表是它的镜像。

## 复制了什么，没复制什么

作为源码复制：`src/host/**`、`src/client/**`、`src/shared/**`、`src/workers/unit-content/license.ts` 与 `skills/**`，保持上游的文件布局。

未复制：`src/viewer-app`、`src/viewer-support`、`src/gateway-app`、`src/render-machine`，以及 `src/workers` 的其余部分。它们是 Univer 应用代码，构建需要 Univer 的 insider 工具链外加一个浏览器。取而代之的是它们的编译产物，即 `artifacts/gateway.cjs`、`artifacts/unit-content-worker.mjs`、`artifacts/render-machine/` 与 `artifacts/viewer/`——约 143 MB，由 `pnpm run fetch-artifacts` 获取，且不纳入 git。

与初读的印象相反，`src/host` 并非不含 Univer：`provider/render-operations.ts`、`provider/render-source-operations.ts`、`provider/resource-operations.ts` 与 `provider/gateway-univer-service.ts` 以运行时值的形式导入 `@univer-cli/*`，而 `artifacts/paths.ts` 会解析 `@univerjs-pro/engine-formula-rust-binding`。这些包来自 `https://insider-npm-registry.univer.work/`，作为该包的普通 dependencies 声明；工作区根目录的 `.npmrc` 需要那三行 scoped registry 配置，install 才能解析它们。

## 本地修改

以下每一项都是相对 fork commit 的有意分歧。迁移到更新的上游时，需逐条重新应用或撤除。

### 从 harness 源提供 Viewer

上游运行在浏览器可直接访问 Gateway loopback 源的部署形态里。本仓库由 harness web 服务器向浏览器提供页面，因此 Gateway 必须移到一个同源反向代理之后。

- **`src/host/webServer/gateway-proxy.ts`（新增）。** 把 `/univer-gw`（剥离前缀）与 `/uf`（原样）转发给 Gateway，以 socket 对 socket 的方式桥接 `/uf` 的 WebSocket，将 HTML 与 CSS 响应体中的绝对 `/assets/` 引用改写为 `/univer-gw/assets/`，并在没有可达 Gateway 且 `autoStartGateway` 关闭时回应 `503 {"error":"gateway-unavailable"}`。
- **`src/host/webServer/plugin.ts`。** 接收 `ResolvedConfig`，在既有的 `/univer-api` route 旁注册三条代理 route。
- **`src/host/provider/gateway-univer-service.ts`。** `viewerUrl` 以及各 worktree 的 `openUrl` / `worktreeUrl` / `mergeUrl` 改由 `GATEWAY_PROXY_PREFIX` 而非 Gateway 源构造，因此浏览器收到的每个目标都是同源路径。query string 不变。
- **`src/client/viewer-url.ts`（新增）** 及其在 `src/client/viewer-locale.ts` 与 `src/client/components/review-panel.tsx` 中的调用方。上游用 `new URL(url)` 编辑 Viewer 目标，而它会拒绝没有源的路径。三处调用现在共用一个 helper：针对占位 base 解析，输入为相对路径时返回相对结果。
- **`packages/host/webserver`** 的 `registerUpgrade` 新增了 `kind: 'exact' | 'prefix'`，默认为 `exact`，因为 Viewer 在运行时才选定 WebSocket 子路径。upgrade 派发现在与请求派发共用最长前缀优先的解析。

### 从包根目录解析 artifacts

**`src/host/artifacts/paths.ts`。** 上游相对 `import.meta.url` 解析 `../artifacts/…`，这只对它单文件的 `lib/index.js` bundle 正确，而当同一模块从 `src` 被引用时是错的。这些路径现在挂在最近一层含 `package.json` 的祖先目录上，因此针对源码运行的测试与针对 `lib` 运行的部署都指向同一处物理 `artifacts/`。

### 撤下宿主跑不了的工具

- **`src/host/tools/names.ts`（新增）。** `UNIVER_TOOL_NAMES`，十三个可注册工具名，导出以便组合及其测试引用。
- **`src/host/config.ts`。** 新增 `disabledTools`，在加载时针对 `UNIVER_TOOL_NAMES` 校验；未知名称抛错。
- **`src/host/tools/plugin.ts`。** 注册统一经过一个会跳过被撤下名称的 `register` helper，使该决定在做出它的那个操作里被执行。

### 仓库约定

- **`src/index.ts`、`src/types.ts`、`src/invariant.ts`（新增）。** 本仓库每个包都拥有的包入口、纯类型面与 invariant 伴生插件。
- **`src/client/index.tsx` 更名为 `src/client/index.ts`。** `packages/client/tsdown.client.ts` 把 `src/client/index.ts` 硬编码为 client 入口；该文件不含 JSX。
- **`src/workers/unit-content/license.ts`** 是从一个整体被排除的目录中唯一复制出来的文件，因为 `provider/render-operations.ts` 从中导入许可证常量。
- **包名与插件名** 分别为 `@deepseek-ai/dsh-office-univer` 与 `dsh-office-univer`。
- **对 `@deepseek-ai/*` 的 peer 与 dev 依赖** 使用 `workspace:^`，取代上游的 `0.1.0-rc.8` 锁定。未发现 API 漂移：两个编译面针对本仓库的 `0.1.1-rc.2` 包均无需改动源码即可通过类型检查。
- **未沿用 `cordis.patch.yml`。** 组合在这里是 sci profile 的职责，因此该包不声明 `dsh.bundle.patch`。

## 升级流程

1. 拉取上游仓库，从上面记录的 fork commit 开始阅读其变更日志。
2. 重新复制 `src/host`、`src/client`、`src/shared`、`src/workers/unit-content/license.ts` 与 `skills`，然后逐条重新应用上面列出的本地修改。代理、artifact 路径与 `disabledTools` 是最可能冲突的三处。
3. 把 `packages/office/univer/scripts/fetch-artifacts.mjs` 中的 `VERSION` 与 `INTEGRITY` 提升到对应的 npm 发行版。新的完整性哈希用 `npm view dsh-univer-office@<version> dist.integrity` 读取。
4. 把 `packages/office/univer/package.json` 中的 Univer 依赖版本提升到新上游锁定的版本。
5. 在该包内运行 `pnpm run fetch-artifacts`，随后运行 `pnpm tsc -p packages/office/univer/tsconfig.json --noEmit`、client tsconfig、`pnpm tsx scripts/run-oxlint.ts packages/office/univer` 与 `pnpm vitest run packages/office/univer/tests`。
6. 更新本页的锁定信息表与修改清单，并重新记录翻译配对。
