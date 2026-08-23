# mail/：外发邮件能力族

[English](README.md) | 中文

该包族通过可替换传输通道投递一封已完成的邮件，发件人身份与全部凭据由挂载的提供方持有。

| 包 | 职责 | ctx key |
|---|---|---|
| [`mail/`](mail/README.zh.md) | 定义邮件记录与唯一的 `send` 操作 | `ctx.mail` |
| [`mail-smtp/`](mail-smtp/README.zh.md) | 经 nodemailer 通过 SMTP 投递，凭据引用完成认证 | 提供 `ctx.mail` |
| [`mail-file/`](mail-file/README.zh.md) | 向本地信箱文件追加每封邮件一行 JSON | 提供 `ctx.mail` |

同一时刻只挂载一个提供方：`ctx.mail` 代表一个发件身份，组合在真实中继与可读信箱之间二选一，而不是把同一封邮件同时发往两处。

本包族不组装邮件内容。主题、正文与模板属于决定发什么的消费方，因此模板改动永远不会触及传输通道。
