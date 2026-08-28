# Agent Note: 按引用的文本内容块

Status: implemented

[English](2026-08-27-referenced-text-blocks.md) | 中文

## Problem

Skill 正文是平台知识产权，不得留在会话日志、不得到达浏览器客户端、不得随 harness 镜像分发。但 skill 正文是模型可见文本，而仓库的不变量是模型请求包含的一切都能从日志重建（「模型可见 ⟺ 已记录」）。内联存正文满足不变量却泄露；不存正文保护了它却打断回放、resume 与压缩——三者都从日志重建请求。

## Decision

新增一个可合并扩展的内容块 `referenced-text { store, id, sha256 }`，携带指向模型可见文本的内容寻址引用，而非文本本身。会话日志只存引用；正文只在构建模型请求时、在 DeepSeek adapter 内、与 `ImageAttachmentRef` 字节解引用相同的位置被取回并替换进去。

- `@deepseek-ai/dsh-referenced-text` 拥有 `ReferencedTextBlock` 类型（合并进 `ContentBlockMap`）与 `ctx.referencedText` 注册表。provider 注册一个命名的 `ReferencedTextStore`；`read(ref)` 取回并校验摘要；`resolveMessages(messages)` 把每个 `referenced-text` 块（顶层及嵌套在 `tool-result` 内的）替换为 `text` 块，无需解引用时返回同一数组引用。
- DeepSeek adapter（`llm-deepseek`）在任一消息带引用时，于序列化前对 `GenerateOptions.messages` 的副本调用 `resolveMessages`，未挂载注册表时抛 `UNSUPPORTED_CONTENT`。它绝不改动循环的 `options`，故 `dsh-agent-loop/invariant` 在 `llm/stream`（先于 adapter）的比对不受影响。
- store 缺失、摘要不匹配或无法提供对象时，请求失败而非降级——与图片契约一致：不可读的被引用对象使请求失败；逐字节重建绝不弱化。

这是 [2026-07-05-reconstructable-requests](2026-07-05-reconstructable-requests.zh.md) 中推广形式「模型可见 ⟺ 已持久引用」的第二个实例：请求可由日志加上它引用的不可变内容寻址对象重建。`sha256` 是解引用方校验的内容承诺，与图片摘要完全一致。

## Alternatives considered

- **正文内联留在日志，在客户端出口（api-proxy）脱敏。** 否决：日志是用户可通过导出、resume 及任何未来运维工具拿到的持久产物；只脱敏一份出口副本，正文仍在其余每份副本里。出口脱敏仍用于价值较低的 catalog 描述——那里日志合法保留文本。
- **在 `agent/pre-step` 而非 adapter 解引用。** 否决：pre-step 的产出会变成新的已记录消息，正文终究被记录；且压缩的 summarize 调用不经过 `agent/pre-step` 却经过 `ctx.llm.stream`，只有 adapter 这一缝能用一份实现覆盖回放、resume 与压缩。
- **加密日志中的正文字段。** 否决：密钥须与日志同放才能回放，且每个读日志格式的地方都要懂密文；内容寻址引用两者都不需要，还能复用图片机制。
- **为被引用内容新增 `SessionEventMap` 事件。** 否决：引用与 `ImageBlock` 一样搭乘现有 `tool/result` 与 `user/message` 信封，无需改事件 schema。

## Consequences

- 在 adapter 这一缝解引用可免费覆盖回放、resume 与压缩的 summarize 调用：它们都经同一 `ctx.llm.stream` 路径重建请求（`compaction-basic/src/summarizer.ts`）。`compaction-tool-result-pruner` 原样透传非文本块，故引用块在裁剪中存活。
- 只要任一日志引用某 `sha256`，store 就必须为其提供逐字节相同的内容；因此 skill vault 保留每个正文版本、绝不删除对象。
- `skill` 工具与用户显式 `/name` 调用路径在 skill 定义带 `reference` 时产出 referenced-text 块（`dsh-skill` / `dsh-tool-skill`）；`sci-skills` provider 是第一个 store，由 HTTP skill vault 支撑（14-Skill-Vault）。没有 UI 渲染正文：`ui-skill` 只显示摘要。
- 目前只有 DeepSeek adapter 家族解引用；第二个 adapter 家族须加同样的序列化前步骤，或以 `UNSUPPORTED_CONTENT` 拒绝被引用内容。
