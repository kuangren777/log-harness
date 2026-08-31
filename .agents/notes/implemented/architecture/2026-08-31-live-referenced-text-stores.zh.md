# Agent Note：live referenced-text store —— skill 正文跟随其目录

Status: implemented

[English](2026-08-31-live-referenced-text-stores.md) | 中文

## 问题

`ReferencedTextRegistry` 对每次 store 读取都按日志里的 `sha256` 校验，因此一条已记录引用永远只指向一段文本。`dsh-sci-skills` 在该契约下注册正文 store，却按名字经由启动时目录读取：vault 正文更新加容器重启之后，每个加载过旧正文的会话，其后每次模型请求都以 `DIGEST_MISMATCH` 永久失败。2026-08-31 在生产观测到：store `sci` 的 skill `univer`，会话记录的是 15:28 的正文，新目录提供的是 16:11 的正文。vault 永不删除的对象存储本可提供记录时的正文，但 store 从不查询 `ref.sha256`——而且把旧会话钉在旧正文上本身也被判定为错误的产品语义：skill 指令更新应当触达运行中的会话，而不是弃置它们。

## 决定

`ReferencedTextStore` 声明 `mode: 'immutable' | 'live'`；缺省即 `immutable`，先前契约不变。对 `live` store，注册表直接返回 store 当前文本，不做摘要校验；日志里的 `sha256` 只说明引用被记入时模型看到的文本。`dsh-sci-skills` 以 `live` 注册其 store：目录列出的名字解析为目录当前正文；目录不再列出的名字回退为 `source.object(ref.sha256)`——仅对不含 `$SCI_SKILL_ROOT` 的正文精确，因为展开会使摘要偏离 vault 的原始正文键——否则读取失败并链上源错误。`loadSkillBody` 改收目录条目而非名字，删除了两个调用方都已先行守卫的未知名字分支。

## 备选方案

- **按 hash 把旧会话钉在旧版** —— store 从 vault 的永久对象存储读 `ref.sha256`。保住逐字节重放，却让会话困在过时指令上；对展开过的正文也不精确，因为日志记录展开后摘要而 vault 按原始正文键索引；再额外记录原始摘要则会为一个 store 的需要扩宽 `ReferencedTextRef`。操作者为新鲜度而否决。
- **注册表全局跳过校验** —— 摘要校验正是为真正不可变的 store 提供防篡改证据，全局跳过将其一并移除。
- **检测到漂移时改写引用记录** —— 从解析路径改写已记录历史颠倒了日志的所有权；解析是读操作。

## 后果

- **Model-visible ⟺ logged 获得一处声明过的例外**：对 `live` store，重建请求需要日志加 store 当前内容，而非仅日志。[可重建请求](2026-07-05-reconstructable-requests.zh.md)对其余所有块仍是权威；本 note 拥有这处豁免。
- skill 正文更新会让仍携带该引用的每个请求位置重新解析：每个加载过它的会话付一次完整前缀 cache miss，随后恢复稳定。
- 正文用过 `$SCI_SKILL_ROOT` 的已下架 skill 无法按引用恢复；已记入 `sci-skills` README 的 Known Limitation。
- 快照覆盖不变：稳定正文的解析仍逐字节相同，变更路径需要会话中途改变 store 内容，由包级测试套件直接覆盖。
