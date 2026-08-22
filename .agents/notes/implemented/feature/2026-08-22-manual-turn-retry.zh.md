# Agent Note：手动重试会重发失败轮次的开场用户文本

Status: implemented

[English](2026-08-22-manual-turn-retry.md) | 中文

## 问题

`dsh-llm-retry` 只对配置内的瞬时错误码做有限次重试，留下的 `turn-error` 行没有任何操作。认证、配额或重试额度耗尽的失败之后，用户只能手动再粘贴一遍消息。

## 决定

`turn-error` 行带一个「重试」按钮。它调用会话作用域 conversation 服务上新增的 `IConversation.retryTurn(failureSeq)`，沿 `ChatViewSlotProps` 与 `ChatNodeOwnerProps` 与 `forkAt` 并列传递。服务读取会话快照，取 seq 早于 `failureSeq` 的最近一条 `user` Chat Node，把其文本块用换行拼接，经既有的 `session.prompt(…, 'queue')` 路径提交。Host 侧不变：失败的轮次与原消息都留在日志中，重发的消息开启一个普通的新轮次。

图片块不会重复，因为客户端只持有持久附件引用，没有提交 prompt 所需的字节。没有文本的消息，或已加载窗口不再包含开场消息时，调用会 reject；inject 包装层吞掉该 reject，行保持原样，而提交失败本身已经落在会话的 `promptError` 里。

## 考虑过的替代方案

**Host 侧 `session.retry`，在同一份持久历史上重开轮次。** 暂不采用：它要改 `agent-loop` 并新增 RPC，而循环的重试边界（`agent/request-error`）只在轮次打开期间存在。客户端重发用十分之一的改动面覆盖了常见情况；当需要在不重复用户消息的前提下恢复做到一半的工具轮次时，Host 路径仍是正确的后续方案。

**always 模式的 `retryPolicy`。** 不能替代，因为它对永久性失败也会无限重试。

## 后果

重试成功后，模型会在历史中看到两遍用户文本。失败轮次里的工具调用不会恢复。本包之外的 `ChatNodeOwnerProps` 消费者（`ui-tool`、`ui-workflow-run` 的测试）需要提供 `retryTurn`。
