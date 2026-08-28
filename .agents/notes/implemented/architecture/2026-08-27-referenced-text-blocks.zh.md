# 按引用的文本内容块

Status: implemented

[English](2026-08-27-referenced-text-blocks.md) | 中文

## 决策

新增一个可合并扩展的内容块 `referenced-text { store, id, sha256 }`，携带指向模型可见文本的内容寻址引用，而非文本本身。会话日志只存引用；正文只在构建模型请求时、在 DeepSeek adapter 内、与 `ImageAttachmentRef` 字节解引用相同的位置被取回并替换进去。

## 动机

Skill 正文是平台知识产权，不得留在会话日志、不得到达浏览器客户端、不得随 harness 镜像分发。仓库此前已为图片把「模型可见 ⟺ 已记录」推广为「模型可见 ⟺ 已持久引用」（见 [2026-07-05-reconstructable-requests](2026-07-05-reconstructable-requests.zh.md)）：一个请求可由日志加上它引用的不可变内容寻址对象重建。文本引用是该例外的第二个实例。`sha256` 是解引用方要校验的内容承诺，与图片摘要完全一致；不匹配或缺少 store 时请求 fail loud，绝不静默替换成别的文本。

## 机制

- `@deepseek-ai/dsh-referenced-text` 拥有 `ReferencedTextBlock` 类型（合并进 `ContentBlockMap`）与 `ctx.referencedText` 注册表。provider 注册一个命名的 `ReferencedTextStore`；`read(ref)` 取回并校验摘要；`resolveMessages(messages)` 把每个 `referenced-text` 块（顶层及嵌套在 `tool-result` 内的）替换为 `text` 块，无需解引用时返回同一数组引用。
- DeepSeek adapter（`llm-deepseek`）在任一消息带引用时，于序列化前对 `GenerateOptions.messages` 的副本调用 `resolveMessages`，未挂载注册表时抛 `UNSUPPORTED_CONTENT`。它绝不改动循环的 `options`，故 `dsh-agent-loop/invariant` 在 `llm/stream`（先于 adapter）的比对不受影响。
- 在 adapter 这一层解引用可免费覆盖回放、resume 与压缩的 summarize 调用：它们都经同一 `ctx.llm.stream` 路径重建请求（`compaction-basic/src/summarizer.ts`）。`compaction-tool-result-pruner` 原样透传非文本块，故引用块在裁剪中存活。

## Fail-loud 策略

store 缺失、摘要不匹配或无法提供对象时，请求失败而非降级。这与图片契约一致：不可读的被引用对象使请求失败；逐字节重建绝不弱化。

## 尚待完成

`skill` 工具与用户显式 `/name` 调用路径在 skill 定义带 `reference` 时产出 referenced-text 块（`dsh-skill` / `dsh-tool-skill` 的同期改动）；`sci-skills` provider 是第一个 store，由 HTTP skill vault 支撑（14-Skill-Vault）。没有 UI 渲染正文：`ui-skill` 只显示摘要。
