# @deepseek-ai/dsh-referenced-text

[English](README.md) | 中文

内容寻址文本服务边界。`ctx.referencedText` 拥有 `referenced-text` 内容块、可产出其文本的具名 store 注册表，以及证明已记录引用仍指向同一段文本的摘要校验。

`ReferencedTextRef` 记录 store 名称、store 内部 id，以及该文本 UTF-8 编码的小写十六进制 SHA-256。生产方记录 `{ type: 'referenced-text', store, id, sha256 }` 而不是文本本身，于是会话日志保存引用、模型请求保存文本——这与 [`ImageBlock`](../attachment/README.zh.md) 对持久图片采用的拆分方式相同，也是本包满足[可重建请求契约](../../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.zh.md)的方式。

`registerStore(name, store)` 以唯一名称登记一个借用的同进程 store 并返回 disposer；重名会抛错，登记方 fiber 被释放时该 store 被移除。`read(ref, signal)` 找到归属 store，等待 `store.read(ref, signal)`，对返回文本求哈希，只有摘要匹配引用时才返回该文本。`resolveMessages(messages, signal)` 遍历已组装的请求，把每个 `referenced-text` 块——包括嵌套在 `tool-result` 内容中的块——替换为校验通过的 `{ type: 'text', text }` 块，其余块保持日志记录的原样。不含引用的消息按原对象透传，整个输入数组不含任何引用时原样返回，因此调用方可用引用相等判断“没有解析任何内容”。输入消息绝不被修改；它们可能已被深度冻结。每个不同的引用在一次 `resolveMessages` 调用内只读取一次。

`ReferencedTextError.code` 使用封闭的 `ReferencedTextErrorCode` 联合类型。没有 store 拥有 `ref.store` 时注册表抛出 `STORE_MISSING`，返回文本哈希与引用不符时抛出 `DIGEST_MISMATCH`；store 内容不再包含该 id 时由 store 抛出 `NOT_FOUND`。任何一处失败都会中止整次解析：`resolveMessages` 不返回部分结果。

## 模型体验

### 解析进请求的引用文本

#### 模型看到什么

store 返回的确切 UTF-8 文本，作为普通 `text` 块出现在原 `referenced-text` 块所在位置。模型看不到 store 名称、id 或摘要；校验失败的引用产生错误，而不是替代文本。

#### Token 影响

有条件，且等于解析出的文本：只要请求仍携带该块，一个引用就消耗其完整正文的 token；该块离开请求后为零。引用字段本身从不被序列化，因此不消耗 token。

#### KV 缓存影响

在被引用文本稳定期间是追加式的，因为解析是确定性的：同一引用在每次请求中产出逐字节相同的请求文本，保留已可复用的前缀。修改已存文本会改变其摘要，从而让旧引用校验失败，而不是悄悄改写更早的请求位置。

## 已知限制与待完成工作

- **尚无适配器解析该块** —— 在 DeepSeek 适配器族于序列化时调用之前，`resolveMessages` 没有调用方；计划中只有该适配器族，因此其他适配器遇到 `referenced-text` 块会按未知块处理。
- **没有 UI 渲染** —— 在客户端行落地之前，transcript 消费方对 `referenced-text` 块没有呈现方式，只能作为不透明内容显示。
- **压缩原样透传引用** —— tool-result 剪枝器只度量和剪裁 `text` 块，其余块逐字复制，因此被引用的正文既不计入字符预算，也不会被剪裁。
