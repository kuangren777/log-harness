# Agent Note: 声明了 preset 根的 profile 保得住它

Status: implemented

[English](2026-08-27-profile-declared-preset-roots.md) | 中文

## Problem

`apps/cli` 的 `composeProfile` 为组合出的 `agent-presets` 行追加一层 last-wins overlay，把 `roots` 整体替换成启动器自己随安装发布的 preset 树（`apps/cli/config/agent-presets`）。随包发布的根**必须**由启动器提供——它就在 app 自己的 config 旁边，源码布局与构建布局都如此——但「替换而非合并」让这个字段对其他任何人都不可写：写在组合包 patch 层里的值每次启动都被丢掉。

`dsh --profile sci` 为此付了两笔代价。它的名册列出启动器那四个通用 preset——`code`、`cordis`、`minimal`、`standard`——它们组合的是本 profile 关掉的工具和它并不运行的沙箱；而组合包随包发布的那两个 preset 一个都没列出，于是 `default: sci-balanced` 解析不到任何东西。`packages/sci/sci-profile/cordis.patch.yml` 把这个状态记录为该 bundle 唯一需要的跨包改动。唯一的绕法是手工把 `sci-*` 种到 `$DSH_HOME/.agent-presets`，而那会让 preset 落在 `user` trust 之下：选择器于是把它们标成个人自有的，并提供删除入口。

## Decision

启动器只对「一个根都没声明」的组合提供随包发布的根。`resolvePresetRootPatch(row)`（`apps/cli/src/profile-boot.ts`）在组合出的名册行没有 `roots`、或 `roots` 为空时返回那层 overlay，在它声明了非空列表时返回 `undefined`——被声明的值于是原封不动地到达 `dsh-agent-presets`，其中包括尚未求值的 `!!js` 节点，启动器绝不能试图去读它。

组合包通过 `dshBundlePath('<package>', ...segments)` 指名自己的目录，这是 Loader `!!js` 作用域里与 `dshHomePath` 并列的新解析器。`bundlePathResolver`（`packages/boot/app-boot/src/profile.ts`）用已加载的 profile 构造它：列出的组合包由 `loadProfile` 已解析出的 `packageDir` 作答，其他任何包走 `resolveBundleDir` 的双锚点。`profile-boot` 在 `boot()` 的 `prepare` 钩子里提供它，早于任何 entry 挂载，因为承载该表达式的行是在自己挂载时求值的。只有能解析到该包的解析器才知道它的文件在哪，这既是这条路径不能写成字面量的原因，也是由启动器而非组合包来求值的原因。

`sci-profile` 的 patch 层现在声明一个根——它自己的 `config/agent-presets`，`trust: system`——并把 `includeUserRoot` 留在默认值，因此 `$DSH_HOME/.agent-presets` 仍会被扫描，部署仍然可以添加 preset。`system` trust 正是让选择器上的「· 用户」后缀消失的东西；客户端不需要任何改动。

`check-workspace-constraints` 的 `packageFileExtras` 现在为 `@deepseek-ai/dsh-sci-profile` 放行 `config/**`。manifest 的 `files` 早已列出该目录，但那张表里没有条目，所以这道 gate 此前是红的；发布出去的包必须带上 patch 层所指向的那棵树。

## Alternatives considered

**让 `apps/cli` 去解析 `@deepseek-ai/dsh-sci-profile` 的 `BUNDLED_PRESET_ROOT`。** 否决：启动器会为服务一个 profile 而 import 一个 profile 专属包，而下一个随包发布 preset 的组合包又要改同一处。这个机制属于双方本来就共享的那道接缝——patch 层与 `!!js` 作用域。

**让名册按包名解析根（`{ package, path }`）。** 否决：`dsh-agent-presets` 会因此背上模块解析的职责，而它手里并没有相应的锚点。当初解析出这个组合包的，是启动器。

**把声明的根前置，把随包发布的根留在后面。** 否决：first-root-wins 让 id 层面不出问题，但那四个 `dsh` preset 仍会出现在名册里、并且可选——在一个并不组合它们所用工具的 profile 里。

**在 sci patch 里设 `includeUserRoot: false`。** 否决：那会让本 profile 无法创作 preset——没有可写根，`copy()` 失败，部署根本加不了 preset。

## Consequences

`dsh --profile sci` 的选择器恰好显示 `单体 / Solo` 与 `蜂群 / Swarm`，两者都是 `system` trust、没有「用户」后缀，外加部署自己在 `$DSH_HOME/.agent-presets` 里创作的东西。其他 profile 一律不变：它们不声明任何根，启动器那层 overlay 照旧落地。

手工把 `sci-balanced` 或 `sci-cluster` 种进 `$DSH_HOME/.agent-presets` 的部署不会看到重复行——`discoverPresets` 按 id 取第一个根胜出，而声明的根排在用户根之前——但种下的那份副本现在是死重量：它被遮蔽、对它的改动毫无效果，且没有任何东西报告这次遮蔽。把那些目录删掉。

用了 `dshBundlePath` 的 bundle patch 在没有提供它的启动器下会明确失败：该行挂载时表达式抛 `dshBundlePath is not defined`，而不是解析成一条错误路径。

## Testing

`packages/boot/app-boot/tests/profile.spec.ts` 覆盖解析器的「列出的组合包」、「未列出的包」、「无 segment」与「解析不到」四种情形；`app-boot.spec.ts` 启动一棵真实的 Loader 树，其中某行的 config 就是一个 `dshBundlePath` 表达式，并断言求值结果。`apps/cli/tests/preset-roots.spec.ts` 钉住 `resolvePresetRootPatch` 在「声明了列表」、「空列表」、「没有 `config`」、「没有该行」以及「声明的根仍带着 `!!js` 节点」下的行为。`packages/sci/sci-profile/tests/composition.spec.ts` 断言组合出的那一行只有一个 `system` trust 的根及其表达式，并断言在 `BUNDLED_PRESET_ROOT` 上做发现恰好得到那两个科研 preset——未损坏、`system` trust、名为 `单体 / Solo` 与 `蜂群 / Swarm`——且不含那四个 `dsh` preset。profile dump snapshot 带上了新的这一行。
