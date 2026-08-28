# Agent Note: 续传增量带空字符串时保住流式工具调用的 id 与 name

Status: implemented

[English](2026-08-28-deepseek-tool-call-identity-survives-empty-deltas.md) | 中文

## 问题

`@deepseek-ai/dsh-llm-deepseek` 按线上 `index` 把 `choices[].delta.tool_calls[]` 片段拼成一次工具调用。翻译器只要字段存在（`!== undefined`）就从每个片段复制 `id` 与 `function.name`。DeepSeek 官方流只在首个片段带这两项，因此无碍。但 harness 前面的 relay 把部分请求路由到了另一家上游，它在每个续传片段里把两项重复为空字符串：`{"index":1,"id":"","function":{"name":"","arguments":"{\"prompt\": \""}}`。空字符串覆盖了首片段的值，块以 `{ id: '', name: '' }` 收尾，agent loop 派发出去的调用只能被路由器答成 `ToolNotFoundError: unknown tool ""`。线上模型在一轮里把这个无名调用重试了九次，并向用户报告「工具名称被置空」；会话的第一次调用不受影响，所以单次调用的探针全部通过。

## 决策

空字符串是「未变」而不是新值。翻译器现在只从值为非空字符串的片段赋值 `callId` 与 `name`；参数片段仍从每个增量累加。修改是 `translate.ts` 里的两个条件，由一条回放实录形态的测试钉住（首片段带 id/name，续传片段 `id: ""`、`name: ""`），断言收尾的块和每条 `tool-call-delta` 都保留首片段的身份。

## 曾考虑的替代方案

**块收尾时无名就让流失败。** 本次不采用：那会把这家上游的正常流在每次工具调用上变成硬性 `MALFORMED_RESPONSE`，而身份其实在流里——只是翻译器丢掉了它。对「所有片段都没带过名字」的调用给出响亮失败仍值得做，作为单独改动，因为它改变适配器的错误面。

**只按 `index` 路由、放弃 id 处理。** 拒绝：loop 用 id 把 `tool/result` 配到 `tool/call`，恢复会话重放的也是线上 id。

## 后果

工具调用能挺过在续传片段回显空身份字段的 relay 上游。首片段本身就缺 id 或 name 的流仍像以前一样以空字符串收尾；上面的后续改动会让它响亮。

## 测试

`packages/llm/llm-deepseek/tests/translate.spec.ts`：「keeps the call identity when continuation deltas carry empty id and name (live relay capture)」。套件：10 个文件，346 条。
