---
name: deepseek-harness
description: 本地从源码构建/开发/跑 DeepSeek Harness (dsh)，源码在 ~/codes/deepseek-harness。日常改源码后的构建、web/headless 跑法、监控 pnpm dev watch。触发词："dsh""deepseek harness""dsh web""dsh headless""跑 harness""改 harness 源码""harness 构建失败"。
---

# DeepSeek Harness 本地开发

TypeScript/Node monorepo（非 Python，尽管仓库里有个 `python/` 目录和 `pytest.ini`，那是 single-exe 打包用的依赖清单，不是主栈）。源码在 `~/codes/deepseek-harness`。

## 前置

- Node 22.19+/24+（本机 `node -v` = v22.22.0，够）
- pnpm 固定 `11.7.0`（`package.json` 的 `packageManager` 字段钉死）——先 `corepack enable`，`pnpm --version` 会自动解析到 11.7.0，别用系统装的旧版直接跑
- `.env`（gitignored，别提交），**只放 `DEEPSEEK_API_KEY`**：
  ```
  DEEPSEEK_API_KEY=sk-...
  ```
  未设置时真实 API 的 e2e 测试自动跳过，web UI 能开但模型调用会失败。
  - ⚠️ **`DEEPSEEK_BASE_URL` 不能放 `.env`**——app-boot 会硬拒绝并报错退出("only the launching environment may set")，因为它决定进程从哪加载代码/指令、连哪个网络，属于启动器专属变量。走网关（如 CaMeL-api 的 `https://api.camel-hub.cn`）时必须 `export DEEPSEEK_BASE_URL=...` 在起 `dsh` 的同一条命令行/shell 里，不能写进文件。

## 首次搭建

```bash
cd ~/codes/deepseek-harness
corepack enable        # 只需一次，解析 pnpm 到仓库钉的版本
pnpm install            # ~45s，装完自动跑 lefthook 钩子 + spawn-helper postinstall
pnpm run typecheck      # 验证搭建完成，成功退出即可
```

## 日常跑

```bash
pnpm run build           # 首次跑 dsh 前必须先跑一次全量构建
pnpm dsh web             # 用构建产物起 web UI，默认 http://127.0.0.1:3080
pnpm dsh --profile headless "summarize this workspace"   # 单次 headless agent，需要 DEEPSEEK_API_KEY
```

走网关时（`DEEPSEEK_BASE_URL` 不在 `.env` 里，见上）：
```bash
export DEEPSEEK_BASE_URL=https://api.camel-hub.cn
pnpm dsh web --no-open
```
实测：`http://127.0.0.1:3080` 起来后 `curl -sS http://127.0.0.1:3080/` 返 HTTP 200（08-19 已验证）。

`pnpm run build` 阶段顺序（生成依赖排序，别打乱）：
```
tsc -b tsconfig.host.json → tsdown --env.DSH_BUILD_FACE host →
tsc -b tsconfig.client.json → tsdown --env.DSH_BUILD_FACE client →
pnpm run build:web
```

## 改源码后的热重载开发（**关键，会经常用**）

`pnpm run build` 是全量构建，改一行源码重跑一次要等完整链路。日常改代码用 watch 脚本：

```bash
pnpm exec tsx scripts/dev-web.ts --poll
```

- **前提**：必须先跑过一次 `pnpm run build`（watch 是增量的，不会从零 bootstrap）
- `--poll`：本机若源码目录在网络挂载（weka 等）上原生 inotify 收不到事件，watch 会看起来"改了没反应"——不确定就一律加 `--poll`（默认轮询间隔 500ms）
- **禁止**和 `pnpm run build` 同时跑：两者写同一份 `lib/` 和 `apps/web/dist/` 树，会互相踩
- 某一阶段没跑不会报错，只是静默显示旧产物——改了源码但页面没变化，先怀疑这个而不是代码逻辑错

## 常用检查（提交前）

```bash
pnpm run typecheck   # host lib 全量阶段 + client tsc
pnpm run lint         # 同上 + oxlint
pnpm run test         # vitest run
pnpm run check:all    # 本地全量门禁集（比 CI 单个 lane 更全，非必须但可选）
```

Git hooks（lefthook）已自动装好：`pre-commit` 校验暂存文件 + oxlint 修复，`pre-push` 跑 `pnpm run typecheck`。**hooks 故意不跑测试/构建**——那是 CI 的活，本地按改动范围挑最小检查集就够。

## 目录速览

| 路径 | 内容 |
|---|---|
| `apps/cli/` | `dsh` bin 入口 |
| `apps/web/` | web UI（Vite），`dsh web` 服务它的 dist |
| `packages/*/*` | 插件化的功能包（llm/session/tool/mcp/...），everything-is-a-plugin 架构基于 Cordis |
| `packages/llm/llm-deepseek/` | DeepSeek 适配器，`PUBLIC_BASE_URL = 'https://api.deepseek.com'` |
| `python/sdk-runtime/` | single-exe 打包用的 Python 运行时依赖清单，不是开发主路径 |
| `docs/development.zh.md` | 官方开发指南中文版，比这份 skill 更权威，改动大时先查它 |
| `AGENTS.md` | 面向 agent 的贡献者说明，`docs/development.zh.md` 引用它 |

## 常见踩坑

1. **pnpm 版本不对** → workspace 解析报错或 lockfile 冲突，先确认 `corepack enable` 跑过、`pnpm --version` = 11.7.0。
2. **忘了先 `pnpm run build` 直接跑 `pnpm dsh web`** → 报缺产物或页面空白，watch/build 都是增量的，没有全量产物时无法 bootstrap。
3. **`dev-web.ts` 和 `pnpm run build` 同时跑** → 互相踩 `lib/` 和 `apps/web/dist/`，产物损坏，杀掉一个重新全量 build。
4. **网络挂载目录下 watch 不生效** → 加 `--poll`。
5. **改了 vendor/*/src 下代码没同步更新 `vendor/README.md` manifest** → pre-commit 的 vendor manifest 守卫会拦。
