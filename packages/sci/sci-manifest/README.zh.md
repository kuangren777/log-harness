# dsh-sci-manifest

[English](README.md) | 中文

替代 ClawsGO `clawsgo-paper`、`clawsgo-sciplot`、`clawsgo-canvas` 三个 skill 的纯提示词 manifest 契约（归档在本仓库之外的 `ClawsGO-System/01-Skills/_raw-skills/`）。那些 skill 把规则写成请模型遵守的散文——不要写 `versions`，不要改 `history`/`output`/`annotations`，不要移动画布上已有的节点，核对 edge id——因此忽略这些散文的模型照样会毁掉用户的投稿历史或重排他们的画板。本包把每条规则变成返回具名字段的纯函数，于是 `sci-workspace` 能在 `tools/pre-execute` 拒绝这次写入、`sci-deliver` 能拒绝这次交付，而不是指望模型自觉。设计出处：`ClawsGO-System/09-Target-Architecture/06-delivery-and-workspace.md`（P1），测试 T7。

没有 Cordis service、没有插件、不碰文件系统：manifest 自身回答不了的事情一律以注入的谓词传入，因此同一组函数既能跑在策略门禁里，也能跑在交付链里，还能跑在沙箱内的 `sci` CLI 里。

## 每种 bundle 的所有权

| 种类 | 路径 | agent 不得写入的字段 | 交叉引用检查 |
|---|---|---|---|
| `paper` | `*.paper` | `versions`（工作台追加投稿快照） | `entry` 是 bundle 内相对路径的 `.tex` 文件 |
| `sciplot` | `*.sciplot` | `history`、`output`（渲染脚本），`annotations`（用户） | `entry` 是 bundle 内相对路径的 `.py` / `.r` / `.sh` / `.jl` 脚本 |
| `canvas` | `*.canvas` | 每个既有节点的 `position` 与 `size` | 节点 id 唯一、edge id 唯一、每个 edge 端点都是节点 id、每个 `src` 都在目录内且真实存在 |

## API

`validatePaper(json)`、`validateSciplot(json)`、`validateCanvas(json, { assetExists })` 接收已经解析好的值——严格 JSON 是 `JSON.parse` 的职责，注释和尾逗号永远到不了校验器。每个函数返回 `{ ok: true, kind }` 或 `{ ok: false, kind, errors }`，其中每条消息都点名出问题的字段路径（`canvas manifest.nodes[2].position.x`）、节点 id 或 edge id，让拒绝理由可以原样引用而不必重新推导位置。一次校验报告全部问题字段，而不是只报第一个。

`diffOwnedFields(kind, before, after)` 返回这次编辑会改动的所有权字段：`['versions']`、`['history', 'output', 'annotations']` 中的任意几项，或每个画布节点的 `nodes[<id>].position` / `nodes[<id>].size`。比较是结构化的，忽略对象键顺序。两个版本都不需要是合法 manifest——读不懂的一侧按缺失处理，因此把 manifest 覆盖成垃圾同样会报出它的所有权字段。这次编辑新增或删除的画布节点不会被报告：skill 允许增删，被禁止的只是重排既有节点。 画布侧的每一处歧义都按「报变更」处理，因为消费方把非空结果当作拒绝：`before` 节点 id 缺失、非字符串或重复时按索引上报（`nodes[0].position`）；`after` 的节点列表不可读时上报全部 `before` 节点几何；`after` 侧重复的 id 即使有一份匹配也上报。

`isManifestPath(path)` 只按扩展名分类，不碰文件系统，大小写敏感且要求扩展名前有非空文件名，因此名为 `.paper` 的隐藏文件不是 manifest。`BUNDLE_KINDS` 是种类词表；这个名字早于 `sci-bundle` → `sci-manifest` 的包重命名，作为已发布常量保留。 扩展名大小写不敏感（用户侧工作台跑在大小写不敏感的文件系统上，`Report.PAPER` 与 `Report.paper` 是同一文件；`requireEntry` 也已接受 `a.TEX`）。

## 刻意不检查的部分

`versions`、`history`、`output`、`annotations` 里的行没有 schema。写它们的是工作台、渲染脚本和用户，而 skill 的 JSON 块只固定了容器，因此更严的行 schema 会拒绝掉本 agent 从未产出的 manifest。这里只检查容器类型；「agent 根本不得写它们」由 `diffOwnedFields` 负责，不由校验器负责。

时间戳只检查 ISO-8601 UTC 格式，不检查日历有效性。两项画布检查刻意比渲染器更严：渲染器会静默丢弃指向缺失节点 id 的 edge，也无法显示不在 manifest 旁边的素材——两者到用户手上都是一块悄悄出错的画板，所以在这里都算错误。

## Fixture

`tests/fixtures/{paper,sciplot,canvas}/` 存放纯 JSON manifest，旁边的 `expected.json` 把每个文件名映射到 `{ "errors": [...] }`——校验输出必须包含的子串，合法 fixture 为空。canvas 条目额外带 `"assets": [...]`，即注入的 `assetExists` 认定存在的清单。沙箱内的 `sci` CLI 会把本校验器移植到 Python 并原样复用这些 fixture，让两份实现锚定在同一份语料上：请保持文件为纯 JSON、保持每个 fixture 都登记在 `expected.json` 里、保持期望值是子串而非完整消息。

## 模型体验

通过消费这些结果的门禁间接影响模型，例如 `dsh-sci-workspace` 与 `dsh-sci-deliver`，它们从具名字段渲染出拒绝理由。

#### KV Cache 影响

无直接失效：本包不注册任何 prompt section、工具 schema 或运行时 context。消费方渲染出的拒绝理由，追加在该消费方自己在请求中的位置。

## 已知限制与暂缓事项

- **Python 移植是第二份实现，不是共享实现** —— 沙箱内的 `sci` CLI 会重新实现这些规则；让两者保持一致的只有 fixture 语料，因此在这里加规则却不加 fixture 会悄悄漂移。
- **所有权检查需要编辑前的版本** —— `diffOwnedFields` 比较两份 manifest，因此读不到当前文件的调用方（新建，或读取被门禁拒绝）用不了它，只能退化为拒绝整次写入。
- **素材存在性是一个时点答案** —— `assetExists` 在校验时被询问；通过校验的画板仍可能引用一个在用户打开前被删掉的文件。
- **平台写入的行不做校验** —— 工作台或渲染脚本的缺陷写出畸形的 `versions` 或 `history` 行，在这里能通过校验，只会在用户的查看器里暴露。
