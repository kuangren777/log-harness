# Agent Note: 无名工具调用不写 toolName，避免一行坏记录拒绝整个启动

Status: implemented

[English](2026-08-28-sci-audit-nameless-tool-call-row.md) | 中文

## 问题

`@deepseek-ai/dsh-sci-audit` 把每条 `tool/call` 投影成一行 `sci_audit` 记录，`toolName: event.data.name`，而记录 schema 要求 `toolName` 一旦出现必须是非空字符串。一次畸形的模型流产生了 `name: ''` 的工具调用（见[适配器修复](2026-08-28-deepseek-tool-call-identity-survives-empty-deltas.zh.md)），投影器写下了十行 `toolName: ""`。存储域在插件加载时按 schema 校验已存记录，于是下一次启动 `sci-audit` 以 `stored record 'session-…#287' in table 'sci_audit' does not match its schema` 失败，loader 报 `plugin tree failed to load`，生产 VM 反复崩溃，直到手工删掉这些行。一条能把整个 profile 拖垮的审计记录，是防御性记录的错误取舍。

## 决策

写入侧永不产生非法形态。`auditRow()` 丢弃所有值为空字符串的可选列（`toolName`、`target`、`rule`、`reason`、`sha256`）——这些字段本就可选，「没有名字的调用」或「指向无 id 调用的结果」正是缺省值的含义。同一事故产生了两种形态：`toolName: ""` 的 `tool/call` 行与 `target: ""` 的 `tool/result` 行。schema 保持严格：有 `toolName` 的行仍须非空，读侧校验继续抓真实损坏。

## 曾考虑的替代方案

**放宽 schema 接受 `""`。** 拒绝：那会把畸形值写进审计词汇表，每个消费者都得把 `""` 与缺省等同处理。

**加载时跳过不可读的行而不失败。** 本次不做：严格性属于所有插件共用的存储域，悄悄放松是平台级决定。记为值得做的后续项（隔离 + 告警），交平台侧。

## 后果

无名调用以 `kind: tool-call` 记录 actor 与时间但无 `toolName`；启动不再依赖模型永不吐出空名字。在旧构建上撞到崩溃循环的运维：先备份，再从 `$DSH_HOME/storages/sci_audit.json` 删除 `"toolName": ""` 的行并重启。

## 测试

`packages/sci/sci-audit/tests/project.spec.ts`：「records a nameless tool call without toolName instead of an empty string」。
