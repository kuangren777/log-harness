# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 DeepSeek Harness 中用于启动 profile 的命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |
| `dsh auth bootstrap --email <address>` | 在 harness home 的 `auth.db` 中创建本部署的第一个管理员账号。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.zh.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="first-administrator"></a>

## 第一个管理员

`dsh auth bootstrap --email <address>` 在 `<harness home>/auth.db` 中把某个账号设为本部署的第一个管理员；`--home <path>` 覆盖 `$DSH_HOME`，未指定时后者回退到 `~/.dsh`。

该子命令刻意只在本地可用。它直接打开数据库，不启动任何 profile，也不暴露在任何网络面上，因此授权它的是对 harness home 的写权限——这正是运维人员拥有而远程调用方没有的那项权限。只要已存在任何管理员，它就立即以非零退出码拒绝，从而使它永远不会成为提权路径。

只要 `DSH_BOOTSTRAP_PASSWORD` 有定义，密码就来自该变量；否则来自不回显的终端提示。两者都没有时，命令拒绝执行并同时指出这两种方式；密码绝不从命令行接受，也绝不出现在输出或数据库中。短于 12 个字符的密码会被拒绝。

未知地址会被创建，且地址保持未验证状态，由首次登录负责验证。已存在账号的地址会被提升进管理员组，其密码保持不变——有账号却没有管理员的存储正是这样恢复的。

```sh
dsh auth bootstrap --email ops@example.com
DSH_BOOTSTRAP_PASSWORD=... dsh auth bootstrap --email ops@example.com --home /srv/dsh
```

理由以[「仅本地 bootstrap」Agent Note](../../.agents/notes/implemented/feature/2026-08-23-auth-bootstrap-cli.zh.md)为准。

<a id="profiles"></a>

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.zh.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
